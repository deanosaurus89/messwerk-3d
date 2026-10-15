// Register „Nützliche Funktionen": CAD-Flächen (STEP/IGES) anzeigen, wählen, nicht-destruktiv beschneiden und exportieren.
import * as THREE from 'three';
import type { Viewer } from './viewer';
import type { CadReq } from './cadworker';
import type { TrimOp, V3, FaceType, Tess } from './cad/occcore';

class CadEngine {
  private w: Worker | null = null; private seq = 0;
  private pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void; prog?: (t: string) => void }>();
  private make() {
    this.w = new Worker(new URL('./cadworker.ts', import.meta.url), { type: 'module' });
    this.w.onmessage = (e) => { const p = this.pending.get(e.data.id); if (!p) return; if (e.data.progress) { p.prog?.(e.data.progress.text); return; } this.pending.delete(e.data.id); e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data.result); };
    this.w.onerror = (e) => { for (const p of this.pending.values()) p.rej(new Error('CAD-Rechenkern abgestürzt: ' + (e.message || 'WASM-Fehler'))); this.pending.clear(); this.w?.terminate(); this.w = null; };
  }
  get loaded() { return !!this.w; }
  call<T = any>(req: CadReq, prog?: (t: string) => void, tr: Transferable[] = []): Promise<T> { if (!this.w) this.make(); const id = ++this.seq; return new Promise((res, rej) => { this.pending.set(id, { res, rej, prog }); this.w!.postMessage({ id, req }, tr); }); }
}

interface CadFace { id: number; type: FaceType; detail: string; area: number; center: V3; visible: boolean; tess: Tess; res: null | { tess: Tess; area: number; pieces: number }; }
type Tool = null | 'offset' | 'cut' | 'circle' | 'rect' | 'export';
export interface CadCtx {
  viewer: Viewer; toast: (t: string) => void; status: (t: string) => void; renderTree: () => void; renderDialog: () => void;
  isPhone: () => boolean; togglePanel: (p: 'tree' | 'dialog' | 'table', on?: boolean) => void; eyeBtn: (v: boolean, f: () => void) => HTMLElement; hasMesh: () => boolean;
}
const TYPE_COLOR: Record<FaceType, number> = { Ebene: 0x9fb4cc, Zylinder: 0x9cc79a, Kegel: 0xd1bb8a, Kugel: 0xc4a0d6, Torus: 0x8ccccc, NURBS: 0xd6a3a3 };
const TYPE_ICON: Record<FaceType, string> = { Ebene: '▱', Zylinder: '⌭', Kegel: '△', Kugel: '◯', Torus: '◎', NURBS: '∿' };
const OP_NAME = (o: TrimOp) => o.kind === 'offset' ? `Rand-Offset ${o.d.toFixed(2)} mm` : o.kind === 'cut' ? (o.pts.length > 2 ? `Schnitt-Polylinie (${o.pts.length - 1} Segmente)` : 'Schnittlinie') : o.shape === 'circle' ? 'Insel Kreis' : 'Insel Rechteck';

export const cad = {
  name: '', faces: [] as CadFace[], sel: new Set<number>(), hover: -1, ops: [] as TrimOp[], errors: [] as (string | null)[], undo: [] as TrimOp[][], redo: [] as TrimOp[][],
  tool: null as Tool, draft: [] as V3[], offsetD: 2, exportFmt: 'step' as 'step' | 'iges', exportAll: false, opSel: -1, busy: false, lastLoad: null as any, lastExport: null as any, showRemoved: true,
};
let X: CadCtx; const eng = new CadEngine();
const group = new THREE.Group(); const overlay = new THREE.Group(); let meshes: THREE.Mesh[] = []; let ghosts: (THREE.Mesh | null)[] = [];
const ray = new THREE.Raycaster();

