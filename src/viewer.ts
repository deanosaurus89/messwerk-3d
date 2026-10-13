// 3D-Szene (three.js): Polygonmodell, Merkmalsprimitive, Picking mit BVH, Ansichten.
import * as THREE from 'three';
import { NurbsInfo, evalCurve, evalSurface, insideTrim, tessellate } from './core/nurbs';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import type { FitResult } from './core/fit';
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
  paintScalar(idx: Uint32Array, val: Float32Array, r: number) {
    if (!this.colors) return;
    for (let k = 0; k < idx.length; k++) {
      const t = Math.max(-1, Math.min(1, val[k] / r)); let c: number[];
      if (t < 0) { const a = -t; c = a < 0.5 ? [0, 0.75 + 0.25 * (1 - 2 * a), 2 * a] : [0, 1.5 * (1 - a), 1]; }
      else { const a = t; c = a < 0.5 ? [2 * a, 0.75 + 0.25 * (1 - 2 * a), 0] : [1, 1.5 * (1 - a), 0]; }
      this.colors.set(c, 3 * idx[k]);
    }
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

  showCursor(hit: Hit | null, radius: number) {
    if (!hit) { this.cursor.visible = false; return; }
    this.cursor.visible = true;
    this.cursor.position.set(...hit.point);
    this.cursor.scale.setScalar(radius);
    this.cursor.lookAt(new THREE.Vector3(...hit.point).add(new THREE.Vector3(...hit.normal)));
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

  /** Abstand: Linie p1→p2, gestrichelte X/Y/Z-Komponenten, Beschriftung. */
  addDistance(p1: number[], p2: number[], color: number, selected: boolean) {
    const a = new THREE.Vector3(...p1), b = new THREE.Vector3(...p2);
    const main = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, this.radius / (selected ? 260 : 400), 6), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    main.renderOrder = 7; this.prims.add(main);
    const cx = new THREE.Vector3(b.x, a.y, a.z), cy = new THREE.Vector3(b.x, b.y, a.z);
    const legs: [THREE.Vector3, THREE.Vector3, number][] = [[a, cx, 0xd32f2f], [cx, cy, 0x2e9d3a], [cy, b, 0x1f5fa8]];
    for (const [u, v, c] of legs) {
      if (u.distanceTo(v) < 1e-6) continue;
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([u, v]),
        new THREE.LineDashedMaterial({ color: c, dashSize: this.radius / 80, gapSize: this.radius / 120, depthTest: false }));
      l.computeLineDistances(); l.renderOrder = 6; this.prims.add(l);
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
  focus(c: [number, number, number], r: number) {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const vf = (this.camera.fov * Math.PI) / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    const dist = Math.max(r, this.radius / 200) / Math.sin(Math.min(vf, hf) / 2) * 1.15;
    this.controls.target.set(...c);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
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
