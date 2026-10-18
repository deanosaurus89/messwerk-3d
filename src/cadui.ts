// Register „Nützliche Funktionen": CAD-Flächen (STEP/IGES) anzeigen, wählen, nicht-destruktiv beschneiden und exportieren.
import { setActions } from './actionbar';
import { progressBegin, progressEnd, progressUpdate } from './progress';
import * as THREE from 'three';
import type { Viewer } from './viewer';
import type { CadReq } from './cadworker';
import type { TrimOp, V3, FaceType, Tess } from './cad/occcore';

class CadEngine {
  private w: Worker | null = null; private seq = 0;
  private pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void; prog?: (t: string) => void }>();
  private make() {
    this.w = new Worker(new URL('./cadworker.ts', import.meta.url), { type: 'module' });
    this.w.onmessage = (e) => { const p = this.pending.get(e.data.id); if (!p) return; if (e.data.progress) { const g = e.data.progress; progressUpdate({ label: g.text, frac: g.frac, step: g.step, steps: g.steps }); p.prog?.(g.text); return; } this.pending.delete(e.data.id); e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data.result); };
    this.w.onerror = (e) => { for (const p of this.pending.values()) p.rej(new Error('CAD kernel crashed: ' + (e.message || 'WASM error'))); this.pending.clear(); this.w?.terminate(); this.w = null; };
  }
  get loaded() { return !!this.w; }
  call<T = any>(req: CadReq, prog?: (t: string) => void, tr: Transferable[] = []): Promise<T> { if (!this.w) this.make(); const id = ++this.seq;
    progressBegin(req.op === 'load' ? 'CAD laden' : req.op === 'apply' ? 'CAD beschneiden' : 'CAD exportieren');
    return new Promise<T>((res, rej) => { this.pending.set(id, { res, rej, prog }); this.w!.postMessage({ id, req }, tr); }).finally(progressEnd); }
}

interface CadFace { id: number; type: FaceType; detail: string; area: number; center: V3; visible: boolean; tess: Tess; res: null | { tess: Tess; area: number; pieces: number }; }
type Tool = null | 'offset' | 'cut' | 'circle' | 'rect' | 'export';
export interface CadCtx {
  viewer: Viewer; toast: (t: string) => void; status: (t: string) => void; renderTree: () => void; renderDialog: () => void;
  isPhone: () => boolean; togglePanel: (p: 'tree' | 'dialog' | 'table', on?: boolean) => void; eyeBtn: (v: boolean, f: () => void) => HTMLElement; hasMesh: () => boolean;
}
const TYPE_COLOR: Record<FaceType, number> = { Ebene: 0x9fb4cc, Zylinder: 0x9cc79a, Kegel: 0xd1bb8a, Kugel: 0xc4a0d6, Torus: 0x8ccccc, NURBS: 0xd6a3a3 };
const TYPE_ICON: Record<FaceType, string> = { Ebene: '▱', Zylinder: '⌭', Kegel: '△', Kugel: '◯', Torus: '◎', NURBS: '∿' };
const OP_NAME = (o: TrimOp) => o.kind === 'offset' ? `Boundary offset ${o.d.toFixed(2)} mm` : o.kind === 'cut' ? (o.pts.length > 2 ? `Cut polyline (${o.pts.length - 1} segments)` : 'Cut line') : o.shape === 'circle' ? 'Island circle' : 'Island rectangle';

export const cad = {
  name: '', faces: [] as CadFace[], sel: new Set<number>(), hover: -1, ops: [] as TrimOp[], errors: [] as (string | null)[], undo: [] as TrimOp[][], redo: [] as TrimOp[][],
  tool: null as Tool, draft: [] as V3[], offsetD: 2, exportFmt: 'step' as 'step' | 'iges', exportAll: false, opSel: -1, busy: false, lastLoad: null as any, lastExport: null as any, showRemoved: true,
};
let X: CadCtx; const eng = new CadEngine();
const group = new THREE.Group(); const overlay = new THREE.Group(); let meshes: THREE.Mesh[] = []; let ghosts: (THREE.Mesh | null)[] = [];
const ray = new THREE.Raycaster();

