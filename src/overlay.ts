// Überlagerungen der 3D-Ansicht: Navigationswürfel (ViewCube, unten links) und 3D-Beschriftungen (Labels)
// mit automatischer Platzierung, Führungslinie und Verschieben per Ziehen (Position als 3D-Versatz gespeichert).
import * as THREE from 'three';
import type { Viewer } from './viewer';

type V3 = [number, number, number];

// ------------------------------------------------------------------ ViewCube
const FACES: [string, V3][] = [['RECHTS', [1, 0, 0]], ['LINKS', [-1, 0, 0]], ['OBEN', [0, 0, 1]], ['UNTEN', [0, 0, -1]], ['VORNE', [0, -1, 0]], ['HINTEN', [0, 1, 0]]];

export class ViewCube {
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  cube: THREE.Mesh;
  el: HTMLDivElement;
  private hl: THREE.Mesh;
  constructor(private v: Viewer) {
    const mats = FACES.map(([t]) => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d')!;
      g.fillStyle = '#e9eef4'; g.fillRect(0, 0, 128, 128);
      g.strokeStyle = '#7d8b9a'; g.lineWidth = 6; g.strokeRect(3, 3, 122, 122);
      g.fillStyle = '#22303f'; g.font = `bold ${t.length > 5 ? 22 : 26}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(t, 64, 66);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshBasicMaterial({ map: tex });
    });
    // Würfel im Y-oben-System bauen und um X drehen, damit Seitenbeschriftungen bei Z-oben aufrecht stehen
    const local = [mats[0], mats[1], mats[2], mats[3], mats[4], mats[5]];
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), local);
    this.cube.rotation.x = Math.PI / 2;
    this.scene.add(this.cube);
    const ax = new THREE.AxesHelper(1.6); ax.position.set(-1.12, -1.12, -1.12); this.scene.add(ax);
    for (const [txt, p, col] of [['X', [0.7, -1.12, -1.12], '#d32f2f'], ['Y', [-1.12, 0.7, -1.12], '#2e9d3a'], ['Z', [-1.12, -1.12, 0.7], '#1f5fa8']] as const) {
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
      g.fillStyle = col; g.font = 'bold 44px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 32, 34);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
      s.position.set(p[0], p[1], p[2]); s.scale.setScalar(0.55); this.scene.add(s);
    }
    this.hl = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x1f5fa8, transparent: true, opacity: 0.45, depthTest: false }));
    this.hl.visible = false; this.scene.add(this.hl);
    this.el = document.createElement('div'); this.el.id = 'navcube'; this.el.title = 'Navigationswürfel: Fläche, Kante oder Ecke anklicken';
    v.el.appendChild(this.el);
    const dirAt = (e: PointerEvent): V3 | null => {
      this.syncCam();
      const r = this.el.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.cam);
      const h = ray.intersectObject(this.cube, false)[0]; if (!h) return null;
      const q = h.point; const s = (x: number) => (Math.abs(x) > 0.55 ? Math.sign(x) : 0);
      const d: V3 = [s(q.x), s(q.y), s(q.z)];
      return d[0] || d[1] || d[2] ? d : null;
    };
    this.el.addEventListener('pointermove', (e) => { const d = dirAt(e); this.highlight(d); this.el.style.cursor = d ? 'pointer' : 'default'; });
    this.el.addEventListener('pointerleave', () => this.highlight(null));
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('click', (e) => { const d = dirAt(e as PointerEvent); if (d) { v.viewDir(d); this.highlight(e.pointerType === 'mouse' ? d : null); } });
  }
  highlight(d: V3 | null) {
    if (!d) { this.hl.visible = false; return; }
    this.hl.visible = true;
    // Fläche: großes Quadrat; Kante: schmaler Streifen; Ecke: kleines Quadrat
    const n = Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]);
    const len = n === 1 ? 1.3 : n === 2 ? 1.1 : 0.45;
    this.hl.scale.set(1, 1, 1);
    for (let k = 0; k < 3; k++) this.hl.scale.setComponent(k, d[k] ? 0.08 : n === 1 ? 1.3 : 1.1);
    if (n === 2) for (let k = 0; k < 3; k++) if (d[k]) this.hl.scale.setComponent(k, 0.45);
    if (n === 3) this.hl.scale.setScalar(0.45);
    this.hl.position.set(d[0] * (n === 1 ? 1.02 : n === 2 ? 0.8 : 0.8), d[1] * (n === 1 ? 1.02 : 0.8), d[2] * (n === 1 ? 1.02 : 0.8));
  }
  syncCam() {
    const q = this.v.camera.quaternion;
    this.cam.quaternion.copy(q); this.cam.position.set(0, 0, 6.2).applyQuaternion(q); this.cam.updateMatrixWorld();
  }
  render(r: THREE.WebGLRenderer) {
    const size = this.el.clientWidth; if (!size) return;
    this.syncCam();
    const host = this.v.el.getBoundingClientRect(), b = this.el.getBoundingClientRect();
    const x = b.left - host.left, y = host.bottom - b.bottom;
    r.setScissorTest(true); r.setScissor(x, y, size, size); r.setViewport(x, y, size, size);
    r.autoClear = false; r.clearDepth(); r.render(this.scene, this.cam);
    r.setScissorTest(false); r.autoClear = true;
    r.setViewport(0, 0, host.width, host.height);
  }
}

// ------------------------------------------------------------------ Labels
export interface LabelSpec { id: number; anchor: V3; html: string; color: string; offset: V3 | null; selected: boolean; }

interface LabelEl { spec: LabelSpec; el: HTMLDivElement; w: number; h: number; choice: number; cx: number; cy: number; }

export class Labels {
  root: HTMLDivElement;
  svg: SVGSVGElement;
  items = new Map<number, LabelEl>();
  onMoved: (id: number, offset: V3) => void = () => {};
  onSelect: (id: number) => void = () => {};
  private lastKey = '';
  private dragging: { id: number; dx: number; dy: number; moved: boolean; x0: number; y0: number } | null = null;
  constructor(private v: Viewer) {
    this.root = document.createElement('div'); this.root.id = 'labels';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); this.svg.id = 'leaders';
    this.root.appendChild(this.svg); v.el.appendChild(this.root);
    window.addEventListener('pointermove', (e) => this.drag(e));
    window.addEventListener('pointerup', () => {
      const d = this.dragging; this.dragging = null;
      if (d && !d.moved) this.onSelect(d.id);
    });
  }
  set(specs: LabelSpec[]) {
    const keep = new Set(specs.map((s) => s.id));
    for (const [id, it] of this.items) if (!keep.has(id)) { it.el.remove(); this.items.delete(id); }
    for (const s of specs) {
      let it = this.items.get(s.id);
      if (!it) {
        const el = document.createElement('div'); el.className = 'lbl'; el.dataset.fid = String(s.id);
        el.addEventListener('pointerdown', (e) => {
          e.stopPropagation(); e.preventDefault();
          const r = el.getBoundingClientRect();
          this.dragging = { id: s.id, dx: e.clientX - (r.left + r.width / 2), dy: e.clientY - (r.top + r.height / 2), moved: false, x0: e.clientX, y0: e.clientY };
        });
        this.root.appendChild(el);
        it = { spec: s, el, w: 0, h: 0, choice: -1, cx: 0, cy: 0 }; this.items.set(s.id, it);
      }
      it.spec = s;
      if (it.el.innerHTML !== s.html) it.el.innerHTML = s.html;
      it.el.style.setProperty('--c', s.color);
      it.el.classList.toggle('sel', s.selected);
      it.w = it.el.offsetWidth; it.h = it.el.offsetHeight;
    }
    this.lastKey = '';
    this.update();
  }
  private toScreen(p: THREE.Vector3): { x: number; y: number; ok: boolean } {
    const q = p.clone().project(this.v.camera);
    const W = this.v.el.clientWidth, H = this.v.el.clientHeight;
    return { x: ((q.x + 1) / 2) * W, y: ((1 - q.y) / 2) * H, ok: q.z < 1 && q.z > -1 };
  }
  private drag(e: PointerEvent) {
    const d = this.dragging; if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
    d.moved = true;
    const it = this.items.get(d.id)!; const r = this.v.el.getBoundingClientRect();
    const sx = e.clientX - d.dx - r.left, sy = e.clientY - d.dy - r.top;
    // Bildschirmpunkt in der Tiefe des Ankers zurückprojizieren -> 3D-Versatz bleibt bei Kameraänderungen erhalten
    const a = new THREE.Vector3(...it.spec.anchor); const z = a.clone().project(this.v.camera).z;
    const w = new THREE.Vector3((sx / r.width) * 2 - 1, -(sy / r.height) * 2 + 1, z).unproject(this.v.camera);
    const off: V3 = [w.x - a.x, w.y - a.y, w.z - a.z];
    it.spec.offset = off; this.onMoved(d.id, off); this.lastKey = ''; this.update();
  }
  /** Pro Frame: bei Kamera-/Größenänderung neu projizieren und platzieren. */
  update() {
    const cam = this.v.camera, W = this.v.el.clientWidth, H = this.v.el.clientHeight;
    const key = cam.matrixWorld.elements.map((x) => x.toFixed(5)).join() + cam.projectionMatrix.elements[0].toFixed(5) + W + 'x' + H;
    if (key === this.lastKey) return; this.lastKey = key;
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const anchors = [...this.items.values()].map((it) => ({ it, s: this.toScreen(new THREE.Vector3(...it.spec.anchor)) }));
    for (const o of anchors) placed.push({ x: o.s.x - 6, y: o.s.y - 6, w: 12, h: 12 });
    const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
      Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    let lines = '';
    // gezogene (feste) Labels zuerst, dann automatische
    anchors.sort((a, b) => Number(!!b.it.spec.offset) - Number(!!a.it.spec.offset));
    for (const { it, s } of anchors) {
      if (!s.ok) { it.el.style.display = 'none'; continue; }
      it.el.style.display = '';
      const w = it.w, h = it.h;
      let cx: number, cy: number;
      if (it.spec.offset) {
        const a = new THREE.Vector3(...it.spec.anchor).add(new THREE.Vector3(...it.spec.offset));
        const p = this.toScreen(a); cx = p.x; cy = p.y;
      } else {
        let best = Infinity, bi = 0, bx = 0, by = 0;
        for (let k = 0; k < 16; k++) {
          const ang = (-Math.PI / 4) + (k % 8) * (Math.PI / 4), dist = k < 8 ? 46 : 96;
          const dx = Math.cos(ang), dy = Math.sin(ang);
          const x = s.x + dx * (dist + w / 2), y = s.y + dy * (dist + h / 2);
          const r = { x: x - w / 2, y: y - h / 2, w, h };
          let sc = 0; for (const p of placed) sc += overlap(r, p);
          const out = Math.max(0, -r.x) + Math.max(0, r.x + w - W) + Math.max(0, -r.y) + Math.max(0, r.y + h - H);
          sc += out * 400 + (k >= 8 ? 50 : 0) + k + (k === it.choice ? -30 : 0);
          if (sc < best) { best = sc; bi = k; bx = x; by = y; }
        }
        it.choice = bi; cx = bx; cy = by;
      }
      it.cx = cx; it.cy = cy;
      placed.push({ x: cx - w / 2, y: cy - h / 2, w, h });
      it.el.style.transform = `translate(${Math.round(cx - w / 2)}px, ${Math.round(cy - h / 2)}px)`;
      // Führungslinie zum nächsten Randpunkt des Labels
      const ex = Math.min(Math.max(s.x, cx - w / 2), cx + w / 2), ey = Math.min(Math.max(s.y, cy - h / 2), cy + h / 2);
      const c = it.spec.color;
      lines += `<line x1="${s.x.toFixed(1)}" y1="${s.y.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${c}" stroke-width="1.6"/><circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="3" fill="${c}" stroke="#fff" stroke-width="1"/>`;
    }
    this.svg.innerHTML = lines;
  }
}
