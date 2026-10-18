// 3D-Szene (three.js): Polygonmodell, Merkmalsprimitive, Picking mit BVH, Ansichten.
import * as THREE from 'three';
import { NurbsInfo, evalCurve, evalSurface, insideTrim, tessellate } from './core/nurbs';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import type { FitResult } from './core/fit';
import { AxisAnalysis, axisColorScale, displayPoint, nominalFoot } from './core/axisan';
import type { SearchRegion } from './core/reextract';
import type { Vec3 } from './core/linalg';
import { Labels, ViewCube } from './overlay';

(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const BASE_COLOR = [0.62, 0.66, 0.72];

export interface Hit { tri: number; point: [number, number, number]; normal: [number, number, number]; }

export class Viewer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  model: THREE.Mesh | THREE.Points | null = null;
  colors: Float32Array | null = null;
  prims = new THREE.Group();
  cursor: THREE.Mesh;
  private ray = new THREE.Raycaster();
  radius = 100;
  center = new THREE.Vector3();
  cube!: ViewCube;
  labels!: Labels;

  constructor(public el: HTMLElement) {
    const mobile = matchMedia('(pointer: coarse)').matches;
    // Mobil: kein MSAA, Pixelverhältnis begrenzt (GPU-Speicher auf iPhone)
    this.renderer = new THREE.WebGLRenderer({ antialias: !mobile, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 2 : 2));
    el.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(150, -200, 150);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    // Maus: links drehen, mittlere Taste gedrückt = verschieben in der Bildebene, Rad = zoomen, rechts = verschieben
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    // Hintergrund-Verlauf wie in typischer Messsoftware
    const cv = document.createElement('canvas'); cv.width = 2; cv.height = 256;
    const g = cv.getContext('2d')!, gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#5d6d84'); gr.addColorStop(1, '#dfe4ea'); g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
    this.scene.background = new THREE.CanvasTexture(cv);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(1, -1, 2);
    this.camera.add(dl); this.scene.add(this.camera);
    this.scene.add(this.prims);
    this.cursor = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd400, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 }));
    this.cursor.visible = false; this.cursor.renderOrder = 10; this.scene.add(this.cursor);
    new ResizeObserver(() => this.resize()).observe(el);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 300));
    // iOS kann den WebGL-Kontext bei Speicherdruck verwerfen: Wiederherstellung zulassen
    const glc = this.renderer.domElement;
    glc.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.warn('WebGL-Kontext verloren'); });
    glc.addEventListener('webglcontextrestored', () => { this.resize(); });
    this.resize();
    this.cube = new ViewCube(this);
    this.labels = new Labels(this);
    const loop = () => {
      this.renderer.render(this.scene, this.camera);
      this.cube.render(this.renderer);
      this.labels.update();
      requestAnimationFrame(loop);
    };
    loop();
  }

  resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  wire: THREE.Mesh | null = null;
  /** Dreiecksnetz als Drahtgitter über dem Modell anzeigen (Ansicht › Netz). */
  setWireframe(on: boolean) {
    if (this.wire) { this.scene.remove(this.wire); this.wire = null; }
    if (on && this.model && (this.model as THREE.Mesh).isMesh) {
      this.wire = new THREE.Mesh(this.model.geometry, new THREE.MeshBasicMaterial({ color: 0x1b2633, wireframe: true, transparent: true, opacity: 0.35 }));
      this.wire.raycast = () => {}; this.wire.visible = this.model.visible; this.scene.add(this.wire);
    }
  }
  setModel(positions: Float32Array, indices: Uint32Array, normals: Float32Array | null, keepView = false) {
    const hadWire = !!this.wire; this.setWireframe(false);
    if (this.model) { this.scene.remove(this.model); this.model.geometry.dispose(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const nv = positions.length / 3;
    this.colors = new Float32Array(3 * nv);
    for (let i = 0; i < nv; i++) this.colors.set(BASE_COLOR, 3 * i);
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    if (indices.length) {
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      if (normals) geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3)); else geo.computeVertexNormals();
      (geo as any).computeBoundsTree({ indirect: true }); // indirect: Dreiecksreihenfolge bleibt erhalten (Index = Worker-Index)
      this.model = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide }));
    } else {
      this.model = new THREE.Points(geo, new THREE.PointsMaterial({ vertexColors: true, size: 2, sizeAttenuation: false }));
    }
    this.scene.add(this.model);
    if (hadWire) this.setWireframe(true);
    geo.computeBoundingSphere();
    this.center.copy(geo.boundingSphere!.center); this.radius = geo.boundingSphere!.radius;
    this.ray.params.Points = { threshold: this.radius / 300 };
    if (!keepView) this.view('iso');
  }

  resetColors() { if (!this.colors) return; for (let i = 0; i < this.colors.length / 3; i++) this.colors.set(BASE_COLOR, 3 * i); }
  paint(idx: Uint32Array, rgb: number[]) { if (!this.colors) return; for (const v of idx) this.colors.set(rgb, 3 * v); }
  /** Abweichungs-Farbkarte: −r blau → 0 grün → +r rot. */
  paintScalar(idx: Uint32Array, val: Float32Array, r: number, steps = 0, c0 = 0) {
    if (!this.colors) return;
    for (let k = 0; k < idx.length; k++) {
      let t = Math.max(-1, Math.min(1, (val[k] - c0) / r)); let c: number[];
      if (steps > 0) t = Math.max(-1, Math.min(1, (Math.round(((t + 1) / 2) * steps - 0.5) + 0.5) / steps * 2 - 1));
      c = devRGB(t);
      this.colors.set(c, 3 * idx[k]);
    }
  }
  /** Analyse: Modell halbtransparent (Abweichungskarte über einem durchscheinenden Netz). */
  setModelOpacity(a: number) {
    if (!this.model) return; const m = this.model.material as THREE.MeshStandardMaterial;
    const tr = a < 1; if (m.transparent !== tr || m.opacity !== a) { m.transparent = tr; m.opacity = a; m.depthWrite = !tr; m.needsUpdate = true; }
  }
  /** Analyse-Whisker: Linie je Punkt entlang der Elementnormalen, Länge = Abweichung × Überhöhung, Farbe wie Farbkarte. */
  addWhiskers(pos: Float32Array, dir: Float32Array, dev: Float32Array, exag: number, r: number, maxN = 6000) {
    const n = dev.length, step = Math.max(1, Math.ceil(n / maxN)), v: number[] = [], col: number[] = [];
    for (let i = 0; i < n; i += step) {
      const p = [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]], d = dev[i] * exag;
      v.push(p[0], p[1], p[2], p[0] + dir[3 * i] * d, p[1] + dir[3 * i + 1] * d, p[2] + dir[3 * i + 2] * d);
      const t = Math.max(-1, Math.min(1, dev[i] / r)); const c = t < 0 ? [0, 0.4 + 0.6 * (1 + t), 1] : [1, 0.4 + 0.6 * (1 - t), 0];
      col.push(...c, ...c);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true })); l.renderOrder = 4; this.prims.add(l);
  }
  /** Analyse-Pfeile: dicke, farbcodierte Vektoren (InstancedMesh, Schaft + Spitze) je Punkt entlang der Normalen. */
  addArrows(pos: Float32Array, dir: Float32Array, dev: Float32Array, exag: number, r: number, c0 = 0, maxN = 4000) {
    const n = dev.length, step = Math.max(1, Math.ceil(n / maxN)), m = Math.ceil(n / step);
    let sp = 0; { let ext = 0; for (let i = 0; i < n; i += step) ext = Math.max(ext, Math.abs(dev[i] * exag)); sp = Math.max(this.radius / 900, Math.min(this.radius / 120, ext / 10 || this.radius / 300)); }
    const shaft = new THREE.CylinderGeometry(1, 1, 1, 8); shaft.translate(0, 0.5, 0);
    const head = new THREE.ConeGeometry(1, 1, 10); head.translate(0, 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const S = new THREE.InstancedMesh(shaft, mat, m), H = new THREE.InstancedMesh(head, mat, m);
    const up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), q = new THREE.Quaternion(), M = new THREE.Matrix4(), P = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
    let k = 0;
    for (let i = 0; i < n && k < m; i += step, k++) {
      const d = dev[i] * exag; v.set(dir[3 * i], dir[3 * i + 1], dir[3 * i + 2]); if (d < 0) v.negate(); const L = Math.abs(d);
      q.setFromUnitVectors(up, v.normalize()); P.set(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
      const hl = Math.min(L * 0.45, sp * 4), w = Math.min(sp, Math.max(L, 1e-9) * 0.25);
      M.compose(P, q, sc.set(w * 0.5, Math.max(L - hl, 1e-9), w * 0.5)); S.setMatrixAt(k, M);
      M.compose(P.clone().addScaledVector(v, L - hl), q, sc.set(w * 1.3, Math.max(hl, 1e-9), w * 1.3)); H.setMatrixAt(k, M);
      const t = Math.max(-1, Math.min(1, (dev[i] - c0) / r)), a = Math.abs(t);
      const c = t < 0 ? (a < 0.5 ? [0, 0.75 + 0.25 * (1 - 2 * a), 2 * a] : [0, 1.5 * (1 - a), 1]) : (a < 0.5 ? [2 * a, 0.75 + 0.25 * (1 - 2 * a), 0] : [1, 1.5 * (1 - a), 0]);
      col.setRGB(c[0], c[1], c[2]); S.setColorAt(k, col); H.setColorAt(k, col);
    }
    S.count = H.count = k; S.renderOrder = H.renderOrder = 4; this.prims.add(S, H);
  }
  /** Normal/axis arrow + centre dot (used with trimmed geometry). */
  addPrimitiveMarkers(f: FitResult, color: number) {
    const c = new THREE.Vector3(...f.center), n = new THREE.Vector3(...f.normal).normalize(), s = this.radius;
    this.prims.add(new THREE.ArrowHelper(n, c, Math.max(s * 0.08, 3), color, s * 0.02, s * 0.012));
    const dot = new THREE.Mesh(new THREE.SphereGeometry(s / 250, 10, 8), new THREE.MeshBasicMaterial({ color, depthTest: false })); dot.position.copy(c); dot.renderOrder = 6; this.prims.add(dot);
  }
  /** Trimmed feature geometry: fitted surface over the selected triangles + boundary contour. */
  addTrimmed(tri: Float32Array, edges: Float32Array, color: number, selected: boolean) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(tri, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: selected ? 0.35 : 0.2, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.renderOrder = selected ? 4 : 2; m.raycast = () => {}; this.prims.add(m);
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(edges, 3));
    const l = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: selected ? 0xff2bd6 : color, depthTest: !selected })); l.renderOrder = 6; this.prims.add(l);
  }
  /** Re-extraction search region as a transparent body (preview before running). */
  addRegion(R: SearchRegion) {
    const V = (p: number[]) => new THREE.Vector3(p[0], p[1], p[2]);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00a0ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
    const add = (g: THREE.BufferGeometry, q?: THREE.Quaternion, p?: THREE.Vector3) => { const m = new THREE.Mesh(g, mat); if (q) m.quaternion.copy(q); if (p) m.position.copy(p); m.renderOrder = 8; m.raycast = () => {}; this.prims.add(m);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), new THREE.LineBasicMaterial({ color: 0x0077cc, transparent: true, opacity: 0.6 })); if (q) e.quaternion.copy(q); if (p) e.position.copy(p); this.prims.add(e); };
    const up = new THREE.Vector3(0, 1, 0);
    switch (R.kind) {
      case 'prism': { const pts: number[] = []; const o = V(R.o), n = V(R.n), u = V(R.u), v = V(R.v);
        const P = (i: number, j: number, z: number) => o.clone().addScaledVector(u, (i + R.i0) * R.h).addScaledVector(v, (j + R.j0) * R.h).addScaledVector(n, z);
        for (let j = 0; j < R.hgt; j++) for (let i = 0; i < R.w; i++) if (R.cells[j * R.w + i]) for (const z of [-R.d, R.d]) { const a = P(i, j, z), b = P(i + 1, j, z), c = P(i + 1, j + 1, z), d = P(i, j + 1, z); pts.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...a.toArray(), ...c.toArray(), ...d.toArray()); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); const m = new THREE.Mesh(g, mat); m.renderOrder = 8; m.raycast = () => {}; this.prims.add(m); break; }
      case 'box': { const g = new THREE.BoxGeometry(R.u1 - R.u0, R.v1 - R.v0, 2 * R.d); const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(R.u), V(R.v), V(R.n)));
        add(g, q, V(R.o).addScaledVector(V(R.u), (R.u0 + R.u1) / 2).addScaledVector(V(R.v), (R.v0 + R.v1) / 2)); break; }
      case 'shell': { const q = new THREE.Quaternion().setFromUnitVectors(up, V(R.a)), H = R.t1 - R.t0, mid = V(R.c).addScaledVector(V(R.a), (R.t0 + R.t1) / 2);
        const ta = R.type === 'Kegel' ? Math.tan(R.fit.halfAngle ?? 0) : 0, rr = (t: number) => Math.max(1e-3, R.fit.radius! + t * ta);
        for (const s of [-R.d, R.d]) add(new THREE.CylinderGeometry(rr(R.t1) + s, rr(R.t0) + s, H, 48, 1, true), q, mid); break; }
      case 'torus': { const f = R.fit, q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), V(f.normal).normalize());
        for (const s of [-R.d, R.d]) add(new THREE.TorusGeometry(f.radius!, Math.max(1e-3, (f.minorRadius ?? 0) + s), 16, 64), q, V(f.center)); break; }
      case 'sphere': for (const s of [-R.d, R.d]) add(new THREE.SphereGeometry(Math.max(1e-3, R.r + s), 32, 20), undefined, V(R.c)); break;
      case 'band': { const f = R.fit, a = V(f.normal).normalize(), q = new THREE.Quaternion().setFromUnitVectors(up, a), H = R.t1 - R.t0, mid = V(f.center).addScaledVector(a, (R.t0 + R.t1) / 2);
        if (R.type === 'Kreis') { for (const s of [-R.d, R.d]) add(new THREE.CylinderGeometry(f.radius! + s, f.radius! + s, H, 64, 1, true), q, mid); }
        else { const r = f.radius!, hl = f.length! / 2 - r; for (const s of [-R.d, R.d]) { const sh = new THREE.Shape(); sh.absarc(hl, 0, r + s, -Math.PI / 2, Math.PI / 2, false); sh.absarc(-hl, 0, r + s, Math.PI / 2, 1.5 * Math.PI, false);
          const g = new THREE.ExtrudeGeometry(sh, { depth: H, bevelEnabled: false }); g.translate(0, 0, -H / 2); const dx = V(f.direction!).normalize(), y = new THREE.Vector3().crossVectors(a, dx);
          add(g, new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(dx, y, a)), mid); } }
        break; }
      case 'tube': { const q = new THREE.Quaternion().setFromUnitVectors(up, V(R.a)); add(new THREE.CylinderGeometry(R.d, R.d, R.t1 - R.t0, 24, 1, true), q, V(R.c).addScaledVector(V(R.a), (R.t0 + R.t1) / 2)); break; }
    }
  }
  /** Axis analysis: nominal axis (grey), tolerance cylinder Ø t (green), required zone envelope (orange),
   *  exaggerated actual axis (red) and section centres (red dots). All radial offsets × exag. */
  /**
   * Axis analysis: nominal axis (grey line) with tolerance zone Ø t (green) and required zone (orange) – true size,
   * scaled only by `locEx`; actual derived median line (red) at its REAL location, only its bend/form scaled by `formEx`;
   * location offset as a dimension arrow with value.
   */
  addAxisAnalysis(an: AxisAnalysis, formEx: number, locEx = 1, offLabel = '') {
    const V = (p: Vec3) => new THREE.Vector3(...p), d = V(an.dir), L = an.length * 1.15;
    const mid = V(nominalFoot(an, an.mlPoint));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    const line = (pts: THREE.Vector3[], color: number, dashed = false) => { const g = new THREE.BufferGeometry().setFromPoints(pts);
      const l = new THREE.Line(g, dashed ? new THREE.LineDashedMaterial({ color, depthTest: false, dashSize: an.length / 40, gapSize: an.length / 60 }) : new THREE.LineBasicMaterial({ color, depthTest: false }));
      if (dashed) l.computeLineDistances(); l.renderOrder = 7; l.raycast = () => {}; this.prims.add(l); };
    // nominal axis
    line([mid.clone().addScaledVector(d, -L / 2), mid.clone().addScaledVector(d, L / 2)], 0x555555);
    const cyl = (R: number, color: number, op: number) => { if (!(R > 0)) return; const m = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 48, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false })); m.quaternion.copy(q); m.position.copy(mid); m.renderOrder = 5; m.raycast = () => {}; this.prims.add(m); };
    if (an.planeN && an.centers.length) {
      // zone between two parallel planes (axis ∥ plane, axis ⟂ axis): slabs centred on the median line's extent along planeN
      const n = V(an.planeN).normalize(), t = an.centers.map((c) => n.dot(V(c))), c0 = (Math.max(...t) + Math.min(...t)) / 2;
      const ctr = mid.clone().addScaledVector(n, c0 - n.dot(mid)), w = new THREE.Vector3().crossVectors(d, n).normalize();
      const slab = (W: number, color: number, op: number) => { if (!(W > 0)) return; const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false }));
        m.matrixAutoUpdate = false; m.matrix.makeBasis(n.clone().multiplyScalar(W), d.clone().multiplyScalar(L), w.clone().multiplyScalar(4 * an.radius)).setPosition(ctr); m.renderOrder = 5; m.raycast = () => {}; this.prims.add(m); };
      if (an.tol) slab(an.tol * locEx, 0x22aa44, 0.2);
      if (!an.missing) slab(an.zone * locEx, 0xff8c1a, 0.14);
    } else {
      if (an.tol) cyl((an.tol / 2) * locEx, 0x22aa44, 0.2);
      if (!an.missing) cyl((an.zone / 2) * locEx, 0xff8c1a, 0.14);
    }
    // actual median line (real location, form exaggerated around its own axis)
    // coloured by deviation (app colour scale, 0 = green … h = red): radial distance from the reference axis
    const P = an.centers.map((c) => V(displayPoint(an, c, formEx, locEx)));
    const { vals, h } = axisColorScale(an), col = vals.map((v) => new THREE.Color(...devRGB(Math.min(1, v / h))));
    const r = Math.max(an.radius / 60, this.radius / 1000);
    for (let i = 0; i + 1 < P.length; i++) { // tube segments
      const a0 = P[i], a1 = P[i + 1], len = a0.distanceTo(a1); if (len < 1e-12) continue;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.7, len, 10, 1, true), new THREE.MeshBasicMaterial({ color: col[i].clone().lerp(col[i + 1], 0.5), depthTest: false }));
      m.position.copy(a0.clone().lerp(a1, 0.5)); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a1.clone().sub(a0).normalize()); m.renderOrder = 8; m.raycast = () => {}; this.prims.add(m); }
    P.forEach((p, i) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color: col[i], depthTest: false })); s.position.copy(p); s.renderOrder = 8; s.raycast = () => {}; this.prims.add(s); });
    // its own LSQ axis (dashed)
    const ml0 = V(displayPoint(an, an.mlPoint, formEx, locEx)), md = V(an.mlDir);
    line([ml0.clone().addScaledVector(md, -L / 2), ml0.clone().addScaledVector(md, L / 2)], 0xe57373, true);
    // location offset: dimension arrow nominal → actual (position mode)
    if (an.mode === 'position') {
      const from = mid, to = ml0, v = to.clone().sub(from), len = v.length();
      if (len > 1e-9) { const ah = new THREE.ArrowHelper(v.clone().normalize(), from, len, 0x1565c0, Math.min(len * 0.35, an.radius / 3), Math.min(len * 0.2, an.radius / 6));
        ah.traverse((c: any) => { if (c.material) c.material.depthTest = false; c.renderOrder = 9; c.raycast = () => {}; }); this.prims.add(ah); }
      if (offLabel) this.addText(from.clone().lerp(to, 0.5).addScaledVector(d, an.length * 0.08).toArray(), offLabel, '#1565c0');
    }
  }
  /** Text label (screen-sized sprite) at a point. */
  addText(p: number[], text: string, color = '#22303f') {
    const c = document.createElement('canvas'), x = c.getContext('2d')!; x.font = 'bold 30px sans-serif'; const w = Math.ceil(x.measureText(text).width) + 20; c.width = w; c.height = 46;
    x.fillStyle = 'rgba(255,255,255,0.88)'; x.fillRect(0, 0, w, 46); x.strokeStyle = color; x.lineWidth = 3; x.strokeRect(1.5, 1.5, w - 3, 43);
    x.font = 'bold 30px sans-serif'; x.fillStyle = color; x.textBaseline = 'middle'; x.fillText(text, 10, 24);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, sizeAttenuation: false }));
    sp.scale.set(0.022 * w / 46, 0.022, 1); sp.center.set(0, 0); sp.position.set(p[0], p[1], p[2]); sp.renderOrder = 11; sp.raycast = () => {}; this.prims.add(sp);
  }
  /** Toleranz-/Formzone (ISO 1101): Grenzflächen bei Abweichung lo und hi entlang der Normalen des Ausgleichselements. */
  addZone(f: FitResult, lo: number, hi: number) {
    const c = new THREE.Vector3(...f.center), n = new THREE.Vector3(...f.normal).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n), qz = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const mk = (g: THREE.BufferGeometry, color: number) => new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    const out: THREE.Object3D[] = [], s = this.radius;
    for (const [d, color] of [[lo, 0x2060ff], [hi, 0xff4020]] as [number, number][]) {
      let o: THREE.Object3D | null = null;
      switch (f.type) {
        case 'Ebene': { const z = Math.max(s * 0.25, 5); o = mk(new THREE.PlaneGeometry(z, z), color); o.quaternion.copy(qz); o.position.copy(c).addScaledVector(n, d); break; }
        case 'Zylinder': { const R = Math.max(1e-6, f.radius! + d); o = mk(new THREE.CylinderGeometry(R, R, f.length || f.radius!, 48, 1, true), color); o.quaternion.copy(q); o.position.copy(c); break; }
        case 'Kugel': { const R = Math.max(1e-6, f.radius! + d); o = mk(new THREE.SphereGeometry(R, 32, 20), color); o.position.copy(c); break; }
        case 'Kreis': { const R = Math.max(1e-6, f.radius! + d), w = Math.max(f.radius! * 0.04, 0.05); o = mk(new THREE.RingGeometry(R - w / 2, R + w / 2, 72), color); o.quaternion.copy(qz); o.position.copy(c); break; }
        case 'Linie': { if (d <= 0) break; const L = f.length || s * 0.1; o = mk(new THREE.CylinderGeometry(d, d, L, 24, 1, true), 0xff8020); o.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...f.direction!).normalize())); o.position.copy(c); break; }
      }
      if (o) { o.renderOrder = 3; out.push(o); }
    }
    if (out.length) this.prims.add(...out);
    return out.length > 0;
  }
  /** Freiformfläche: halbtransparente Fläche + Isolinien, Randkurven (kräftig), optional Kontrollnetz. */
  addFreeform(nb: NurbsInfo, color: number, selected: boolean, net: boolean) {
    const t = tessellate(nb as any, 40);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(t.positions, 3)); g.setIndex(new THREE.BufferAttribute(t.indices, 1));
    const surf = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: selected ? 0.18 : 0.1, side: THREE.DoubleSide, depthWrite: false }));
    surf.renderOrder = 2; this.prims.add(surf);
    // Isolinien (u, v) als Drahtgitter
    const iso: number[] = []; const S = nb.surface, K = 10, M = 40;
    for (let a = 0; a <= K; a++) for (const dir of [0, 1]) {
      let prev: number[] | null = null; let inside = false;
      for (let b = 0; b <= M; b++) {
        const u = dir ? a / K : b / M, v = dir ? b / M : a / K; const ok = insideTrim(nb.trimUV, u, v);
        const P = evalSurface(S, u, v, 0)[0];
        if (prev && ok && inside) iso.push(...prev, ...P);
        prev = P; inside = ok;
      }
    }
    const ig = new THREE.BufferGeometry(); ig.setAttribute('position', new THREE.Float32BufferAttribute(iso, 3));
    this.prims.add(new THREE.LineSegments(ig, new THREE.LineBasicMaterial({ color, transparent: true, opacity: selected ? 0.75 : 0.4 })));
    // Randkurven
    const BC = selected ? 0xff2bd6 : color;
    nb.boundary.forEach((C) => {
      const pts = Array.from({ length: 121 }, (_, i) => new THREE.Vector3(...evalCurve(C, i / 120)));
      const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: BC, depthTest: false }));
      ln.renderOrder = 7; this.prims.add(ln);
      if (selected) { // Röhre für bessere Sichtbarkeit
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, this.radius / 400, 6), new THREE.MeshBasicMaterial({ color: BC, depthTest: false }));
        tube.renderOrder = 7; this.prims.add(tube);
      }
    });
    for (const c of nb.corners) { const d = new THREE.Mesh(new THREE.SphereGeometry(this.radius / 180, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })); d.position.set(...c); d.renderOrder = 8; this.prims.add(d); }
    if (net) {
      const L: number[] = []; const cp = (i: number, j: number) => S.ctrl.slice(3 * (i * S.nv + j), 3 * (i * S.nv + j) + 3);
      for (let i = 0; i < S.nu; i++) for (let j = 0; j < S.nv; j++) { if (i + 1 < S.nu) L.push(...cp(i, j), ...cp(i + 1, j)); if (j + 1 < S.nv) L.push(...cp(i, j), ...cp(i, j + 1)); }
      const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.Float32BufferAttribute(L, 3));
      const nl = new THREE.LineSegments(ng, new THREE.LineBasicMaterial({ color: 0x1b1b1b, transparent: true, opacity: 0.85, depthTest: false })); nl.renderOrder = 6; this.prims.add(nl);
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(S.ctrl, 3));
      const pp = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x111111, size: 5, sizeAttenuation: false, depthTest: false })); pp.renderOrder = 6; this.prims.add(pp);
    }
  }
  commitColors() { if (this.model) (this.model.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true; }

  /** Ansicht aus beliebiger Richtung (ViewCube: Flächen, Kanten, Ecken); Zielpunkt und Abstand bleiben erhalten. */
  viewDir(v: [number, number, number]) {
    const d = new THREE.Vector3(...v).normalize();
    const dist = this.camera.position.distanceTo(this.controls.target);
    // Z bleibt "oben" (OrbitControls); Draufsicht minimal nach −Y geneigt -> X rechts, Y oben (XY-Ebene)
    if (Math.abs(d.z) > 0.999) d.set(0, -1e-4, Math.sign(d.z)).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(d, dist);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.camera.updateMatrixWorld();
  }

  view(dir: 'iso' | '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z' | 'fit') {
    const d = new THREE.Vector3();
    const cur = this.camera.position.clone().sub(this.controls.target).normalize();
    switch (dir) {
      case '+X': d.set(1, 0, 0); break; case '-X': d.set(-1, 0, 0); break;
      case '+Y': d.set(0, 1, 0); break; case '-Y': d.set(0, -1, 0); break;
      case '+Z': d.set(0, 0, 1); break; case '-Z': d.set(0, 0, -1); break;
      case 'iso': d.set(1, -1.3, 1.1).normalize(); break; default: d.copy(cur);
    }
    const vf = (this.camera.fov * Math.PI) / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    const dist = (this.radius / Math.sin(Math.min(vf, hf) / 2)) * 0.9; // Hochformat: horizontaler Öffnungswinkel begrenzt
    if (Math.abs(d.z) > 0.999) d.set(0, -1e-4, Math.sign(d.z)).normalize();
    this.controls.target.copy(this.center);
    this.camera.position.copy(this.center).addScaledVector(d, dist);
    this.camera.near = dist / 100; this.camera.far = dist * 10; this.camera.updateProjectionMatrix();
    this.controls.update();
    this.camera.updateMatrixWorld();
  }

  pick(clientX: number, clientY: number): Hit | null {
    if (!this.model || !this.model.visible) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    (this.ray as any).firstHitOnly = true;
    const h = this.ray.intersectObject(this.model, false)[0];
    if (!h) return null;
    const n = h.face ? h.face.normal.clone() : this.camera.position.clone().sub(h.point).normalize();
    if (n.dot(this.ray.ray.direction) > 0) n.negate();
    return { tri: h.faceIndex ?? -1, point: [h.point.x, h.point.y, h.point.z], normal: [n.x, n.y, n.z] };
  }

  private brushHi: THREE.Mesh | null = null;
  private hoverPts: THREE.Points[] = [];
  /** Pinsel-Cursor: Kreis auf der Fläche, optional die Dreiecke markieren, die ein Strich erfassen würde (Kugel um den Treffer, zugewandt). */
  showCursor(hit: Hit | null, radius: number, highlight = false) {
    if (this.brushHi) { this.scene.remove(this.brushHi); this.brushHi.geometry.dispose(); this.brushHi = null; }
    if (!hit) { this.cursor.visible = false; return; }
    const bt = (this.model?.geometry as any)?.boundsTree;
    if (highlight && bt) {
      const c = new THREE.Vector3(...hit.point), n = new THREE.Vector3(...hit.normal), sph = new THREE.Sphere(c, radius); const out: number[] = [];
      const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fnrm = new THREE.Vector3();
      bt.shapecast({ intersectsBounds: (box: THREE.Box3) => box.intersectsSphere(sph),
        intersectsTriangle: (t: any) => { if (out.length > 9 * 60000) return true;
          if (t.a.distanceTo(c) > radius && t.b.distanceTo(c) > radius && t.c.distanceTo(c) > radius) return false;
          fnrm.crossVectors(e1.subVectors(t.b, t.a), e2.subVectors(t.c, t.a)); if (fnrm.dot(n) <= 0) return false;
          out.push(t.a.x, t.a.y, t.a.z, t.b.x, t.b.y, t.b.z, t.c.x, t.c.y, t.c.z); return false; } });
      if (out.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out), 3));
        this.brushHi = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.45, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false }));
        this.brushHi.renderOrder = 9; this.scene.add(this.brushHi); }
    }
    this.cursor.visible = true;
    this.cursor.position.set(...hit.point);
    this.cursor.scale.setScalar(radius);
    this.cursor.lookAt(new THREE.Vector3(...hit.point).add(new THREE.Vector3(...hit.normal)));
  }

  /** Live-Vorschau (Hover): Punkte zweier Mengen in zwei Farben (z. B. Hilfsebene blau, Wand orange). */
  showHoverSets(sets: { idx: Uint32Array; color: number }[]) {
    for (const p of this.hoverPts) { this.scene.remove(p); p.geometry.dispose(); } this.hoverPts = [];
    const pos = this.model?.geometry.getAttribute('position') as THREE.BufferAttribute | undefined; if (!pos) return;
    for (const s of sets) { const step = Math.max(1, Math.floor(s.idx.length / 40000)); const a = new Float32Array(3 * Math.ceil(s.idx.length / step)); let k = 0;
      for (let i = 0; i < s.idx.length; i += step) { const v = s.idx[i]; a[k++] = pos.getX(v); a[k++] = pos.getY(v); a[k++] = pos.getZ(v); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a.subarray(0, k), 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: s.color, size: 3, sizeAttenuation: false, depthTest: true, transparent: true, opacity: 0.95 }));
      pts.renderOrder = 8; this.scene.add(pts); this.hoverPts.push(pts); }
  }

  clearPrims() { for (const c of [...this.prims.children]) { this.prims.remove(c); (c as any).geometry?.dispose?.(); } }

  /** Gefittete Geometrie als Drahtmodell/halbtransparent zeichnen. */
  addPrimitive(f: FitResult, color: number, selected: boolean) {
    const mat = new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: selected ? 0.95 : 0.55, depthTest: !selected });
    const lineMat = new THREE.LineBasicMaterial({ color, depthTest: !selected });
    const c = new THREE.Vector3(...f.center), n = new THREE.Vector3(...f.normal).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const qz = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    let obj: THREE.Object3D;
    const s = this.radius;
    switch (f.type) {
      case 'Ebene': {
        const size = Math.max(s * 0.25, 5);
        obj = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 6, 6), mat); obj.quaternion.copy(qz); break;
      }
      case 'Zylinder': {
        obj = new THREE.Mesh(new THREE.CylinderGeometry(f.radius!, f.radius!, f.length || f.radius!, 36, 4, true), mat); obj.quaternion.copy(q); break;
      }
      case 'Kegel': {
        const h = f.length || f.radius!, ta = Math.tan(f.halfAngle!);
        // Achse zeigt von der Spitze weg -> unten (y=-h/2) liegt näher an der Spitze
        obj = new THREE.Mesh(new THREE.CylinderGeometry(f.radius! + (h / 2) * ta, Math.max(f.radius! - (h / 2) * ta, 0), h, 36, 4, true), mat);
        obj.quaternion.copy(q); break;
      }
      case 'Kugel': obj = new THREE.Mesh(new THREE.SphereGeometry(f.radius!, 24, 16), mat); break;
      case 'Torus': obj = new THREE.Mesh(new THREE.TorusGeometry(f.radius!, f.minorRadius!, 12, 48), mat); obj.quaternion.copy(qz); break;
      case 'Kreis': {
        const pts = Array.from({ length: 73 }, (_, i) => new THREE.Vector3(f.radius! * Math.cos((i * Math.PI) / 36), f.radius! * Math.sin((i * Math.PI) / 36), 0));
        obj = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat); obj.quaternion.copy(qz); break;
      }
      case 'Langloch': {
        const r = f.radius!, h = f.length! / 2 - r, pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 36; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 36; pts.push(new THREE.Vector3(h + r * Math.cos(a), r * Math.sin(a), 0)); }
        for (let i = 0; i <= 36; i++) { const a = Math.PI / 2 + (i * Math.PI) / 36; pts.push(new THREE.Vector3(-h + r * Math.cos(a), r * Math.sin(a), 0)); }
        pts.push(pts[0].clone());
        obj = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat);
        const d = new THREE.Vector3(...f.direction!).normalize(), y = new THREE.Vector3().crossVectors(n, d);
        obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(d, y, n)); break;
      }
      case 'Linienzug': {
        const P = (f.pts ?? []).map((p) => new THREE.Vector3(p[0] - c.x, p[1] - c.y, p[2] - c.z)), grp = new THREE.Group();
        if (P.length >= 2) grp.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(P, false, 'centripetal', 0), Math.max(8, 4 * P.length), s / (selected ? 350 : 500), 6), new THREE.MeshBasicMaterial({ color, depthTest: !selected })));
        for (const p of P) { const m = new THREE.Mesh(new THREE.SphereGeometry(s / (selected ? 250 : 350), 8, 6), new THREE.MeshBasicMaterial({ color, depthTest: !selected })); m.position.copy(p); grp.add(m); }
        obj = grp; break;
      }
      case 'Linie': {
        const L = (f.length || s * 0.1) / 2, d = new THREE.Vector3(...f.direction!).normalize();
        obj = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(d.clone().multiplyScalar(-L), d.clone().multiplyScalar(L)), 1, s / (selected ? 350 : 500), 6),
          new THREE.MeshBasicMaterial({ color, depthTest: !selected })); break;
      }
      default: obj = new THREE.Mesh(new THREE.SphereGeometry(s / 150, 12, 8), new THREE.MeshBasicMaterial({ color })); break;
    }
    obj.position.copy(c);
    obj.renderOrder = selected ? 5 : 1;
    this.prims.add(obj);
    // Achse/Normale als Pfeil
    const arrow = new THREE.ArrowHelper(n, c, Math.max(s * 0.08, 3), color, s * 0.02, s * 0.012);
    this.prims.add(arrow);
    // Mittelpunkt
    const dot = new THREE.Mesh(new THREE.SphereGeometry(s / 250, 10, 8), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    dot.position.copy(c); dot.renderOrder = 6; this.prims.add(dot);
  }

  /** Abstand. Ohne dim: Linie p1→p2 mit gestrichelten X/Y/Z-Komponenten. Mit dim (CAD-Bemaßung): Hilfslinien p1→d1, p2→d2,
   *  Maßlinie d1→d2 mit Pfeilspitzen (Lage aus dem Versatz der Annotation). */
  addDistance(p1: number[], p2: number[], color: number, selected: boolean, dim?: { d1: number[]; d2: number[] }) {
    const a = new THREE.Vector3(...p1), b = new THREE.Vector3(...p2);
    const tube = (u: THREE.Vector3, v: THREE.Vector3, w: number) => {
      const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(u, v), 1, w, 6), new THREE.MeshBasicMaterial({ color, depthTest: false })); m.renderOrder = 7; this.prims.add(m); };
    const thin = (u: THREE.Vector3, v: THREE.Vector3, c = color) => { if (u.distanceTo(v) < 1e-6) return;
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([u, v]), new THREE.LineBasicMaterial({ color: c, depthTest: false })); l.renderOrder = 6; this.prims.add(l); };
    if (dim) {
      const d1 = new THREE.Vector3(...dim.d1), d2 = new THREE.Vector3(...dim.d2);
      thin(a, d1); thin(b, d2);
      tube(d1, d2, this.radius / (selected ? 300 : 450));
      const L = d1.distanceTo(d2);
      if (L > 1e-6) { const u = d2.clone().sub(d1).normalize(), h = Math.min(this.radius / 40, L / 3), rr = h / 3;
        for (const [p, s] of [[d1, -1], [d2, 1]] as [THREE.Vector3, number][]) {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(rr, h, 12), new THREE.MeshBasicMaterial({ color, depthTest: false }));
          cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), u.clone().multiplyScalar(s)); cone.position.copy(p).addScaledVector(u, -s * h / 2); cone.renderOrder = 8; this.prims.add(cone); } }
    } else {
      tube(a, b, this.radius / (selected ? 260 : 400));
      const cx = new THREE.Vector3(b.x, a.y, a.z), cy = new THREE.Vector3(b.x, b.y, a.z);
      const legs: [THREE.Vector3, THREE.Vector3, number][] = [[a, cx, 0xd32f2f], [cx, cy, 0x2e9d3a], [cy, b, 0x1f5fa8]];
      for (const [u, v, c] of legs) {
        if (u.distanceTo(v) < 1e-6) continue;
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([u, v]),
          new THREE.LineDashedMaterial({ color: c, dashSize: this.radius / 80, gapSize: this.radius / 120, depthTest: false }));
        l.computeLineDistances(); l.renderOrder = 6; this.prims.add(l);
      }
    }
    for (const p of [a, b]) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(this.radius / 160, 10, 8), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      d.position.copy(p); d.renderOrder = 8; this.prims.add(d);
    }
  }

  /** Kurve des Kurvennetzes als dünne Röhre auf der Oberfläche. */
  addCurve(pts: number[][], color: number, selected: boolean, id?: number, hover = false, thin = false) {
    if (pts.length < 2) return;
    const v = pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const path = new THREE.CatmullRomCurve3(v, false, 'centripetal');
    const tube = new THREE.Mesh(new THREE.TubeGeometry(path, Math.min(600, Math.max(8, v.length * 2)), this.radius / (selected ? 220 : hover ? 260 : thin ? 520 : 380), 5),
      new THREE.MeshBasicMaterial({ color: selected ? 0xffd400 : hover ? 0xffffff : color, transparent: thin, opacity: thin ? 0.8 : 1 }));
    tube.renderOrder = 5; if (id != null) tube.userData.curveId = id; this.prims.add(tube);
  }
  /** Kontrollpunkt (anfassbar), immer sichtbar. */
  addCtrl(p: number[], i: number, active = false) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(this.radius / (active ? 110 : 140), 12, 10), new THREE.MeshBasicMaterial({ color: active ? 0xff3d00 : 0xffffff, depthTest: false }));
    const r = new THREE.Mesh(new THREE.SphereGeometry(this.radius / 100, 12, 10), new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false, transparent: true, opacity: 0.55 }));
    d.position.set(p[0], p[1], p[2]); r.position.copy(d.position); r.renderOrder = 8; d.renderOrder = 9; d.userData.ctrl = i; r.userData.ctrl = i; this.prims.add(r); this.prims.add(d);
  }
  /** Textmarke (z. B. Seitenzahl eines Patches) an einem Punkt. */
  addLabel(p: number[], text: string, bg = '#ffffff') {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d')!;
    x.fillStyle = bg; x.beginPath(); x.arc(32, 32, 28, 0, 7); x.fill(); x.lineWidth = 4; x.strokeStyle = '#222'; x.stroke();
    x.fillStyle = '#111'; x.font = 'bold 34px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 32, 34);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, sizeAttenuation: false }));
    s.scale.set(0.032, 0.032, 1); s.position.set(p[0], p[1], p[2]); s.renderOrder = 10; s.raycast = () => {}; this.prims.add(s);
  }
  /** Angle feature: two legs from the vertex towards both parents and an arc. */
  addAngle(f: { center: number[]; p1?: number[]; p2?: number[]; angle?: number }, color: number, selected: boolean) {
    const c = new THREE.Vector3(...f.center), L = this.radius * 0.12;
    const dir = (p?: number[]) => { const v = p ? new THREE.Vector3(...p).sub(c) : new THREE.Vector3(1, 0, 0); return v.lengthSq() < 1e-12 ? new THREE.Vector3(1, 0, 0) : v.normalize(); };
    const a = dir(f.p1), b = dir(f.p2), mat = new THREE.LineBasicMaterial({ color, depthTest: false });
    const leg = (u: THREE.Vector3) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([c, c.clone().addScaledVector(u, L)]), mat); l.renderOrder = 7; this.prims.add(l); };
    leg(a); leg(b);
    const ang = a.angleTo(b), ax = new THREE.Vector3().crossVectors(a, b); if (ax.lengthSq() > 1e-12) { ax.normalize();
      const pts = Array.from({ length: 25 }, (_, i) => c.clone().add(a.clone().applyAxisAngle(ax, (ang * i) / 24).multiplyScalar(L * 0.6)));
      const arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, depthTest: false })); arc.renderOrder = 7; this.prims.add(arc); }
    const d = new THREE.Mesh(new THREE.SphereGeometry(this.radius / (selected ? 120 : 160), 10, 8), new THREE.MeshBasicMaterial({ color, depthTest: false })); d.position.copy(c); d.renderOrder = 8; this.prims.add(d);
  }
  /** Coordinate system triad: X red, Y green, Z blue arrows with letters; active one larger. */
  addTriad(o: number[], R: number[][], name: string, active: boolean, preview = false) {
    const L = this.radius * (active || preview ? 0.22 : 0.15), O = new THREE.Vector3(o[0], o[1], o[2]);
    const cols = [0xd32f2f, 0x2e9d3a, 0x1f5fa8];
    R.forEach((r, k) => {
      const d = new THREE.Vector3(r[0], r[1], r[2]).normalize();
      const a = new THREE.ArrowHelper(d, O, L, cols[k], L * 0.18, L * 0.08);
      a.traverse((c: any) => { if (c.material) { c.material.depthTest = false; c.material.transparent = true; c.material.opacity = preview ? 0.8 : 1; } c.renderOrder = 9; c.raycast = () => {}; });
      this.prims.add(a);
      const tip = O.clone().addScaledVector(d, L * 1.12); this.addLabel([tip.x, tip.y, tip.z], 'XYZ'[k], ['#ffd6d6', '#d6f5d6', '#d6e4ff'][k]);
    });
    const c = document.createElement('canvas'); c.width = 256; c.height = 48; const x = c.getContext('2d')!;
    x.font = `${active ? 'bold ' : ''}28px sans-serif`; x.fillStyle = preview ? '#c25e00' : '#22303f'; x.textBaseline = 'middle'; x.fillText(name, 4, 26);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, sizeAttenuation: false }));
    sp.scale.set(0.12, 0.0225, 1); sp.center.set(-0.05, 1.2); sp.position.copy(O); sp.renderOrder = 10; sp.raycast = () => {}; this.prims.add(sp);
  }
  /** Kurve oder Kontrollpunkt unter dem Zeiger (Kontrollpunkte haben Vorrang). */
  pickCurve(clientX: number, clientY: number): { curveId?: number; ctrl?: number; point: number[] } | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    (this.ray as any).firstHitOnly = false; this.prims.updateMatrixWorld();
    const objs = this.prims.children.filter((o) => o.userData.curveId != null || o.userData.ctrl != null);
    const hs = this.ray.intersectObjects(objs, false);
    const c = hs.find((h) => h.object.userData.ctrl != null);
    if (c) return { ctrl: c.object.userData.ctrl, point: c.point.toArray() };
    // Kurven: Toleranz in Bildschirmpixeln (Röhren sind dünn) – nächster Kurvenpunkt innerhalb ~10 px
    const m = this.model && this.model.visible ? this.ray.intersectObject(this.model, false)[0] : undefined;
    const depth = m ? m.distance : Infinity;
    const hit = hs.find((h) => h.object.userData.curveId != null && h.distance < depth + this.radius / 200);
    if (hit) return { curveId: hit.object.userData.curveId, point: hit.point.toArray() };
    let best: { curveId: number; point: number[] } | null = null, bd = 10;
    const v = new THREE.Vector3();
    for (const o of objs) if (o.userData.curveId != null) {
      const pos = ((o as THREE.Mesh).geometry.getAttribute('position').array as Float32Array);
      for (let i = 0; i < pos.length; i += 15) {
        v.set(pos[i], pos[i + 1], pos[i + 2]); const dd = v.distanceTo(this.ray.ray.origin);
        if (dd > depth + this.radius / 100) continue;
        const s = v.clone().project(this.camera); const px = Math.hypot((s.x + 1) / 2 * r.width - (clientX - r.left), (1 - s.y) / 2 * r.height - (clientY - r.top));
        if (px < bd) { bd = px; best = { curveId: o.userData.curveId, point: v.toArray() }; }
      }
    }
    return best;
  }
  addNode(p: number[], color: number, size = 1) {
    const d = new THREE.Mesh(new THREE.SphereGeometry((this.radius / 150) * size, 10, 8), new THREE.MeshBasicMaterial({ color }));
    d.position.set(p[0], p[1], p[2]); d.renderOrder = 6; this.prims.add(d);
  }
  /** Kamera auf einen Bereich zentrieren (Blickrichtung bleibt). */
  /** Center on c with radius r; optional view direction (camera placed on the +dir side, looking along −dir). */
  focus(c: [number, number, number], r: number, look?: [number, number, number]) {
    const dir = look ? new THREE.Vector3(...look).normalize() : this.camera.position.clone().sub(this.controls.target).normalize();
    if (look && Math.abs(dir.z) > 0.999) dir.set(0, -1e-4, Math.sign(dir.z)).normalize();
    const vf = (this.camera.fov * Math.PI) / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    const dist = Math.max(r, this.radius / 200) / Math.sin(Math.min(vf, hf) / 2) * 1.15;
    this.controls.target.set(...c);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist); if (look) this.camera.lookAt(this.controls.target);
    this.camera.near = dist / 100; this.camera.far = dist * 10 + this.radius * 4; this.camera.updateProjectionMatrix();
    this.controls.update(); this.camera.updateMatrixWorld();
  }
  getCamera() { return { position: this.camera.position.toArray(), target: this.controls.target.toArray(), near: this.camera.near, far: this.camera.far }; }
  setCamera(c: { position: number[]; target: number[]; near: number; far: number }) {
    this.camera.position.fromArray(c.position); this.controls.target.fromArray(c.target);
    this.camera.near = c.near; this.camera.far = c.far; this.camera.updateProjectionMatrix(); this.controls.update(); this.camera.updateMatrixWorld();
  }

  snapshot(): string { return this.renderer.domElement.toDataURL('image/png'); }
}

/** App colour ramp for t ∈ [−1, 1]: blue (−1) … green (0) … yellow … red (+1). */
export function devRGB(t: number): [number, number, number] {
  if (t < 0) { const a = -t; return a < 0.5 ? [0, 0.75 + 0.25 * (1 - 2 * a), 2 * a] : [0, 1.5 * (1 - a), 1]; }
  const a = t; return a < 0.5 ? [2 * a, 0.75 + 0.25 * (1 - 2 * a), 0] : [1, 1.5 * (1 - a), 0];
}