function geo(t: Tess) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(t.positions, 3)); g.setAttribute('normal', new THREE.BufferAttribute(t.normals, 3)); g.setIndex(new THREE.BufferAttribute(t.indices, 1)); g.computeBoundingSphere(); g.computeBoundingBox(); return g; }
/** CAD-Kanten (Flächenränder/Knicke) ein/aus. */
export let cadEdgesOn = true;
export function setCadEdges(on: boolean) { cadEdgesOn = on; for (const m of meshes) if (m) for (const c of m.children) if (c.userData.cadEdge) c.visible = on; }
/** Rückseite (gegen die Flächennormale) deutlich andersfarbig (ocker) zeichnen – Orientierung sichtbar. */
function backTint<M extends THREE.Material>(m: M): M {
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( gl_FrontFacing ? diffuse : diffuse * 0.3 + vec3( 0.62, 0.36, 0.08 ), opacity );'); };
  return m;
}
function buildFace(f: CadFace) {
  const old = meshes[f.id]; if (old) { group.remove(old); old.geometry.dispose(); } const og = ghosts[f.id]; if (og) { group.remove(og); og.geometry.dispose(); ghosts[f.id] = null; }
  const m = new THREE.Mesh(geo(f.res ? f.res.tess : f.tess), backTint(new THREE.MeshStandardMaterial({ color: TYPE_COLOR[f.type], roughness: 0.5, metalness: 0.08, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })));
  m.userData.face = f.id; meshes[f.id] = m; group.add(m);
  { const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), new THREE.LineBasicMaterial({ color: 0x23303d })); e.raycast = () => {}; e.userData.cadEdge = true; e.visible = cadEdgesOn; m.add(e); }
  if (f.res) { const g = new THREE.Mesh(geo(f.tess), new THREE.MeshBasicMaterial({ color: 0xe53935, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 3 })); g.raycast = () => {}; g.renderOrder = 1; ghosts[f.id] = g; group.add(g); }
}
/** Farben/Sichtbarkeit aktualisieren (Typfarbe, Hover, Auswahl, Beschnitt-Rest rot). */
export function cadPaint() {
  for (const f of cad.faces) {
    const m = meshes[f.id]; if (!m) continue; const mat = m.material as THREE.MeshStandardMaterial;
    m.visible = f.visible; const sel = cad.sel.has(f.id), hov = cad.hover === f.id;
    mat.color.setHex(sel ? 0xffb300 : TYPE_COLOR[f.type]); if (hov && !sel) mat.color.offsetHSL(0, 0, 0.12); mat.emissive.setHex(sel ? 0x3a2600 : hov ? 0x202020 : 0);
    const g = ghosts[f.id]; if (g) g.visible = f.visible && cad.showRemoved;
  }
}
let snapFirst = false;
/** Screen distance (px) from (x,y) to the first polyline vertex is below 14 → snap/close. */
function nearFirst(x: number, y: number) {
  if (cad.tool !== 'cut' || cad.draft.length < 3) return false;
  const r = X.viewer.renderer.domElement.getBoundingClientRect(), p = new THREE.Vector3(...cad.draft[0]).project(X.viewer.camera);
  return Math.hypot(r.left + (p.x + 1) / 2 * r.width - x, r.top + (1 - p.y) / 2 * r.height - y) < 14;
}
function drawOverlay(extra?: V3) {
  for (const c of [...overlay.children]) { overlay.remove(c); (c as any).geometry?.dispose?.(); }
  const pts = extra ? [...cad.draft, extra] : cad.draft; if (!pts.length) return;
  let line: V3[] = pts;
  if ((cad.tool === 'circle' || cad.tool === 'rect') && pts.length >= 2) line = outline(cad.tool, pts[0], pts[1]);
  const mk = (p: V3[], color: number) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(p.map((q) => new THREE.Vector3(...q))), new THREE.LineBasicMaterial({ color, depthTest: false, linewidth: 2 })); l.renderOrder = 20; overlay.add(l); };
  mk(line, 0xff1744);
  cad.draft.forEach((p, i) => { const big = i === 0 && snapFirst; const s = new THREE.Mesh(new THREE.SphereGeometry(X.viewer.radius / (big ? 70 : 150), 12, 10), new THREE.MeshBasicMaterial({ color: big ? 0x00c853 : 0xff1744, depthTest: false })); s.position.set(...p); s.renderOrder = 21; overlay.add(s); });
}
function viewBasis() { const v = X.viewer; const D = new THREE.Vector3(); v.camera.getWorldDirection(D); const U = v.camera.up.clone().applyQuaternion(new THREE.Quaternion()).projectOnPlane(D).normalize(); const yAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(v.camera.quaternion); return { D, U: yAxis.lengthSq() ? yAxis : U }; }
function outline(kind: 'circle' | 'rect', a: V3, b: V3): V3[] {
  const { D, U } = viewBasis(); const R = new THREE.Vector3().crossVectors(U, D).normalize().negate(); const A = new THREE.Vector3(...a), w = new THREE.Vector3(...b).sub(A).projectOnPlane(D);
  if (kind === 'circle') { const r = w.length(); const out: V3[] = []; for (let k = 0; k <= 64; k++) { const t = (k / 64) * Math.PI * 2; out.push(A.clone().addScaledVector(R, r * Math.cos(t)).addScaledVector(U, r * Math.sin(t)).toArray() as V3); } return out; }
  const x = w.dot(R), y = w.dot(U); return [A, A.clone().addScaledVector(R, x), A.clone().addScaledVector(R, x).addScaledVector(U, y), A.clone().addScaledVector(U, y), A].map((p) => p.toArray() as V3);
}
function setRay(x: number, y: number) { const r = X.viewer.renderer.domElement.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), X.viewer.camera); }
function pickFace(x: number, y: number): { id: number; p: V3 } | null {
  setRay(x, y); const h = ray.intersectObjects(meshes.filter((m) => m && m.visible), false)[0]; return h ? { id: h.object.userData.face, p: h.point.toArray() as V3 } : null;
}
/** Weltpunkt unter dem Zeiger: auf der Fläche, sonst auf der Ebene durch das Drehzentrum senkrecht zur Blickrichtung. */
function worldAt(x: number, y: number): V3 {
  const h = pickFace(x, y); if (h) return h.p; setRay(x, y); const { D } = viewBasis(); const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(D, X.viewer.controls.target);
  const q = new THREE.Vector3(); return (ray.ray.intersectPlane(pl, q) ?? X.viewer.controls.target.clone()).toArray() as V3;
}
function snapshot() { cad.undo.push(cad.ops.map((o) => JSON.parse(JSON.stringify(o)))); if (cad.undo.length > 60) cad.undo.shift(); cad.redo = []; }
async function apply() {
  cad.busy = true; X.renderDialog();
  try {
    const t0 = performance.now(); const r = await eng.call<any>({ op: 'apply', ops: cad.ops }, (t) => X.status(t));
    for (const c of r.changed) { const f = cad.faces[c.id]; f.res = c.reset ? null : { tess: c.tess, area: c.area, pieces: c.pieces }; buildFace(f); }
    cad.errors = r.errors; const bad = r.errors.filter(Boolean).length;
    X.status(`Trim computed (${r.changed.length} faces, ${((performance.now() - t0) / 1000).toFixed(1)} s)${bad ? ` – ${bad} operation(s) failed` : ''}`);
    if (bad) X.toast('⚠ ' + r.errors.filter(Boolean).join(' · '));
  } catch (e: any) { X.toast('Error: ' + e.message); }
  cad.busy = false; cadPaint(); X.renderTree(); X.renderDialog();
}
async function pushOp(op: TrimOp) { snapshot(); cad.ops.push(op); cad.opSel = cad.ops.length - 1; await apply(); }
export async function cadUndo() { const s = cad.undo.pop(); if (!s) { X.toast('Nothing to undo.'); return; } cad.redo.push(cad.ops); cad.ops = s; cad.opSel = -1; await apply(); }
export async function cadRedo() { const s = cad.redo.pop(); if (!s) return; cad.undo.push(cad.ops); cad.ops = s; await apply(); }
async function removeOp(k: number) { snapshot(); cad.ops.splice(k, 1); cad.opSel = -1; await apply(); }

