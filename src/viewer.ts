// 3D-Szene (three.js): Polygonmodell, Merkmalsprimitive, Picking mit BVH, Ansichten.
import * as THREE from 'three';
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

  setModel(positions: Float32Array, indices: Uint32Array, normals: Float32Array | null) {
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
    geo.computeBoundingSphere();
    this.center.copy(geo.boundingSphere!.center); this.radius = geo.boundingSphere!.radius;
    this.ray.params.Points = { threshold: this.radius / 300 };
    this.view('iso');
  }

  resetColors() { if (!this.colors) return; for (let i = 0; i < this.colors.length / 3; i++) this.colors.set(BASE_COLOR, 3 * i); }
  paint(idx: Uint32Array, rgb: number[]) { if (!this.colors) return; for (const v of idx) this.colors.set(rgb, 3 * v); }
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

  snapshot(): string { return this.renderer.domElement.toDataURL('image/png'); }
}