function geo(t: Tess) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(t.positions, 3)); g.setAttribute('normal', new THREE.BufferAttribute(t.normals, 3)); g.setIndex(new THREE.BufferAttribute(t.indices, 1)); g.computeBoundingSphere(); g.computeBoundingBox(); return g; }
function buildFace(f: CadFace) {
  const old = meshes[f.id]; if (old) { group.remove(old); old.geometry.dispose(); } const og = ghosts[f.id]; if (og) { group.remove(og); og.geometry.dispose(); ghosts[f.id] = null; }
  const m = new THREE.Mesh(geo(f.res ? f.res.tess : f.tess), new THREE.MeshStandardMaterial({ color: TYPE_COLOR[f.type], roughness: 0.5, metalness: 0.08, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  m.userData.face = f.id; meshes[f.id] = m; group.add(m);
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
function drawOverlay(extra?: V3) {
  for (const c of [...overlay.children]) { overlay.remove(c); (c as any).geometry?.dispose?.(); }
  const pts = extra ? [...cad.draft, extra] : cad.draft; if (!pts.length) return;
  let line: V3[] = pts;
  if ((cad.tool === 'circle' || cad.tool === 'rect') && pts.length >= 2) line = outline(cad.tool, pts[0], pts[1]);
  const mk = (p: V3[], color: number) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(p.map((q) => new THREE.Vector3(...q))), new THREE.LineBasicMaterial({ color, depthTest: false, linewidth: 2 })); l.renderOrder = 20; overlay.add(l); };
  mk(line, 0xff1744);
  for (const p of cad.draft) { const s = new THREE.Mesh(new THREE.SphereGeometry(X.viewer.radius / 150, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff1744, depthTest: false })); s.position.set(...p); s.renderOrder = 21; overlay.add(s); }
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
    X.status(`Beschnitt berechnet (${r.changed.length} Flächen, ${((performance.now() - t0) / 1000).toFixed(1)} s)${bad ? ` – ${bad} Operation(en) fehlgeschlagen` : ''}`);
    if (bad) X.toast('⚠ ' + r.errors.filter(Boolean).join(' · '));
  } catch (e: any) { X.toast('Fehler: ' + e.message); }
  cad.busy = false; cadPaint(); X.renderTree(); X.renderDialog();
}
async function pushOp(op: TrimOp) { snapshot(); cad.ops.push(op); cad.opSel = cad.ops.length - 1; await apply(); }
export async function cadUndo() { const s = cad.undo.pop(); if (!s) { X.toast('Nichts rückgängig zu machen.'); return; } cad.redo.push(cad.ops); cad.ops = s; cad.opSel = -1; await apply(); }
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
    X.toast(`✔ ${file.name}: ${cad.faces.length} Flächen (${Object.entries(types).map(([k, v]) => `${v} ${k}`).join(', ')}) · ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    X.status(`CAD geladen: ${cad.faces.length} Flächen – Flächen antippen zum Wählen (Mehrfachwahl: Umschalt/Strg oder erneut antippen).`);
  } catch (e: any) { X.toast('CAD-Import fehlgeschlagen: ' + e.message); }
  cad.busy = false; document.body.classList.remove('busy'); X.renderTree(); X.renderDialog();
}
function setTool(t: Tool) {
  cad.tool = cad.tool === t ? null : t; cad.draft = []; drawOverlay(); renderCadRibbon();
  if (cad.tool && cad.tool !== 'export' && !cad.sel.size) X.toast('Zuerst Fläche(n) wählen – dann ' + (cad.tool === 'offset' ? 'Abstand eingeben' : 'im Bild zeichnen') + '.');
  else if (cad.tool === 'cut') X.toast('Schnittlinie: Punkte antippen, „Fertig" (oder Doppelklick), dann die zu entfernende Seite antippen.');
  else if (cad.tool === 'circle') X.toast('Insel Kreis: Mittelpunkt und Randpunkt antippen.');
  else if (cad.tool === 'rect') X.toast('Insel Rechteck: zwei Ecken antippen.');
  if (X.isPhone()) X.togglePanel('dialog', cad.tool === 'offset' || cad.tool === 'export');
  X.renderDialog();
}
let cutStage: 'draw' | 'side' = 'draw';
async function cadTap(x: number, y: number, add: boolean) {
  const t = cad.tool;
  if (t === 'cut') {
    if (cutStage === 'side') { const h = pickFace(x, y); if (!h) { X.toast('Seite auf der Fläche antippen.'); return; } const { D } = viewBasis();
      cutStage = 'draw'; const pts = cad.draft; cad.draft = []; drawOverlay(); await pushOp({ kind: 'cut', faces: [...cad.sel], pts, dir: D.toArray() as V3, remove: h.p }); return; }
    cad.draft.push(worldAt(x, y)); drawOverlay(); X.renderDialog(); return;
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
function finishLine() { if (cad.draft.length < 2) { X.toast('Mindestens zwei Punkte.'); return; } cutStage = 'side'; X.toast('Jetzt die Seite antippen, die entfernt werden soll.'); X.renderDialog(); }
export const cadActive = () => cad.faces.length > 0 && (!!cad.tool || !!document.querySelector('.tab.active[data-tab="nuetz"]') || !X.hasMesh());

function download(bytes: Uint8Array, name: string) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes as any], { type: 'application/octet-stream' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
export async function cadExport(fmt: 'step' | 'iges', all = cad.exportAll) {
  const ids = all || !cad.sel.size ? cad.faces.filter((f) => f.visible).map((f) => f.id) : [...cad.sel];
  if (!ids.length) { X.toast('Keine Flächen zum Exportieren.'); return; }
  cad.busy = true; X.renderDialog();
  try {
    const r = await eng.call<any>({ op: 'export', fmt, faces: ids }, (t) => X.status(t)); const base = cad.name.replace(/\.[^.]+$/, '');
    const name = `${base}_beschnitten.${fmt === 'step' ? 'stp' : 'igs'}`; download(r.bytes, name);
    cad.lastExport = { name, fmt, n: ids.length, bytes: r.bytes.length, ...r.check };
    const dev = Math.abs(r.check.area - r.check.expected) / Math.max(1e-9, r.check.expected);
    X.toast(`✔ ${name}: ${ids.length} Flächen exportiert · Prüfung: ${r.check.faces} Flächen, ${r.check.area.toFixed(1)} mm² (${(dev * 100).toFixed(2)} % Abw.), ${r.check.valid ? 'gültig' : 'UNGÜLTIG'}`);
  } catch (e: any) { X.toast('Export fehlgeschlagen: ' + e.message); }
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
  node(`<span class="tw">▾</span>📐 CAD: ${cad.name} <span class="sub">${cad.faces.length} Flächen${trimmed ? ` · ${trimmed} beschnitten` : ''}</span>`, 'indent1 cad-folder', undefined, false, undefined,
    X.eyeBtn(cad.faces.some((f) => f.visible), () => { const v = !cad.faces.some((f) => f.visible); cad.faces.forEach((f) => (f.visible = v)); cadPaint(); X.renderTree(); }));
  if (cad.ops.length) {
    node(`<span class="tw">▾</span>✂ Beschnitte (${cad.ops.length})`, 'indent2');
    cad.ops.forEach((o, k) => { const n = node(`<span class="tw"></span>${cad.errors[k] ? '⚠' : '✂'} ${OP_NAME(o)} <span class="sub">${o.faces.length} Fl.</span> <button class="cad-op-del" title="Operation entfernen">✕</button>`, 'indent3 cad-op', (e) => {
      if ((e.target as HTMLElement).classList.contains('cad-op-del')) { removeOp(k); return; } cad.opSel = cad.opSel === k ? -1 : k; cad.sel = new Set(o.faces); cadPaint(); X.renderTree(); X.renderDialog(); }, cad.opSel === k); n.title = cad.errors[k] ?? ''; });
  }
  for (const f of cad.faces) {
    const label = `Fläche ${f.id + 1}`; if (q && !(`${label} ${f.type} ${f.detail}`.toLowerCase().includes(q))) continue;
    const d = node(`<span class="tw"></span><span style="color:#${TYPE_COLOR[f.type].toString(16)}">${TYPE_ICON[f.type]}</span>${label} <span class="sub">${f.type}${f.detail ? ' · ' + f.detail : ''} · ${fmtA(f.res ? f.res.area : f.area)}${f.res ? ' ✂' : ''}</span>`, 'indent2 cad-face' + (f.visible ? '' : ' hidden-feat'),
      (e) => { if (e.shiftKey || e.ctrlKey || e.metaKey) { cad.sel.has(f.id) ? cad.sel.delete(f.id) : cad.sel.add(f.id); } else { const only = cad.sel.size === 1 && cad.sel.has(f.id); cad.sel.clear(); if (!only) cad.sel.add(f.id); } cadPaint(); X.renderTree(); X.renderDialog(); },
      cad.sel.has(f.id), undefined, X.eyeBtn(f.visible, () => { f.visible = !f.visible; cadPaint(); X.renderTree(); }));
    d.dataset.cadf = String(f.id);
  }
}
/** Dialogbereich für das Register; true, wenn gerendert. */
export function cadDialog(d: HTMLElement): boolean {
  if (!cad.faces.length && !cad.busy) { if (!document.querySelector('.tab.active[data-tab="nuetz"]')) return false; d.innerHTML = `<h3>📐 CAD-Flächen beschneiden</h3><p class="note">STEP- oder IGES-Datei öffnen (z. B. aus PolyWorks exportierte Flächen). Flächen wählen, mit Rand-Offset, Schnittlinie oder Inseln beschneiden und als STEP/IGES exportieren – das Original bleibt erhalten.</p>`; return true; }
  if (!cadActive() && !cad.sel.size) return false;
  const sel = [...cad.sel].map((i) => cad.faces[i]); const t = cad.tool; const b = cad.busy ? 'disabled' : '';
  let h = `<h3>📐 ${cad.name}</h3>`;
  if (t === 'offset') h += `<h4>Rand-Offset</h4><p class="note">Rand der gewählten Fläche(n) um den Abstand nach innen versetzen (Abstand im Raum zur Randkante, auf der Fläche). Gemeinsame Kanten mehrerer gewählter Flächen bleiben.</p>
    <div class="row"><input type="range" id="cad-d-r" min="0.1" max="10" step="0.1" value="${cad.offsetD}" style="flex:1"><input type="number" id="cad-d" min="0.01" max="100" step="0.1" value="${cad.offsetD}" style="width:5em"> mm</div>
    <div class="row"><button class="btn primary" id="cad-off-ok" ${sel.length ? '' : 'disabled'} ${b}>✔ Anwenden auf ${sel.length} Fläche(n)</button>${cad.opSel >= 0 && cad.ops[cad.opSel]?.kind === 'offset' ? `<button class="btn" id="cad-off-upd" ${b}>Gewählte Operation ändern</button>` : ''}</div>`;
  else if (t === 'cut') h += `<h4>Schnittlinie</h4><p class="note">${cutStage === 'side' ? '<b>Seite antippen</b>, die entfernt werden soll.' : 'Punkte im Bild antippen (2 = Gerade, mehr = Polylinie). Die Linie wird entlang der Blickrichtung auf die Fläche projiziert.'}</p>
    <div class="row"><b>${cad.draft.length}</b>&nbsp;Punkte</div><div class="row"><button class="btn primary" id="cad-cut-ok" ${cad.draft.length > 1 && cutStage === 'draw' ? '' : 'disabled'}>Fertig → Seite wählen</button><button class="btn" id="cad-cut-back" ${cad.draft.length ? '' : 'disabled'}>↶ Punkt</button></div>`;
  else if (t === 'circle' || t === 'rect') h += `<h4>Insel ${t === 'circle' ? 'Kreis' : 'Rechteck'}</h4><p class="note">${t === 'circle' ? 'Mittelpunkt, dann Randpunkt' : 'Erste Ecke, dann Gegenecke'} antippen – das Loch wird in Blickrichtung ausgeschnitten.</p><div class="row"><b>${cad.draft.length}</b>/2 Punkte</div>`;
  else if (t === 'export') h += `<h4>Export</h4><div class="row"><label><input type="radio" name="cad-ex" value="sel" ${cad.exportAll ? '' : 'checked'} ${cad.sel.size ? '' : 'disabled'}> gewählte (${cad.sel.size})</label><label><input type="radio" name="cad-ex" value="all" ${cad.exportAll || !cad.sel.size ? 'checked' : ''}> alle sichtbaren</label></div>
    <div class="row"><button class="btn primary" id="cad-ex-step" ${b}>STEP (AP214)</button><button class="btn primary" id="cad-ex-iges" ${b}>IGES (144)</button></div>
    ${cad.lastExport ? `<p class="note">Letzter Export: ${cad.lastExport.name} · ${cad.lastExport.n} Flächen · ${(cad.lastExport.bytes / 1024).toFixed(0)} kB<br>Prüfung (wieder eingelesen): ${cad.lastExport.faces} Flächen, ${cad.lastExport.area.toFixed(1)} mm² (erwartet ${cad.lastExport.expected.toFixed(1)}), ${cad.lastExport.valid ? '✔ gültig (BRepCheck)' : '✖ ungültig'}</p>` : ''}`;
  if (sel.length) {
    const a0 = sel.reduce((s, f) => s + f.area, 0), a1 = sel.reduce((s, f) => s + (f.res ? f.res.area : f.area), 0);
    h += `<h4>Auswahl: ${sel.length} Fläche(n)</h4><table class="kv">${sel.length === 1 ? `<tr><td>Typ</td><td>${sel[0].type}${sel[0].detail ? ' (' + sel[0].detail + ')' : ''}</td></tr>` : ''}<tr><td>Fläche original</td><td>${fmtA(a0)}</td></tr><tr><td>nach Beschnitt</td><td>${fmtA(a1)} (${((1 - a1 / a0) * 100).toFixed(1)} % entfernt)</td></tr></table>`;
  }
  h += `<div class="row"><button class="btn" id="cad-undo" ${cad.undo.length ? '' : 'disabled'} ${b}>↶ Rückgängig</button><button class="btn" id="cad-redo" ${cad.redo.length ? '' : 'disabled'} ${b}>↷</button>${t ? '<button class="btn" id="cad-close">Schließen</button>' : ''}</div>`;
  if (cad.busy) h += `<p class="note">⏳ Rechne … (${$('#status')?.textContent ?? ''})</p>`;
  d.innerHTML = h;
  const on = (id: string, f: () => void) => d.querySelector(id)?.addEventListener('click', f);
  const di = d.querySelector<HTMLInputElement>('#cad-d'), dr = d.querySelector<HTMLInputElement>('#cad-d-r');
  if (di && dr) { di.oninput = () => { const v = parseFloat(di.value); if (v > 0) { cad.offsetD = v; dr.value = String(Math.min(10, v)); } }; dr.oninput = () => { cad.offsetD = parseFloat(dr.value); di.value = dr.value; }; }
  on('#cad-off-ok', () => pushOp({ kind: 'offset', faces: [...cad.sel], d: cad.offsetD }));
  on('#cad-off-upd', async () => { snapshot(); const o = cad.ops[cad.opSel] as any; o.d = cad.offsetD; await apply(); });
  on('#cad-cut-ok', finishLine); on('#cad-cut-back', () => { cad.draft.pop(); drawOverlay(); X.renderDialog(); });
  on('#cad-ex-step', () => cadExport('step')); on('#cad-ex-iges', () => cadExport('iges'));
  d.querySelectorAll<HTMLInputElement>('[name="cad-ex"]').forEach((r) => (r.onchange = () => (cad.exportAll = r.value === 'all')));
  on('#cad-undo', () => cadUndo()); on('#cad-redo', () => cadRedo()); on('#cad-close', () => setTool(null));
  return true;
}

export function initCad(ctx: CadCtx) {
  X = ctx; ctx.viewer.scene.add(group); ctx.viewer.scene.add(overlay);
  const canvas = ctx.viewer.renderer.domElement; let down: { x: number; y: number; t: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => { if (!cadActive()) return; down = { x: e.clientX, y: e.clientY, t: performance.now() }; }, true);
  canvas.addEventListener('pointermove', (e) => {
    if (!cadActive() || e.pointerType !== 'mouse' || e.buttons) return;
    if (cad.tool && cad.tool !== 'offset' && cad.tool !== 'export' && cad.draft.length && cutStage === 'draw') drawOverlay(worldAt(e.clientX, e.clientY));
    const h = pickFace(e.clientX, e.clientY); const id = h?.id ?? -1; if (id !== cad.hover) { cad.hover = id; cadPaint(); canvas.style.cursor = id >= 0 ? 'pointer' : ''; }
  });
  window.addEventListener('pointerup', (e) => {
    if (!down || !cadActive()) { down = null; return; } const d0 = down; down = null; if (e.target !== canvas) return; (e as any).cadHandled = true;
    if (Math.hypot(e.clientX - d0.x, e.clientY - d0.y) > 8 || performance.now() - d0.t > 700) return;
    (e as any).cadHandled = true; cadTap(e.clientX, e.clientY, e.shiftKey || e.ctrlKey || e.metaKey);
  }, true);
  canvas.addEventListener('dblclick', (e) => { if (cad.tool === 'cut' && cutStage === 'draw' && cad.draft.length >= 2) { e.preventDefault(); finishLine(); } });
  window.addEventListener('keydown', (e) => {
    if (!cadActive() || (e.target as HTMLElement).tagName === 'INPUT') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopImmediatePropagation(); e.shiftKey ? cadRedo() : cadUndo(); }
    else if (e.key === 'Escape') { e.stopImmediatePropagation(); if (cad.draft.length) { cad.draft = []; cutStage = 'draw'; drawOverlay(); X.renderDialog(); } else setTool(null); }
    else if (e.key === 'Enter' && cad.tool === 'cut') finishLine();
  }, true);
  const inp = $('#cad-file') as HTMLInputElement; inp.onchange = () => { const f = inp.files?.[0]; if (f) cadOpen(f); inp.value = ''; };
  document.querySelectorAll<HTMLButtonElement>('[data-cadtool]').forEach((b) => (b.onclick = () => { if (!cad.faces.length) { X.toast('Zuerst eine STEP- oder IGES-Datei öffnen.'); return; } cutStage = 'draw'; setTool(b.dataset.cadtool as Tool); }));
  $('#btn-cad-undo').onclick = () => cadUndo();
  $('#btn-cad-reset').onclick = async () => { if (!cad.ops.length) return; snapshot(); cad.ops = []; await apply(); };
  $('#btn-cad-all').onclick = () => { const all = cad.sel.size < cad.faces.filter((f) => f.visible).length; cad.sel = new Set(all ? cad.faces.filter((f) => f.visible).map((f) => f.id) : []); cadPaint(); X.renderTree(); X.renderDialog(); };
  $('#btn-cad-removed').onclick = () => { cad.showRemoved = !cad.showRemoved; cadPaint(); renderCadRibbon(); };
  $('#btn-cad-hide').onclick = () => { if (!cad.sel.size) { cad.faces.forEach((f) => (f.visible = true)); } else { for (const i of cad.sel) cad.faces[i].visible = false; cad.sel.clear(); } cadPaint(); X.renderTree(); X.renderDialog(); };
  Object.assign((window as any).__app ?? ((window as any).__app = {}), { cad, cadOpen, cadExport, cadUndo, cadPick: pickFace, cadSetTool: setTool });
}