export async function cadOpen(file: File) {
  const t0 = performance.now(); cad.busy = true; document.body.classList.add('busy');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer()); const first = !eng.loaded;
    const r = await eng.call<any>({ op: 'load', bytes, name: file.name }, (t) => { X.status(t); X.toast(t); }, [bytes.buffer]);
    for (const m of meshes) if (m) { group.remove(m); m.geometry.dispose(); } for (const g of ghosts) if (g) group.remove(g); meshes = []; ghosts = [];
    cad.name = file.name; cad.faces = r.faces.map((f: any) => ({ ...f, visible: true, res: null })); cad.sel.clear(); cad.ops = []; cad.undo = []; cad.redo = []; cad.errors = []; cad.tool = null; cad.draft = [];
    for (const f of cad.faces) buildFace(f); cadPaint();
    if (!X.hasMesh()) { const bs = new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere()); X.viewer.center.copy(bs.center); X.viewer.radius = bs.radius; X.viewer.view('iso'); }
    const types: Record<string, number> = {}; for (const f of cad.faces) types[f.type] = (types[f.type] ?? 0) + 1;
    cad.lastLoad = { name: file.name, faces: cad.faces.length, types, ms: r.ms, total: performance.now() - t0, firstLoad: first, tris: cad.faces.reduce((s, f) => s + f.tess.indices.length / 3, 0) };
    X.toast(`✔ ${file.name}: ${cad.faces.length} faces (${Object.entries(types).map(([k, v]) => `${v} ${k}`).join(', ')}) · ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    X.status(`CAD loaded: ${cad.faces.length} faces – tap faces to select (multi-select: Shift/Ctrl or tap again).`);
  } catch (e: any) { X.toast('CAD import failed: ' + e.message); }
  cad.busy = false; document.body.classList.remove('busy'); X.renderTree(); X.renderDialog();
}
function setTool(t: Tool) {
  cad.tool = cad.tool === t ? null : t; cad.draft = []; drawOverlay(); renderCadRibbon();
  if (cad.tool && cad.tool !== 'export' && !cad.sel.size) X.toast('Select face(s) first – then ' + (cad.tool === 'offset' ? 'enter the distance' : 'draw in the view') + '.');
  else if (cad.tool === 'cut') X.toast('Cut line: tap points, “Done” (or double-click), then tap the side to remove.');
  else if (cad.tool === 'circle') X.toast('Island circle: tap center and boundary point.');
  else if (cad.tool === 'rect') X.toast('Insel Rechteck: zwei Ecken antippen.');
  if (X.isPhone()) X.togglePanel('dialog', cad.tool === 'offset' || cad.tool === 'export');
  X.renderDialog();
}
let cutStage: 'draw' | 'side' = 'draw';
async function cadTap(x: number, y: number, add: boolean) {
  const t = cad.tool;
  if (t === 'cut') {
    if (cutStage === 'side') { const h = pickFace(x, y); if (!h) { X.toast('Tap the side on the face.'); return; } const { D } = viewBasis();
      cutStage = 'draw'; const pts = cad.draft; cad.draft = []; drawOverlay(); await pushOp({ kind: 'cut', faces: [...cad.sel], pts, dir: D.toArray() as V3, remove: h.p }); return; }
    if (nearFirst(x, y)) { closeLine(); return; }
    const w = worldAt(x, y), last = cad.draft[cad.draft.length - 1];
    if (last && Math.hypot(w[0] - last[0], w[1] - last[1], w[2] - last[2]) < 1e-6 * Math.max(1, X.viewer.radius)) return; // double-click / double tap: no duplicate vertex
    cad.draft.push(w); drawOverlay(); X.renderDialog(); return;
  }
  if (t === 'circle' || t === 'rect') {
    cad.draft.push(worldAt(x, y)); drawOverlay();
    if (cad.draft.length === 2) { const { D, U } = viewBasis(); const pts = cad.draft; cad.draft = []; drawOverlay(); await pushOp({ kind: 'island', faces: [...cad.sel], shape: t, pts, dir: D.toArray() as V3, up: U.toArray() as V3 }); }
    return;
  }
  const h = pickFace(x, y);
  if (!h) { if (!add) cad.sel.clear(); }
  else if (add || X.isPhone()) { cad.sel.has(h.id) ? cad.sel.delete(h.id) : cad.sel.add(h.id); }
  else { const only = cad.sel.size === 1 && cad.sel.has(h.id); cad.sel.clear(); if (!only) cad.sel.add(h.id); }
  cadPaint(); X.renderTree(); X.renderDialog(); document.querySelector(`[data-cadf="${h?.id}"]`)?.scrollIntoView({ block: 'nearest' });
}
/** Close the polygon (last → first) when it has ≥ 3 points, then go to the keep/remove (side) step. */
function closeLine() {
  snapFirst = false;
  // drop consecutive duplicates (zero-length edges break the cut sheet)
  const eq = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6 * Math.max(1, X.viewer.radius);
  cad.draft = cad.draft.filter((p, i, A) => i === 0 || !eq(p, A[i - 1])); const d = cad.draft;
  if (d.length >= 3 && (d[0][0] !== d[d.length - 1][0] || d[0][1] !== d[d.length - 1][1] || d[0][2] !== d[d.length - 1][2])) d.push([...d[0]] as V3);
  drawOverlay(); finishLine();
}
function finishLine() { if (cad.draft.length < 2) { X.toast('At least two points.'); return; } cutStage = 'side'; X.toast('Now tap the side to remove.'); X.renderDialog(); }
export const cadActive = () => cad.faces.length > 0 && (!!cad.tool || !!document.querySelector('.tab.active[data-tab="nuetz"]') || !X.hasMesh());

function download(bytes: Uint8Array, name: string) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes as any], { type: 'application/octet-stream' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
export async function cadExport(fmt: 'step' | 'iges', all = cad.exportAll) {
  const ids = all || !cad.sel.size ? cad.faces.filter((f) => f.visible).map((f) => f.id) : [...cad.sel];
  if (!ids.length) { X.toast('No faces to export.'); return; }
  cad.busy = true; X.renderDialog();
  try {
    const r = await eng.call<any>({ op: 'export', fmt, faces: ids }, (t) => X.status(t)); const base = cad.name.replace(/\.[^.]+$/, '');
    const name = `${base}_beschnitten.${fmt === 'step' ? 'stp' : 'igs'}`; download(r.bytes, name);
    cad.lastExport = { name, fmt, n: ids.length, bytes: r.bytes.length, ...r.check };
    const dev = Math.abs(r.check.area - r.check.expected) / Math.max(1e-9, r.check.expected);
    X.toast(`✔ ${name}: ${ids.length} faces exported · check: ${r.check.faces} faces, ${r.check.area.toFixed(1)} mm² (${(dev * 100).toFixed(2)} % dev.), ${r.check.valid ? 'valid' : 'INVALID'}`);
  } catch (e: any) { X.toast('Export failed: ' + e.message); }
  cad.busy = false; X.renderDialog();
}
function renderCadRibbon() {
  document.querySelectorAll<HTMLButtonElement>('[data-cadtool]').forEach((b) => b.classList.toggle('on', cad.tool === b.dataset.cadtool));
  ($('#btn-cad-removed') as HTMLElement)?.classList.toggle('on', cad.showRemoved);
}
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const fmtA = (a: number) => a >= 1e4 ? `${(a / 100).toFixed(0)} cm²` : `${a.toFixed(1)} mm²`;

/** Baum: Ordner „CAD-Flächen" mit Typen, Augen und Beschnitt-Operationen. */
export function cadTree(node: (html: string, cls: string, onClick?: (e: MouseEvent) => void, sel?: boolean, fid?: number, eye?: HTMLElement) => HTMLElement, q: string) {
  if (!cad.faces.length) return;
  const trimmed = cad.faces.filter((f) => f.res).length;
  node(`<span class="tw">▾</span>📐 CAD: ${cad.name} <span class="sub">${cad.faces.length} faces${trimmed ? ` · ${trimmed} trimmed` : ''}</span>`, 'indent1 cad-folder', undefined, false, undefined,
    X.eyeBtn(cad.faces.some((f) => f.visible), () => { const v = !cad.faces.some((f) => f.visible); cad.faces.forEach((f) => (f.visible = v)); cadPaint(); X.renderTree(); }));
  if (cad.ops.length) {
    node(`<span class="tw">▾</span>✂ Beschnitte (${cad.ops.length})`, 'indent2');
    cad.ops.forEach((o, k) => { const n = node(`<span class="tw"></span>${cad.errors[k] ? '⚠' : '✂'} ${OP_NAME(o)} <span class="sub">${o.faces.length} Fl.</span> <button class="cad-op-del" title="Operation entfernen">✕</button>`, 'indent3 cad-op', (e) => {
      if ((e.target as HTMLElement).classList.contains('cad-op-del')) { removeOp(k); return; } cad.opSel = cad.opSel === k ? -1 : k; cad.sel = new Set(o.faces); cadPaint(); X.renderTree(); X.renderDialog(); }, cad.opSel === k); n.title = cad.errors[k] ?? ''; });
  }
  for (const f of cad.faces) {
    const label = `Face ${f.id + 1}`; if (q && !(`${label} ${f.type} ${f.detail}`.toLowerCase().includes(q))) continue;
    const d = node(`<span class="tw"></span><span style="color:#${TYPE_COLOR[f.type].toString(16)}">${TYPE_ICON[f.type]}</span>${label} <span class="sub">${f.type}${f.detail ? ' · ' + f.detail : ''} · ${fmtA(f.res ? f.res.area : f.area)}${f.res ? ' ✂' : ''}</span>`, 'indent2 cad-face' + (f.visible ? '' : ' hidden-feat'),
      (e) => { if (e.shiftKey || e.ctrlKey || e.metaKey) { cad.sel.has(f.id) ? cad.sel.delete(f.id) : cad.sel.add(f.id); } else { const only = cad.sel.size === 1 && cad.sel.has(f.id); cad.sel.clear(); if (!only) cad.sel.add(f.id); } cadPaint(); X.renderTree(); X.renderDialog(); },
      cad.sel.has(f.id), undefined, X.eyeBtn(f.visible, () => { f.visible = !f.visible; cadPaint(); X.renderTree(); }));
    d.dataset.cadf = String(f.id);
  }
}
/** Dialogbereich für das Register; true, wenn gerendert. */
export function cadDialog(d: HTMLElement): boolean {
  setActions('cad', null);
  if (!cad.faces.length && !cad.busy) { if (!document.querySelector('.tab.active[data-tab="nuetz"]')) return false; d.innerHTML = `<h3>📐 Trim CAD faces</h3><p class="note">Open a STEP or IGES file (e.g. faces exported from PolyWorks). Select faces, trim them with boundary offset, cut line or islands and export as STEP/IGES – the original is kept.</p>`; return true; }
  if (!cadActive() && !cad.sel.size) return false;
  const sel = [...cad.sel].map((i) => cad.faces[i]); const t = cad.tool; const b = cad.busy ? 'disabled' : '';
  let h = `<h3>📐 ${cad.name}</h3><p class="note">Front side (face normal) in type color, <b style="color:#9e5c14">back side ochre</b>.</p>`;
  if (t === 'offset') h += `<h4>Boundary offset</h4><p class="note">Offset the boundary of the selected face(s) inwards by the distance (spatial distance to the boundary edge, on the face). Shared edges of several selected faces are kept.</p>
    <div class="row"><input type="range" id="cad-d-r" min="0.1" max="10" step="0.1" value="${cad.offsetD}" style="flex:1"><input type="number" data-num="abs" id="cad-d" min="0.01" max="100" step="0.1" value="${cad.offsetD}" style="width:5em"> mm</div>
    <div class="row"><button class="btn primary" id="cad-off-ok" ${sel.length ? '' : 'disabled'} ${b}>✔ Apply to ${sel.length} face(s)</button>${cad.opSel >= 0 && cad.ops[cad.opSel]?.kind === 'offset' ? `<button class="btn" id="cad-off-upd" ${b}>Change selected operation</button>` : ''}</div>`;
  else if (t === 'cut') h += `<h4>Cut line</h4><p class="note">${cutStage === 'side' ? '<b>Tap the side</b> to remove.' : 'Tap points in the view (2 = straight line, more = polyline). Tap the first point (green when snapped), right-click or ✓ to close the polygon. The line is projected onto the face along the view direction.'}</p>
    <div class="row"><b>${cad.draft.length}</b>&nbsp;points</div><div class="row"><button class="btn primary" id="cad-cut-ok" ${cad.draft.length > 1 && cutStage === 'draw' ? '' : 'disabled'}>Done → choose side</button><button class="btn" id="cad-cut-back" ${cad.draft.length ? '' : 'disabled'}>↶ Point</button></div>`;
  else if (t === 'circle' || t === 'rect') h += `<h4>Island ${t === 'circle' ? 'circle' : 'rectangle'}</h4><p class="note">Tap ${t === 'circle' ? 'the center, then a boundary point' : 'the first corner, then the opposite corner'} – the hole is cut along the view direction.</p><div class="row"><b>${cad.draft.length}</b>/2 points</div>`;
  else if (t === 'export') h += `<h4>Export</h4><div class="row"><label><input type="radio" name="cad-ex" value="sel" ${cad.exportAll ? '' : 'checked'} ${cad.sel.size ? '' : 'disabled'}> selected (${cad.sel.size})</label><label><input type="radio" name="cad-ex" value="all" ${cad.exportAll || !cad.sel.size ? 'checked' : ''}> all visible</label></div>
    <div class="row"><label>Format</label><div class="seg" role="radiogroup"><button role="radio" aria-checked="${cad.exportFmt === 'step'}" class="${cad.exportFmt === 'step' ? 'on' : ''}" data-exfmt="step">STEP (AP214)</button><button role="radio" aria-checked="${cad.exportFmt === 'iges'}" class="${cad.exportFmt === 'iges' ? 'on' : ''}" data-exfmt="iges">IGES (144)</button></div></div><div class="row"><button class="btn primary" id="cad-ex-go" ${b}>⤓ Export as ${cad.exportFmt === 'iges' ? 'IGES' : 'STEP'}</button></div>
    ${cad.lastExport ? `<p class="note">Last export: ${cad.lastExport.name} · ${cad.lastExport.n} faces · ${(cad.lastExport.bytes / 1024).toFixed(0)} kB<br>Check (re-imported): ${cad.lastExport.faces} faces, ${cad.lastExport.area.toFixed(1)} mm² (expected ${cad.lastExport.expected.toFixed(1)}), ${cad.lastExport.valid ? '✔ valid (BRepCheck)' : '✖ invalid'}</p>` : ''}`;
  if (sel.length) {
    const a0 = sel.reduce((s, f) => s + f.area, 0), a1 = sel.reduce((s, f) => s + (f.res ? f.res.area : f.area), 0);
    h += `<h4>Selection: ${sel.length} face(s)</h4><table class="kv">${sel.length === 1 ? `<tr><td>Type</td><td>${sel[0].type}${sel[0].detail ? ' (' + sel[0].detail + ')' : ''}</td></tr>` : ''}<tr><td>Area original</td><td>${fmtA(a0)}</td></tr><tr><td>after trim</td><td>${fmtA(a1)} (${((1 - a1 / a0) * 100).toFixed(1)} % removed)</td></tr></table>`;
  }
  h += `<div class="row"><button class="btn" id="cad-undo" ${cad.undo.length ? '' : 'disabled'} ${b}>↶ Undo</button><button class="btn" id="cad-redo" ${cad.redo.length ? '' : 'disabled'} ${b}>↷</button>${t ? '<button class="btn" id="cad-close">Close</button>' : ''}</div>`;
  if (cad.busy) h += `<p class="note">⏳ Rechne … (${$('#status')?.textContent ?? ''})</p>`;
  d.innerHTML = h;
  { const q = (id: string) => d.querySelector<HTMLButtonElement>(id); const drawing = t === 'cut' || t === 'circle' || t === 'rect';
    setActions('cad', t && t !== 'export' ? { label: t === 'cut' ? (cutStage === 'side' ? 'Choose side' : 'Cut line') : t === 'offset' ? 'Boundary offset' : 'Island', undo: drawing && cad.draft.length ? (q('#cad-cut-back') ?? q('#cad-undo')) : q('#cad-undo'), redo: q('#cad-redo'), ok: t === 'cut' ? q('#cad-cut-ok') : t === 'offset' ? q('#cad-off-ok') : null, cancel: q('#cad-close') } : null); }
  const on = (id: string, f: () => void) => d.querySelector(id)?.addEventListener('click', f);
  const di = d.querySelector<HTMLInputElement>('#cad-d'), dr = d.querySelector<HTMLInputElement>('#cad-d-r');
  if (di && dr) { di.oninput = () => { const v = parseFloat(di.value); if (v > 0) { cad.offsetD = v; dr.value = String(Math.min(10, v)); } }; dr.oninput = () => { cad.offsetD = parseFloat(dr.value); di.value = dr.value; }; }
  on('#cad-off-ok', () => pushOp({ kind: 'offset', faces: [...cad.sel], d: cad.offsetD }));
  on('#cad-off-upd', async () => { snapshot(); const o = cad.ops[cad.opSel] as any; o.d = cad.offsetD; await apply(); });
  on('#cad-cut-ok', closeLine); on('#cad-cut-back', () => { cad.draft.pop(); drawOverlay(); X.renderDialog(); });
  on('#cad-ex-go', () => cadExport(cad.exportFmt)); d.querySelectorAll<HTMLButtonElement>('[data-exfmt]').forEach((x) => (x.onclick = () => { cad.exportFmt = x.dataset.exfmt as 'step' | 'iges'; X.renderDialog(); }));
  d.querySelectorAll<HTMLInputElement>('[name="cad-ex"]').forEach((r) => (r.onchange = () => (cad.exportAll = r.value === 'all')));
  on('#cad-undo', () => cadUndo()); on('#cad-redo', () => cadRedo()); on('#cad-close', () => setTool(null));
  return true;
}

export function initCad(ctx: CadCtx) {
  X = ctx; ctx.viewer.scene.add(group); ctx.viewer.scene.add(overlay);
  const canvas = ctx.viewer.renderer.domElement; let down: { x: number; y: number; t: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => { if (!cadActive() || e.button !== 0) { down = null; return; } down = { x: e.clientX, y: e.clientY, t: performance.now() }; }, true);
  canvas.addEventListener('pointermove', (e) => {
    if (!cadActive() || e.pointerType !== 'mouse' || e.buttons) return;
    if (cad.tool && cad.tool !== 'offset' && cad.tool !== 'export' && cad.draft.length && cutStage === 'draw') { const sn = nearFirst(e.clientX, e.clientY); if (sn !== snapFirst) { snapFirst = sn; X.viewer.renderer.domElement.style.cursor = sn ? 'pointer' : ''; } drawOverlay(sn ? cad.draft[0] : worldAt(e.clientX, e.clientY)); }
    const h = pickFace(e.clientX, e.clientY); const id = h?.id ?? -1; if (id !== cad.hover) { cad.hover = id; cadPaint(); canvas.style.cursor = id >= 0 ? 'pointer' : ''; }
  });
  window.addEventListener('pointerup', (e) => {
    if (!down || !cadActive()) { down = null; return; } const d0 = down; down = null; if (e.target !== canvas) return; (e as any).cadHandled = true;
    if (Math.hypot(e.clientX - d0.x, e.clientY - d0.y) > 8 || performance.now() - d0.t > 700) return;
    (e as any).cadHandled = true; cadTap(e.clientX, e.clientY, e.shiftKey || e.ctrlKey || e.metaKey);
  }, true);
  window.addEventListener('mw-rclick', () => { if (cadActive() && cad.tool === 'cut' && cutStage === 'draw' && cad.draft.length >= 2) closeLine(); });
  canvas.addEventListener('dblclick', (e) => { if (cad.tool === 'cut' && cutStage === 'draw' && cad.draft.length >= 2) { e.preventDefault(); closeLine(); } });
  window.addEventListener('keydown', (e) => {
    if (!cadActive() || (e.target as HTMLElement).tagName === 'INPUT') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopImmediatePropagation(); e.shiftKey ? cadRedo() : cadUndo(); }
    else if (e.key === 'Escape') { e.stopImmediatePropagation(); if (cad.draft.length) { cad.draft = []; cutStage = 'draw'; drawOverlay(); X.renderDialog(); } else setTool(null); }
    else if (e.key === 'Enter' && cad.tool === 'cut' && cutStage === 'draw') closeLine(); // same as ✓ / right-click
  }, true);
  const inp = $('#cad-file') as HTMLInputElement; inp.onchange = () => { const f = inp.files?.[0]; if (f) cadOpen(f); inp.value = ''; };
  document.querySelectorAll<HTMLButtonElement>('[data-cadtool]').forEach((b) => (b.onclick = () => { if (!cad.faces.length) { X.toast('Open a STEP or IGES file first.'); return; } cutStage = 'draw'; setTool(b.dataset.cadtool as Tool); }));
  $('#btn-cad-undo').onclick = () => cadUndo();
  $('#btn-cad-reset').onclick = async () => { if (!cad.ops.length) return; snapshot(); cad.ops = []; await apply(); };
  $('#btn-cad-all').onclick = () => { const all = cad.sel.size < cad.faces.filter((f) => f.visible).length; cad.sel = new Set(all ? cad.faces.filter((f) => f.visible).map((f) => f.id) : []); cadPaint(); X.renderTree(); X.renderDialog(); };
  $('#btn-cad-removed').onclick = () => { cad.showRemoved = !cad.showRemoved; cadPaint(); renderCadRibbon(); };
  $('#btn-cad-hide').onclick = () => { if (!cad.sel.size) { cad.faces.forEach((f) => (f.visible = true)); } else { for (const i of cad.sel) cad.faces[i].visible = false; cad.sel.clear(); } cadPaint(); X.renderTree(); X.renderDialog(); };
  Object.assign((window as any).__app ?? ((window as any).__app = {}), { cad, cadOpen, cadExport, cadUndo, cadPick: pickFace, cadSetTool: setTool });
}
