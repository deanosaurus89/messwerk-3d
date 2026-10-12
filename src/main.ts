// MessWerk 3D – Benutzeroberfläche (Ribbon oben, Baumansicht links, 3D-Szene Mitte,
// Dialogbereich rechts, Prüfmerkmal-Liste unten; auf Telefonen als Overlays).
import { Engine } from './engine';
import { Viewer, Hit } from './viewer';
import { FitResult, GeomType } from './core/fit';
import {
  Control, ControlKind, Feature, availableControls, computeDistance, controlLabel, controlsCSV,
  defaultTolerance, evaluate, featureCSV, DEG, FORM_NAME, AuxPlane, controlCatalog,
} from './core/features';
import { Report, buildReport, reportCSV, reportHTML, reportTablesHTML } from './core/report';
import type { LabelSpec } from './overlay';
import { ICON } from './icons';

type FitMode = { kind: 'fit'; type: GeomType | 'auto'; method: 'Klick' | 'Pinsel' };
type DistMode = { kind: 'dist'; a: number | null; b: number | null; slot: 0 | 1 };
type Mode = FitMode | DistMode | null;
interface FeatureView extends Feature { color: number; indices: Uint32Array; candidates?: { type: string; rms: number }[]; auxIndices?: Uint32Array; }
interface PreviewAux { plane: FitResult; indices: Uint32Array; source: string; refId?: number; }
interface Preview { fit: FitResult; indices: Uint32Array; candidates: { type: string; rms: number }[]; method: 'Klick' | 'Pinsel' | 'Konstruiert'; refs?: number[];
  aux?: PreviewAux; hit?: Hit; }
type V3 = [number, number, number];

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const engine = new Engine();
const viewer = new Viewer($('#scene'));
const canvas = viewer.renderer.domElement;
const PALETTE = [0xe6194b, 0x3cb44b, 0x4363d8, 0xf58231, 0x911eb4, 0x00a3a3, 0xf032e6, 0x9a6324, 0x2f4f4f, 0x808000, 0x000075, 0xaa6e28];
const PREVIEW_COLOR = 0xff8c00;   // Merkmalspunkte der Vorschau (orange)
const AUX_COLOR = 0x2f7bff;       // Punkte der Hilfsebene (blau)

const state = {
  data: null as null | { name: string; vertexCount: number; triCount: number; diag: number },
  features: [] as FeatureView[],
  controls: [] as Control[],
  sel: [] as number[],
  selControl: null as number | null,
  mode: null as Mode,
  preview: null as Preview | null,
  opts: { maxAngleDeg: 20, radius: 0, brush: 3, aux: 'auto' as 'auto' | 'none' | number },
  hidden: new Set<number>(), modelVisible: true, showLabels: true,
  labelOffsets: new Map<number, V3>(),
  reports: [] as Report[], nextReport: 1, openReport: null as number | null,
  ctab: 'katalog' as 'katalog' | 'liste',
  brushMask: null as Uint8Array | null,
  brushCount: 0,
  showPrims: true, colorPts: true,
  nextId: 1, nextCtrl: 1, typeCount: {} as Record<string, number>,
  addFeat: null as number | null,
};
(window as any).__app = { state, viewer, engine };

const featMap = () => new Map<number, Feature>(state.features.map((f) => [f.id, f]));
const fmt = (v: number | null | undefined, d = 4) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));
const sgn = (v: number, d = 4) => (v >= 0 ? '+' : '') + v.toFixed(d);
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const rgb = (c: number) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
const nameOf = (id: number | null) => state.features.find((f) => f.id === id)?.name ?? '—';
const isPhone = () => matchMedia('(max-width: 900px), (max-height: 560px)').matches;

function status(t: string) { $('#status').textContent = t; }
function hint(t: string) { $('#hint').textContent = t; }
let toastTimer = 0;
function toast(t: string) {
  const e = $('#toast'); e.textContent = t; e.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => e.classList.add('hidden'), 2600);
  status(t);
}
async function busy<T>(p: Promise<T>): Promise<T> {
  $('#busy').classList.remove('hidden');
  try { return await p; } finally { $('#busy').classList.add('hidden'); }
}

// ------------------------------------------------------------------ Ribbon
document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll<HTMLElement>('.panel').forEach((p) => p.classList.toggle('hidden', p.dataset.tab !== b.dataset.tab));
}));
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => (b.onclick = () => viewer.view(b.dataset.view as any)));
$('#ico-dist').innerHTML = ICON['Abstand 3D'];

const TYPES: (GeomType | 'auto')[] = ['auto', 'Ebene', 'Kreis', 'Zylinder', 'Langloch', 'Kegel', 'Kugel', 'Punkt'];
const FIT_TYPES = TYPES.filter((t) => t !== 'auto') as GeomType[];
const typeBtns = $('#feat-type-btns');
for (const t of TYPES) {
  const b = document.createElement('button');
  b.className = 'big'; b.dataset.ftype = t;
  b.innerHTML = `<span class="ico">${ICON[t]}</span>${t === 'auto' ? 'Automatisch' : t}`;
  b.onclick = () => startFitMode(t);
  typeBtns.appendChild(b);
}
$('#btn-distance').onclick = () => startDistanceMode();

function startFitMode(t: GeomType | 'auto') {
  if (!state.data) { status('Bitte zuerst ein Polygonmodell laden.'); return; }
  const method = state.mode?.kind === 'fit' ? state.mode.method : 'Klick';
  state.mode = { kind: 'fit', type: t, method };
  state.preview = null; clearBrush(); renderAll();
}
function startDistanceMode() {
  if (state.features.filter((f) => f.type !== 'Abstand').length < 2) { toast('Für einen Abstand werden zwei Merkmale benötigt.'); return; }
  const s = state.sel.filter((id) => state.features.find((f) => f.id === id)?.type !== 'Abstand');
  state.mode = { kind: 'dist', a: s[0] ?? null, b: s[1] ?? null, slot: s[0] != null && s[1] == null ? 1 : 0 };
  state.preview = null; clearBrush();
  updateDistancePreview(); renderAll();
  if (isPhone()) togglePanel('dialog', true);
}
function stopMode() {
  state.mode = null; state.preview = null; clearBrush();
  viewer.controls.enabled = true; viewer.showCursor(null, 1); renderAll();
}

$('#file').onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
  await loadBuffer(f.name, await f.arrayBuffer());
  (e.target as HTMLInputElement).value = '';
};
$('#btn-sample').onclick = async () => {
  status('Lade Beispiel …');
  const r = await fetch('./samples/beispielteil.stl');
  await loadBuffer('beispielteil.stl', await r.arrayBuffer());
};
$('#btn-csv').onclick = () => download('pruefmerkmale.csv', controlsCSV(state.controls, featMap()));
$('#btn-report').onclick = () => makeReport();
$('#btn-report2').onclick = () => makeReport();
$('#btn-toggle-labels').onclick = () => { state.showLabels = !state.showLabels; renderScene(); renderRibbon(); };
$('#btn-csv-feat').onclick = () => download('merkmale.csv', featureCSV(state.features));
$('#btn-delete-feat').onclick = () => deleteSelected();
$('#btn-toggle-prims').onclick = () => { state.showPrims = !state.showPrims; renderScene(); renderRibbon(); };
$('#btn-toggle-pts').onclick = () => { state.colorPts = !state.colorPts; renderScene(); renderRibbon(); };

function download(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  status(`${name} exportiert.`);
}

async function loadBuffer(name: string, buf: ArrayBuffer) {
  try {
    const t0 = performance.now();
    const r = await busy(engine.call<any>({ op: 'load', name, buffer: buf }, [buf]));
    viewer.setModel(r.positions, r.indices, r.normals);
    state.data = { name: r.name, vertexCount: r.vertexCount, triCount: r.triCount, diag: r.bounds.diag };
    state.features = []; state.controls = []; state.sel = []; state.mode = null; state.preview = null;
    state.hidden.clear(); state.labelOffsets.clear(); state.modelVisible = true; state.typeCount = {};
    state.opts.brush = +(r.bounds.diag / 25).toFixed(1);
    $('#projname').textContent = r.name;
    status(`${name} geladen in ${((performance.now() - t0) / 1000).toFixed(1)} s.`);
    $('#stats').textContent = `${r.vertexCount} Punkte · ${r.triCount} Dreiecke`;
    renderAll();
  } catch (e: any) { status('Fehler beim Import: ' + e.message); }
}

// ------------------------------------------------------------------ 3D-Interaktion
let down: { x: number; y: number; t: number } | null = null;
let painting = false;
canvas.addEventListener('pointerdown', (e) => {
  document.body.classList.remove('show-tree', 'show-dialog');
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
  if (state.mode?.kind === 'fit' && state.mode.method === 'Pinsel' && e.isPrimary && (e.pointerType !== 'mouse' || e.button === 0)) {
    const h = viewer.pick(e.clientX, e.clientY);
    if (h) { painting = true; viewer.controls.enabled = false; brushAt(h); }
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (state.mode?.kind !== 'fit' || state.mode.method !== 'Pinsel') return;
  const h = viewer.pick(e.clientX, e.clientY);
  viewer.showCursor(h, state.opts.brush);
  if (painting && h) brushAt(h);
});
window.addEventListener('pointerup', async (e) => {
  if (painting) { painting = false; viewer.controls.enabled = true; down = null; return; }
  if (!down || e.target !== canvas) { down = null; return; }
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
  down = null;
  if (moved > 8 || dt > 700) return;
  const h = viewer.pick(e.clientX, e.clientY);
  if (!h) return;
  if (state.mode?.kind === 'fit' && state.mode.method === 'Klick') await previewByClick(h);
  else if (state.mode?.kind === 'dist') pickFeatureForDistance(h);
  else { const f = featureAtHit(h); if (f) selectFeature(f.id); }
});

/** Merkmal, dessen Punktmenge den getroffenen Dreiecksknoten enthält (Indizes sind sortiert). */
function featureAtHit(h: Hit): FeatureView | null {
  const idx = (viewer.model!.geometry.index!.array as Uint32Array);
  const vs = [idx[3 * h.tri], idx[3 * h.tri + 1], idx[3 * h.tri + 2]];
  const has = (arr: Uint32Array, v: number) => { let lo = 0, hi = arr.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] === v) return true; arr[m] < v ? (lo = m + 1) : (hi = m - 1); } return false; };
  for (let i = state.features.length - 1; i >= 0; i--) {
    const f = state.features[i];
    if (f.type !== 'Abstand' && !state.hidden.has(f.id) && vs.some((v) => has(f.indices, v))) return f;
  }
  // sonst: nächster Mittelpunkt in der Nähe
  let best: FeatureView | null = null, bd = (state.data?.diag ?? 100) / 30;
  for (const f of state.features) if (f.type !== 'Abstand' && !state.hidden.has(f.id)) {
    const c = f.measured!.center, d = Math.hypot(c[0] - h.point[0], c[1] - h.point[1], c[2] - h.point[2]);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

let brushBusy = false;
async function brushAt(h: Hit) {
  if (brushBusy || !state.brushMask) return;
  brushBusy = true;
  try {
    const r = await engine.call<any>({ op: 'brush', center: h.point, radius: state.opts.brush, facing: h.normal });
    const add: number[] = [];
    for (const v of r.indices as Uint32Array) if (!state.brushMask[v]) { state.brushMask[v] = 1; add.push(v); state.brushCount++; }
    viewer.paint(Uint32Array.from(add), [1, 0.85, 0]); viewer.commitColors();
    renderDialog();
  } finally { brushBusy = false; }
}
function clearBrush() { state.brushMask = state.data ? new Uint8Array(state.data.vertexCount) : null; state.brushCount = 0; }

// ------------------------------------------------------------------ Vorschau
const usesAux = (t: GeomType | 'auto') => (t === 'Kreis' || t === 'Langloch') && state.opts.aux !== 'none';
async function previewWithAux(h: Hit, type: 'Kreis' | 'Langloch') {
  const ref = typeof state.opts.aux === 'number' ? state.features.find((f) => f.id === state.opts.aux) : undefined;
  const r = await busy(engine.call<any>({ op: 'aux', tri: h.tri, point: h.point, maxAngleDeg: state.opts.maxAngleDeg, type, plane: ref?.measured }));
  state.preview = { fit: r.fit, indices: r.indices, candidates: [], method: 'Klick', hit: h,
    aux: { plane: r.aux.plane, indices: r.aux.indices, source: ref ? ref.name : 'automatisch (angrenzende Fläche)', refId: ref?.id } };
  status(`Vorschau: ${type} in Hilfsebene – ${r.indices.length} Wandpunkte (orange), ${ref ? 'Ebene ' + ref.name : r.aux.indices.length + ' Ebenenpunkte (blau)'} (${r.ms.toFixed(0)} ms).`);
}
async function previewByClick(h: Hit) {
  const m = state.mode as FitMode;
  if (usesAux(m.type)) {
    try { await previewWithAux(h, m.type as 'Kreis' | 'Langloch'); }
    catch (e: any) { state.preview = null; status('Hilfsebene: ' + e.message); toast('Hilfsebene: ' + e.message); }
    renderAll(); return;
  }
  try {
    const r = await busy(engine.call<any>({ op: 'grow', tri: h.tri, point: h.point, maxAngleDeg: state.opts.maxAngleDeg, radius: state.opts.radius, type: m.type }));
    state.preview = { fit: r.fit, indices: r.indices, candidates: r.candidates, method: 'Klick' };
    status(`Vorschau: ${r.fit.type} aus ${r.indices.length} Punkten (${r.ms.toFixed(0)} ms). „Erzeugen“ übernimmt das Merkmal.`);
  } catch (e: any) { state.preview = null; status('Keine Geometrie gefunden: ' + e.message); }
  renderAll();
}

async function previewFromBrush() {
  if (!state.brushMask || !state.brushCount) { status('Zuerst Bereich mit dem Pinsel markieren.'); return; }
  const idx = new Uint32Array(state.brushCount); let k = 0;
  state.brushMask.forEach((v, i) => { if (v) idx[k++] = i; });
  try {
    const r = await busy(engine.call<any>({ op: 'fit', indices: idx, type: (state.mode as FitMode).type }));
    state.preview = { fit: r.fit, indices: r.indices, candidates: r.candidates, method: 'Pinsel' };
  } catch (e: any) { status('Fit fehlgeschlagen: ' + e.message); }
  renderAll();
}

async function refitPreview(t: GeomType | 'auto') {
  const p = state.preview; if (!p || p.method === 'Konstruiert') return;
  if (p.hit && (t === 'Kreis' || t === 'Langloch') && state.opts.aux !== 'none') {
    try { await previewWithAux(p.hit, t); } catch (e: any) { status('Hilfsebene: ' + e.message); }
    renderAll(); return;
  }
  try {
    const r = await busy(engine.call<any>({ op: 'fit', indices: p.indices, type: t }));
    state.preview = { ...p, aux: undefined, fit: r.fit, candidates: r.candidates.length ? r.candidates : p.candidates };
    status(`Neu gefittet als ${r.fit.type}.`);
  } catch (e: any) { status('Fit fehlgeschlagen: ' + e.message); }
  renderAll();
}

function commitPreview() {
  const p = state.preview; if (!p) return;
  const t = p.fit.type;
  const n = (state.typeCount[t] = (state.typeCount[t] ?? 0) + 1);
  const f: FeatureView = {
    id: state.nextId++, name: `${t} ${n}`, type: t, measured: p.fit, pointCount: p.indices.length,
    method: p.method, color: PALETTE[(state.nextId - 2) % PALETTE.length], indices: p.indices, candidates: p.candidates, refs: p.refs,
  };
  if (p.aux) {
    f.aux = { plane: p.aux.plane, pointCount: p.aux.indices.length, source: p.aux.source, refId: p.aux.refId } as AuxPlane;
    f.auxIndices = p.aux.indices;
  }
  state.features.push(f);
  state.preview = null; clearBrush();
  state.sel = [f.id]; state.selControl = null; state.addFeat = f.id;
  if (state.mode?.kind === 'dist') state.mode = { kind: 'dist', a: null, b: null, slot: 0 };
  renderAll();
  const node = document.querySelector<HTMLElement>(`#tree [data-fid="${f.id}"]`);
  node?.classList.add('flash'); node?.scrollIntoView({ block: 'nearest' });
  toast(`✔ ${f.name} erzeugt (${p.method === 'Konstruiert' ? 'Abstand ' + fmt(p.fit.distance, 3) + ' mm' : p.indices.length + ' Punkte'})`);
}
function discardPreview() { state.preview = null; clearBrush(); status('Vorschau verworfen.'); renderAll(); }

// ------------------------------------------------------------------ Abstand
function pickFeatureForDistance(h: Hit) {
  const f = featureAtHit(h);
  if (!f) { status('Kein Merkmal an dieser Stelle.'); return; }
  setDistanceSlot(f.id);
}
function setDistanceSlot(id: number) {
  const m = state.mode as DistMode;
  if (m.slot === 0) { m.a = id; if (m.b === id) m.b = null; m.slot = 1; }
  else { if (id === m.a) { status('Zweites Merkmal muss verschieden sein.'); return; } m.b = id; m.slot = 0; }
  updateDistancePreview();
  // Telefon: Dialog schließen, damit Vorschau (Linie + Karte) sichtbar ist
  if (state.preview && isPhone()) togglePanel('dialog', false);
  renderAll();
}
function updateDistancePreview() {
  const m = state.mode as DistMode;
  const a = state.features.find((f) => f.id === m.a), b = state.features.find((f) => f.id === m.b);
  state.preview = a && b ? { fit: computeDistance(a.measured!, b.measured!), indices: new Uint32Array(0), candidates: [], method: 'Konstruiert', refs: [a.id, b.id] } : null;
}
/** Abstände nach Änderung eines Bezugsmerkmals neu berechnen. */
function recomputeDistances() {
  for (const f of state.features) if (f.type === 'Abstand' && f.refs) {
    const a = state.features.find((x) => x.id === f.refs![0]), b = state.features.find((x) => x.id === f.refs![1]);
    if (a && b) f.measured = computeDistance(a.measured!, b.measured!);
  }
}

// ------------------------------------------------------------------ Auswahl, Prüfmerkmale
function selectFeature(id: number, additive = false) {
  if (state.mode?.kind === 'dist') { setDistanceSlot(id); return; }
  if (additive) state.sel = state.sel.includes(id) ? state.sel.filter((x) => x !== id) : [...state.sel, id].slice(-2);
  else state.sel = [id];
  state.selControl = null; state.addFeat = id;
  renderAll();
}

function addControl(kind: ControlKind, id: number) {
  const t = defaultTolerance(kind);
  state.controls.push({ id: state.nextCtrl++, kind, featureIds: [id], nominal: t.nominal, tolUp: t.up, tolLo: t.lo });
  state.selControl = state.nextCtrl - 1;
}
/** Katalog-Haken: Prüfmerkmal hinzufügen bzw. entfernen. */
function toggleControl(kind: ControlKind, id: number, on: boolean) {
  if (on) { if (!state.controls.some((c) => c.kind === kind && c.featureIds[0] === id)) addControl(kind, id); }
  else state.controls = state.controls.filter((c) => !(c.kind === kind && c.featureIds[0] === id));
  renderAll();
}

// ------------------------------------------------------------------ Berichte
function makeReport() {
  if (!state.features.length) { toast('Keine Merkmale für einen Bericht vorhanden.'); return; }
  const r = buildReport(state.nextReport++, state.features, state.controls, state.data?.name ?? '');
  state.reports.push(r); state.openReport = r.id;
  renderAll();
  toast(`✔ ${r.name} erzeugt (${r.features.length} Merkmale, ${r.controls.length} Prüfmerkmale)`);
}
function renderReport() {
  const el = $('#report-view'); const r = state.reports.find((x) => x.id === state.openReport);
  if (!r) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.innerHTML = `<div class="rv-head">${ICON.report}<b>Bericht: ${r.name}</b><span style="flex:1"></span>
    <button class="btn" id="rv-csv">CSV</button><button class="btn" id="rv-html">HTML</button><button class="btn" id="rv-print">Drucken</button>
    <button class="btn" id="rv-close">✕</button></div><div class="rv-body">${reportTablesHTML(r)}</div>`;
  ($('#rv-csv') as HTMLButtonElement).onclick = () => download(`${r.name.replace(/\s+/g, '_')}.csv`, reportCSV(r));
  ($('#rv-html') as HTMLButtonElement).onclick = () => download(`${r.name.replace(/\s+/g, '_')}.html`, reportHTML(r), 'text/html;charset=utf-8');
  ($('#rv-print') as HTMLButtonElement).onclick = () => {
    const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-9999px';
    document.body.appendChild(fr); fr.srcdoc = reportHTML(r);
    fr.onload = () => { fr.contentWindow!.focus(); fr.contentWindow!.print(); setTimeout(() => fr.remove(), 60000); };
  };
  ($('#rv-close') as HTMLButtonElement).onclick = () => { state.openReport = null; renderReport(); renderTree(); };
}

function deleteSelected() {
  if (state.selControl != null && state.controls.some((c) => c.id === state.selControl)) {
    state.controls = state.controls.filter((c) => c.id !== state.selControl); state.selControl = null;
  } else if (state.sel.length) {
    const s = new Set(state.sel);
    // abhängige Abstände mitlöschen
    for (const f of state.features) if (f.refs?.some((r) => s.has(r))) s.add(f.id);
    state.features = state.features.filter((f) => !s.has(f.id));
    state.controls = state.controls.filter((c) => !c.featureIds.some((i) => s.has(i)));
    state.sel = [];
  }
  renderAll();
}
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.key === 'Escape') { if (state.preview) discardPreview(); else stopMode(); }
  if (e.key === 'Enter' && state.preview) commitPreview();
  if (e.key === 'Delete') deleteSelected();
});

// ------------------------------------------------------------------ Telefon-Overlays
const PANELS = ['tree', 'dialog', 'table'] as const;
function togglePanel(p: (typeof PANELS)[number], on?: boolean) {
  const show = on ?? !document.body.classList.contains('show-' + p);
  if (show && p !== 'table') document.body.classList.remove('show-tree', 'show-dialog');
  document.body.classList.toggle('show-' + p, show);
  document.querySelectorAll<HTMLButtonElement>('#mobile-bar [data-panel]').forEach((b) =>
    b.classList.toggle('on', document.body.classList.contains('show-' + b.dataset.panel)));
}
document.querySelectorAll<HTMLButtonElement>('#mobile-bar [data-panel]').forEach((b) => (b.onclick = () => togglePanel(b.dataset.panel as any)));
for (const [id, p] of [['#tree-pane', 'tree'], ['#dialog-pane', 'dialog'], ['#table-pane', 'table']] as const) {
  const t = document.querySelector(id + ' .pane-title')!;
  const x = document.createElement('button'); x.className = 'panel-close'; x.textContent = '✕'; x.title = 'Schließen';
  x.onclick = () => togglePanel(p, false); t.prepend(x);
}

// ------------------------------------------------------------------ Darstellung
function renderAll() { renderRibbon(); renderTree(); renderDialog(); renderPreviewCard(); renderTable(); renderScene(); renderHint(); renderReport(); }

function renderRibbon() {
  document.querySelectorAll<HTMLButtonElement>('[data-ftype]').forEach((b) => b.classList.toggle('on',
    (state.mode?.kind === 'fit' && state.mode.type === b.dataset.ftype) || (state.mode?.kind === 'dist' && b.dataset.ftype === 'Abstand')));
  $('#btn-toggle-prims').classList.toggle('on', state.showPrims);
  $('#btn-toggle-pts').classList.toggle('on', state.colorPts);
  $('#btn-toggle-labels').classList.toggle('on', state.showLabels);
}

function renderHint() {
  if (!state.data) return hint('');
  const m = state.mode;
  if (!m) return hint('');
  if (m.kind === 'dist') return hint(`Abstand: ${m.slot === 0 ? 'erstes' : 'zweites'} Merkmal im 3D-Bild antippen oder im Baum/Dialog wählen.`);
  if (state.preview) return hint('Vorschau – Werte prüfen, dann „Erzeugen“ oder „Verwerfen“.');
  if (m.method === 'Klick') return hint(`${m.type === 'auto' ? 'Automatische Erkennung' : m.type}: auf die Fläche klicken/tippen.`);
  hint('Pinsel: Bereich überstreichen, dann „Fitten“.');
}

function eyeBtn(visible: boolean, onToggle: () => void) {
  const b = document.createElement('button'); b.className = 'eye' + (visible ? '' : ' off'); b.title = visible ? 'Ausblenden' : 'Einblenden';
  b.innerHTML = visible ? ICON.eye : ICON.eyeOff;
  b.onclick = (e) => { e.stopPropagation(); onToggle(); };
  return b;
}
function renderTree() {
  const q = ($('#search') as HTMLInputElement).value.trim().toLowerCase();
  const t = $('#tree'); t.innerHTML = '';
  const node = (html: string, cls: string, onClick?: (e: MouseEvent) => void, sel = false, fid?: number, eye?: HTMLElement) => {
    const d = document.createElement('div'); d.className = `node ${cls}${sel ? ' sel' : ''}`; d.innerHTML = html;
    if (eye) d.prepend(eye);
    if (fid != null) d.dataset.fid = String(fid);
    if (onClick) d.onclick = onClick; t.appendChild(d); return d;
  };
  node(`<span class="tw">▾</span>${ICON.folder}<b>Objekte</b>`, '');
  node(`<span class="tw">▾</span>${ICON.data}Daten`, 'indent1');
  if (state.data) node(`<span class="tw"></span>${ICON.mesh}${state.data.name} <span class="sub">(Polygonmodell)</span>`, 'indent2 model-node', undefined, false, undefined,
    eyeBtn(state.modelVisible, () => { state.modelVisible = !state.modelVisible; renderTree(); renderScene(); }));
  node(`<span class="tw">▾</span>${ICON.folder}Merkmale (${state.features.length})`, 'indent1');
  const distSlots = state.mode?.kind === 'dist' ? [state.mode.a, state.mode.b] : [];
  for (const f of state.features) {
    if (q && !f.name.toLowerCase().includes(q) && !f.type.toLowerCase().includes(q)) continue;
    const ico = f.type === 'Abstand' ? ICON['Abstand 3D'] : ICON[f.type];
    const tag = distSlots.includes(f.id) ? ` <span class="sub">[${distSlots.indexOf(f.id) === 0 ? 'A' : 'B'}]</span>` : '';
    const sel = state.sel.includes(f.id), vis = !state.hidden.has(f.id);
    node(`<span class="tw">▾</span><span style="color:${hex(f.color)}">${ico}</span>${f.name}${tag}`,
      'indent2' + (vis ? '' : ' hidden-feat'), (e) => selectFeature(f.id, e.ctrlKey || e.metaKey || e.shiftKey), sel, f.id,
      eyeBtn(vis, () => { vis ? state.hidden.add(f.id) : state.hidden.delete(f.id); renderTree(); renderScene(); }));
    // nur Komponenten: Ist (gemessen), Hilfsebene, Soll (Nominal) – keine Prüfmerkmale
    if (f.measured) node(`<span class="tw"></span>${ICON.ist}Ist${f.type === 'Abstand' ? ` <span class="sub">${fmt(f.measured.distance, 3)} mm</span>` : ''}`, 'indent3', () => selectFeature(f.id));
    if (f.aux) node(`<span class="tw"></span>${ICON.aux}Hilfsebene <span class="sub">${f.aux.refId ? '(' + nameOf(f.aux.refId) + ')' : ''}</span>`, 'indent3 aux-node', () => selectFeature(f.id));
    if (f.nominal) node(`<span class="tw"></span>${ICON.soll}Soll`, 'indent3', () => selectFeature(f.id));
  }
  if (state.reports.length) {
    node(`<span class="tw">▾</span>${ICON.folder}Berichte (${state.reports.length})`, 'indent1');
    for (const r of state.reports) node(`<span class="tw"></span>${ICON.report}${r.name} <span class="sub">${r.created}</span>`, 'indent2 report-node',
      () => { state.openReport = r.id; renderReport(); renderTree(); if (isPhone()) togglePanel('tree', false); }, state.openReport === r.id);
  }
}
($('#search') as HTMLInputElement).oninput = () => renderTree();

function numInput(v: number | null, onChange: (x: number | null) => void) {
  const i = document.createElement('input'); i.type = 'text'; i.inputMode = 'decimal';
  i.value = v == null ? '' : String(v);
  i.onchange = () => { const s = i.value.replace(',', '.').trim(); const x = s === '' ? null : Number(s); if (s === '' || isFinite(x!)) onChange(x); renderAll(); };
  return i;
}

/** Kennwerte einer Ist-Geometrie (Vorschau und Eigenschaften). */
function fitRows(m: FitResult, pointCount: number, full = true): [string, string][] {
  if (m.type === 'Abstand') {
    return [['Abstand 3D', fmt(m.distance)], ['Abstand X', fmt(Math.abs(m.delta![0]))], ['Abstand Y', fmt(Math.abs(m.delta![1]))], ['Abstand Z', fmt(Math.abs(m.delta![2]))],
      ['Regel', m.rule!], ['P1', m.p1!.map((v) => v.toFixed(3)).join(' ')], ['P2', m.p2!.map((v) => v.toFixed(3)).join(' ')]];
  }
  const rows: [string, string][] = [];
  if (full) rows.push(['Punkte', String(pointCount)]);
  rows.push(['Std.-Abw. (RMS)', fmt(m.rms)], [FORM_NAME[m.type], fmt(m.form)], ['Max. +', sgn(m.maxPos)], ['Max. −', sgn(m.maxNeg)]);
  if (m.outliers) rows.push(['Ausreißer entfernt', String(m.outliers)]);
  if (m.diameter != null && m.type !== 'Langloch') rows.push(['Durchmesser', fmt(m.diameter)]);
  if (m.type === 'Langloch') rows.push(['Länge', fmt(m.length)], ['Breite', fmt(m.width)]);
  if (m.type === 'Kegel') rows.push(['Kegelwinkel [°]', fmt(2 * m.halfAngle! * DEG, 3)]);
  if (full) {
    rows.push(['X', fmt(m.center[0])], ['Y', fmt(m.center[1])], ['Z', fmt(m.center[2])], ['I', fmt(m.normal[0], 6)], ['J', fmt(m.normal[1], 6)], ['K', fmt(m.normal[2], 6)]);
    if (m.type === 'Zylinder' || m.type === 'Kegel') rows.push(['Höhe', fmt(m.length)]);
    if (m.type === 'Langloch') rows.push(['Richtung', m.direction!.map((v) => v.toFixed(4)).join(' ')]);
    if (m.type === 'Kegel') rows.push(['Spitze', m.apex!.map((v) => v.toFixed(3)).join(' ')]);
  }
  return rows;
}
const kv = (rows: [string, string][]) => `<div class="kv">${rows.map(([k, v]) => `<div>${k}</div><div>${v}</div>`).join('')}</div>`;

/** Zweifarbige Vorschau: Kennwerte von Merkmal (orange) und Hilfsebene (blau). */
function auxStats(p: Preview): string {
  const m = p.fit, pl = p.aux!.plane;
  const size: [string, string][] = m.type === 'Langloch' ? [['Länge', fmt(m.length)], ['Breite', fmt(m.width)]] : [['Durchmesser', fmt(m.diameter)]];
  return `<div class="aux-stats"><div class="as-col"><div class="as-h"><i style="background:${hex(PREVIEW_COLOR)}"></i>${m.type} (Wand)</div>
    ${kv([['Punkte', String(p.indices.length)], ['RMS', fmt(m.rms)], [FORM_NAME[m.type], fmt(m.form)], ...size])}</div>
    <div class="as-col"><div class="as-h"><i style="background:${hex(AUX_COLOR)}"></i>Hilfsebene</div>
    ${kv([['Punkte', p.aux!.refId ? '(' + nameOf(p.aux!.refId) + ')' : String(p.aux!.indices.length)], ['RMS', fmt(pl.rms)], ['Ebenheit', fmt(pl.form)], ['Normale', pl.normal.map((v) => v.toFixed(3)).join(' ')]])}</div></div>`;
}
function renderPreviewCard() {
  const c = $('#preview-card'); const p = state.preview;
  if (!p) { c.classList.add('hidden'); c.innerHTML = ''; document.body.classList.remove('previewing'); return; }
  c.classList.remove('hidden');
  const m = p.fit;
  document.body.classList.add('previewing');
  const ico = m.type === 'Abstand' ? ICON['Abstand 3D'] : ICON[m.type];
  const typeSel = p.method === 'Konstruiert' ? '' :
    `<select id="pc-type">${['auto', ...FIT_TYPES].map((t) => `<option value="${t}" ${t === m.type ? 'selected' : ''}>${t === 'auto' ? 'Auto' : t}</option>`).join('')}</select>`;
  c.innerHTML = `<div class="pc-head">${ico}<span>Vorschau: ${m.type}</span><span style="flex:1"></span>${typeSel}</div>
    ${p.method === 'Konstruiert' ? `<div class="pc-n">${fmt(m.distance, 4)} mm</div><div class="note">${nameOf(p.refs![0])} → ${nameOf(p.refs![1])}</div>`
      : `<div class="pc-n" id="pc-count">${p.indices.length} Punkte${p.aux ? ' <span class="sub">+ Hilfsebene</span>' : ''}</div>`}
    ${p.aux ? auxStats(p) : kv(p.method === 'Konstruiert' ? fitRows(m, 0).slice(1, 4) : fitRows(m, p.indices.length, false))}
    <div class="pc-btns"><button class="btn primary" id="pc-create">✔ Erzeugen</button><button class="btn" id="pc-discard">✕ Verwerfen</button></div>`;
  ($('#pc-create') as HTMLButtonElement).onclick = commitPreview;
  ($('#pc-discard') as HTMLButtonElement).onclick = discardPreview;
  c.querySelector<HTMLSelectElement>('#pc-type')?.addEventListener('change', (e) => refitPreview((e.target as HTMLSelectElement).value as any));
}

function renderDialog() {
  const d = $('#dialog'); d.innerHTML = '';
  const m = state.mode;
  if (m?.kind === 'dist') {
    const opts = (sel: number | null) => `<option value="">— wählen —</option>` + state.features.filter((f) => f.type !== 'Abstand')
      .map((f) => `<option value="${f.id}" ${f.id === sel ? 'selected' : ''}>${f.name}</option>`).join('');
    d.innerHTML = `<h3>${ICON['Abstand 3D']} Abstand erstellen</h3>
      <p class="note">Zwei Merkmale wählen: Dropdown, Baumansicht oder Antippen im 3D-Bild (aktives Feld ist blau).</p>
      <div class="dist-slot ${m.slot === 0 ? 'active' : ''}" data-slot="0"><b>Merkmal A</b><div class="row"><select id="d-a">${opts(m.a)}</select></div></div>
      <div class="dist-slot ${m.slot === 1 ? 'active' : ''}" data-slot="1"><b>Merkmal B</b><div class="row"><select id="d-b">${opts(m.b)}</select></div></div>
      ${state.preview ? `<h4>Ergebnis (Ist)</h4>${kv(fitRows(state.preview.fit, 0))}
        <button class="btn primary" id="d-create">✔ Erzeugen</button><button class="btn" id="d-discard">Verwerfen</button>` : ''}
      <p class="note">Regel: Mittelpunkt–Mittelpunkt; ist eine Ebene beteiligt, wird der Mittelpunkt des anderen Merkmals senkrecht auf die Ebene projiziert (Punkt-Ebene-Abstand). X/Y/Z = Beträge der Komponenten.</p>
      <div><button class="btn" id="d-close">Schließen</button></div>`;
    d.querySelectorAll<HTMLElement>('.dist-slot').forEach((el) => (el.onclick = (e) => { if ((e.target as HTMLElement).tagName === 'SELECT') return; (state.mode as DistMode).slot = +el.dataset.slot! as 0 | 1; renderDialog(); renderHint(); }));
    ($('#d-a') as HTMLSelectElement).onchange = (e) => { const v = (e.target as HTMLSelectElement).value; (m as DistMode).slot = 0; if (v) setDistanceSlot(+v); else { m.a = null; updateDistancePreview(); renderAll(); } };
    ($('#d-b') as HTMLSelectElement).onchange = (e) => { const v = (e.target as HTMLSelectElement).value; (m as DistMode).slot = 1; if (v) setDistanceSlot(+v); else { m.b = null; updateDistancePreview(); renderAll(); } };
    d.querySelector('#d-create')?.addEventListener('click', commitPreview);
    d.querySelector('#d-discard')?.addEventListener('click', () => { state.mode = { kind: 'dist', a: null, b: null, slot: 0 }; state.preview = null; renderAll(); });
    ($('#d-close') as HTMLButtonElement).onclick = stopMode;
    return;
  }
  if (m?.kind === 'fit') {
    const p = state.preview;
    d.innerHTML = `<h3>${ICON[m.type]} Merkmal erstellen: ${m.type === 'auto' ? 'Automatisch' : m.type}</h3>
      <div class="seg"><button data-m="Klick" class="${m.method === 'Klick' ? 'on' : ''}">Klick + Wachstum</button><button data-m="Pinsel" class="${m.method === 'Pinsel' ? 'on' : ''}">Pinsel</button></div>
      <h4>Typ</h4><div class="row"><select id="d-type">${TYPES.map((t) => `<option ${t === m.type ? 'selected' : ''} value="${t}">${t === 'auto' ? 'Automatisch erkennen' : t}</option>`).join('')}</select></div>
      ${m.method === 'Klick' ? `<h4>Regionenwachstum</h4>
      <div class="row"><label>Max. Normalenwinkel [°]</label><input id="d-ang" value="${state.opts.maxAngleDeg}" inputmode="decimal"></div>
      <div class="row"><label>Suchradius [mm] (0 = ∞)</label><input id="d-rad" value="${state.opts.radius}" inputmode="decimal"></div>
      ${m.type === 'Kreis' || m.type === 'Langloch' ? `<h4>${ICON.aux} Hilfsebene (Projektionsebene)</h4>
      <div class="row"><select id="d-aux"><option value="auto" ${state.opts.aux === 'auto' ? 'selected' : ''}>Automatisch – angrenzende Planfläche</option>
        ${state.features.filter((f) => f.type === 'Ebene').map((f) => `<option value="${f.id}" ${state.opts.aux === f.id ? 'selected' : ''}>Vorhandene Ebene: ${f.name}</option>`).join('')}
        <option value="none" ${state.opts.aux === 'none' ? 'selected' : ''}>Keine (3D-Fit)</option></select></div>
      <p class="note">Klick nahe dem Übergang Fläche/Wand (oder nur auf die Wand): die Wandpunkte werden in die Ebene projiziert, ${m.type} wird in der Ebene gefittet. Mittelpunkt liegt in der Ebene, Orientierung = Ebenennormale.</p>` : ''}`
      : `<h4>Pinsel</h4><div class="row"><label>Pinselradius [mm]</label><input id="d-brush" value="${state.opts.brush}" inputmode="decimal"></div>
      <div class="row"><label>Markiert</label><b>${state.brushCount} Punkte</b></div>
      <button class="btn primary" id="d-fit">Fitten (Vorschau)</button><button class="btn" id="d-clear">Markierung löschen</button>`}
      ${p ? `<h4>Vorschau: ${p.fit.type}</h4>${p.aux ? auxStats(p) : ''}${kv(fitRows(p.fit, p.indices.length))}
        ${p.candidates.length ? `<h4>Erkennung (RMS je Typ)</h4>${kv(p.candidates.map((c) => [c.type, fmt(c.rms)] as [string, string]))}` : ''}
        <div class="row"><select id="d-retype">${['auto', ...FIT_TYPES].map((t) => `<option value="${t}" ${t === p.fit.type ? 'selected' : ''}>${t === 'auto' ? 'Automatisch' : t}</option>`).join('')}</select><button class="btn" id="d-refit">Neu fitten</button></div>
        <button class="btn primary" id="d-create">✔ Erzeugen</button><button class="btn" id="d-discard">✕ Verwerfen</button>`
      : `<p class="note">Klick erzeugt zunächst eine <b>Vorschau</b> (Punkte + Geometrie + Kennwerte). Erst „Erzeugen“ legt das Merkmal an.</p>`}
      <div><button class="btn" id="d-close">Schließen</button></div>`;
    d.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => (b.onclick = () => { (state.mode as FitMode).method = b.dataset.m as any; state.preview = null; clearBrush(); renderAll(); }));
    ($('#d-type') as HTMLSelectElement).onchange = (e) => { (state.mode as FitMode).type = (e.target as HTMLSelectElement).value as any; if (state.preview) refitPreview((state.mode as FitMode).type); else renderAll(); };
    const bind = (id: string, key: 'maxAngleDeg' | 'radius' | 'brush') => { const el = d.querySelector<HTMLInputElement>(id); if (el) el.onchange = () => { const x = Number(el.value.replace(',', '.')); if (isFinite(x)) state.opts[key] = x; }; };
    bind('#d-ang', 'maxAngleDeg'); bind('#d-rad', 'radius'); bind('#d-brush', 'brush');
    d.querySelector<HTMLSelectElement>('#d-aux')?.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value; state.opts.aux = v === 'auto' || v === 'none' ? v : +v;
      if (state.preview?.hit) refitPreview(state.preview.fit.type); else renderAll();
    });
    d.querySelector('#d-fit')?.addEventListener('click', previewFromBrush);
    d.querySelector('#d-clear')?.addEventListener('click', () => { clearBrush(); state.preview = null; renderAll(); });
    d.querySelector('#d-refit')?.addEventListener('click', () => refitPreview(($('#d-retype') as HTMLSelectElement).value as any));
    d.querySelector('#d-create')?.addEventListener('click', commitPreview);
    d.querySelector('#d-discard')?.addEventListener('click', discardPreview);
    ($('#d-close') as HTMLButtonElement).onclick = stopMode;
    return;
  }
  const f = state.features.find((x) => x.id === state.sel[0]);
  if (!f) {
    d.innerHTML = state.data
      ? `<h3>Polygonmodell</h3>${kv([['Name', state.data.name], ['Punkte', String(state.data.vertexCount)], ['Dreiecke', String(state.data.triCount)]])}
        <p class="note">Register <b>Merkmale</b>: Typ wählen (oder „Automatisch“), auf das Netz klicken, Vorschau prüfen, <b>Erzeugen</b>. Prüfmerkmale werden in der Prüfmerkmal-Liste hinzugefügt.</p>`
      : `<h3>Willkommen</h3><p class="note">Polygonmodell (STL, PLY, OBJ) oder Punktwolke (XYZ) importieren oder <b>Beispiel laden</b>.</p>`;
    return;
  }
  const ico = f.type === 'Abstand' ? ICON['Abstand 3D'] : ICON[f.type];
  d.innerHTML = `<h3><span style="color:${hex(f.color)}">${ico}</span> ${f.name}</h3>
    <div class="row"><label>Name</label><input id="d-name" value="${f.name}"></div>
    ${f.refs ? `<div class="note">Bezug: ${nameOf(f.refs[0])} → ${nameOf(f.refs[1])}</div>` : ''}
    <h4>Ist-Komponente</h4>${kv([['Typ', f.type], ['Methode', f.method], ...fitRows(f.measured!, f.pointCount)])}
    ${f.aux ? `<h4>${ICON.aux} Hilfsebene</h4>${kv([['Quelle', f.aux.source], ['Punkte', f.aux.refId ? '—' : String(f.aux.pointCount)], ['RMS', fmt(f.aux.plane.rms)], ['Ebenheit', fmt(f.aux.plane.form)],
      ['Punkt', f.aux.plane.center.map((v) => v.toFixed(3)).join(' ')], ['Normale', f.aux.plane.normal.map((v) => v.toFixed(5)).join(' ')]])}` : ''}
    ${f.type !== 'Abstand' && !f.aux ? `<h4>Typ ändern (Neuberechnung)</h4><div class="row"><select id="d-retype">${FIT_TYPES.map((t) => `<option ${t === f.type ? 'selected' : ''}>${t}</option>`).join('')}</select><button class="btn" id="d-refit">Neu fitten</button></div>` : ''}
    <div><button class="btn" id="d-addctrl">＋ Prüfmerkmal …</button><button class="btn" id="d-del">Merkmal löschen</button></div>`;
  ($('#d-name') as HTMLInputElement).onchange = (e) => { f.name = (e.target as HTMLInputElement).value; renderAll(); };
  ($('#d-del') as HTMLButtonElement).onclick = () => { state.selControl = null; deleteSelected(); };
  ($('#d-addctrl') as HTMLButtonElement).onclick = () => { state.addFeat = f.id; state.ctab = 'katalog'; renderTable(); togglePanel('table', true); };
  d.querySelector('#d-refit')?.addEventListener('click', async () => {
    const t = ($('#d-retype') as HTMLSelectElement).value as GeomType;
    try {
      const r = await busy(engine.call<any>({ op: 'fit', indices: f.indices, type: t }));
      f.type = r.fit.type; f.measured = r.fit;
      state.controls = state.controls.filter((c) => !(c.featureIds[0] === f.id && !availableControls(f.type).includes(c.kind)));
      recomputeDistances(); renderAll();
    } catch (e: any) { status('Fit fehlgeschlagen: ' + e.message); }
  });
}

const CTRL_SYMBOL = (c: Control, f?: Feature) => {
  if (!f) return '';
  for (const g of controlCatalog(f.type)) for (const i of g.items) if (i.kind === c.kind) return i.symbol;
  return '';
};
function renderTable() {
  const fm = featMap();
  document.querySelectorAll<HTMLButtonElement>('button[data-ctab]').forEach((b) => (b.classList.toggle('on', b.dataset.ctab === state.ctab), (b.onclick = () => { state.ctab = b.dataset.ctab as any; renderTable(); })));
  $('#table-pane').dataset.ctab = state.ctab;
  // ---------- Katalog (Checkliste nach ISO 1101) für das gewählte Merkmal
  const cat = $('#catalog'); cat.innerHTML = '';
  const cur = state.addFeat ?? state.sel[0] ?? state.features[0]?.id ?? null;
  const f = state.features.find((x) => x.id === cur);
  const head = document.createElement('div'); head.className = 'cat-head';
  head.innerHTML = `<select id="cat-feat">${state.features.length ? state.features.map((x) => `<option value="${x.id}" ${x.id === cur ? 'selected' : ''}>${x.name}</option>`).join('') : '<option>— kein Merkmal —</option>'}</select>
    <span class="note">Haken = Prüfmerkmal (erscheint im Label)</span>`;
  cat.appendChild(head);
  ($('#cat-feat') as HTMLSelectElement).onchange = (e) => { state.addFeat = +(e.target as HTMLSelectElement).value; renderTable(); };
  if (!f) { cat.insertAdjacentHTML('beforeend', '<p class="note" style="padding:6px 8px">Zuerst ein Merkmal erzeugen und auswählen.</p>'); }
  else for (const g of controlCatalog(f.type)) {
    const gd = document.createElement('div'); gd.className = 'cat-group'; gd.innerHTML = `<div class="cat-gt">${g.group}</div>`;
    for (const it of g.items) {
      const c = state.controls.find((k) => k.kind === it.kind && k.featureIds[0] === f.id);
      const row = document.createElement('div'); row.className = 'cat-item' + (c ? ' on' : ''); row.dataset.kind = it.kind;
      const r = c ? evaluate(c, fm) : null;
      const ist = r ? r.measured : evaluate({ id: 0, kind: it.kind, featureIds: [f.id], nominal: null, tolUp: 0, tolLo: 0 }, fm).measured;
      row.innerHTML = `<label><input type="checkbox" ${c ? 'checked' : ''}><span class="sym">${it.symbol}</span><span class="cl" title="${it.note ?? ''}">${it.label}</span></label>
        <span class="ist">${fmt(ist)}</span>`;
      row.querySelector('input')!.onchange = (e) => toggleControl(it.kind, f.id, (e.target as HTMLInputElement).checked);
      if (c && r) {
        const ed = document.createElement('span'); ed.className = 'cat-ed';
        const lab = (t: string, el: HTMLElement) => { const s = document.createElement('span'); s.className = 'ce'; s.innerHTML = `<small>${t}</small>`; s.appendChild(el); ed.appendChild(s); };
        lab('Soll', numInput(c.nominal, (x) => (c.nominal = x)));
        lab('Tol+', numInput(c.tolUp, (x) => (c.tolUp = x ?? 0)));
        lab('Tol−', numInput(c.tolLo, (x) => (c.tolLo = x == null ? 0 : -Math.abs(x))));
        ed.insertAdjacentHTML('beforeend', `<span class="dev ${r.status}">${r.deviation == null ? '' : sgn(r.deviation)}</span><span class="st ${r.status === '—' ? 'none' : r.status}">${r.status}</span>`);
        row.appendChild(ed);
      }
      gd.appendChild(row);
    }
    cat.appendChild(gd);
  }
  if (f && (f.type === 'Ebene' || f.type === 'Zylinder' || f.type === 'Kegel' || f.type === 'Kreis')) cat.insertAdjacentHTML('beforeend',
    '<p class="note" style="padding:2px 8px 8px">Parallelität ∥, Rechtwinkligkeit ⟂, Neigung ∠ und Position ⌖ (ISO 1101) benötigen ein Bezugssystem – hier als Winkel zu den Koordinatenachsen bzw. X/Y/Z.</p>');

  // ---------- Liste aller Prüfmerkmale
  $('#ctab-n').textContent = String(state.controls.length);
  const tb = $('#ctrl-table tbody'); tb.innerHTML = '';
  let io = 0, nio = 0;
  for (const c of state.controls) {
    const r = evaluate(c, fm); if (r.status === 'IO') io++; if (r.status === 'NIO') nio++;
    const fc = fm.get(c.featureIds[0]);
    const tr = document.createElement('tr');
    if (state.selControl === c.id) tr.className = 'sel';
    const td = (html: string | HTMLElement, cls = '') => { const e = document.createElement('td'); e.className = cls; if (typeof html === 'string') e.innerHTML = html; else e.appendChild(html); tr.appendChild(e); return e; };
    td(fc?.name ?? '?');
    td(`<span class="sym">${CTRL_SYMBOL(c, fc)}</span> ${controlLabel(c, fc)}`);
    td(numInput(c.nominal, (x) => (c.nominal = x)), 'num');
    td(fmt(r.measured), 'num');
    td(fmt(r.deviation), `num dev ${r.status}`);
    td(numInput(c.tolUp, (x) => (c.tolUp = x ?? 0)), 'num');
    td(numInput(c.tolLo, (x) => (c.tolLo = x == null ? 0 : -Math.abs(x))), 'num');
    td(`<span class="st ${r.status === '—' ? 'none' : r.status}">${r.status}</span>`);
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.title = 'Löschen';
    x.onclick = (e) => { e.stopPropagation(); state.controls = state.controls.filter((k) => k.id !== c.id); renderAll(); };
    td(x);
    tr.onclick = (e) => { if ((e.target as HTMLElement).tagName === 'INPUT') return; state.sel = [...c.featureIds]; state.selControl = c.id; state.addFeat = c.featureIds[0]; renderTree(); renderDialog(); renderScene(); renderTable(); };
    tb.appendChild(tr);
  }
  if (!state.controls.length) tb.innerHTML = `<tr><td colspan="9" class="note">Noch keine Prüfmerkmale. Im Katalog links Haken setzen.</td></tr>`;
  $('#mb-sum').textContent = state.controls.length ? `${io}/${nio}` : '';
  $('#summary').innerHTML = state.controls.length ? `${state.controls.length} · <span style="color:var(--io)">${io} IO</span> · <span style="color:var(--nio)">${nio} NIO</span>` : '';
}

/** 3D-Label: Kopf = Merkmalsname, Körper = gewählte Prüfmerkmale (Ist/Soll/Abw., IO/NIO-Farbe). */
function labelHTML(f: FeatureView, fm: Map<number, Feature>): string {
  const cs = state.controls.filter((c) => c.featureIds[0] === f.id);
  const rows = cs.map((c) => {
    const r = evaluate(c, fm);
    return `<tr class="${r.status === '—' ? '' : r.status}"><td>${CTRL_SYMBOL(c, f)} ${controlLabel(c, f)}</td><td>${fmt(r.measured, 3)}</td><td>${c.nominal == null ? '—' : fmt(c.nominal, 3)}</td><td>${r.deviation == null ? '' : sgn(r.deviation, 3)}</td></tr>`;
  }).join('');
  return `<div class="lh"><i></i>${f.name}</div>${cs.length ? `<table><tr class="lt"><th></th><th>Ist</th><th>Soll</th><th>Abw.</th></tr>${rows}</table>` : ''}`;
}

function renderScene() {
  if (!state.data) return;
  if (viewer.model) viewer.model.visible = state.modelVisible;
  const vis = (f: FeatureView) => !state.hidden.has(f.id);
  viewer.resetColors();
  if (state.colorPts) for (const f of state.features) {
    if (f.type === 'Abstand' || !vis(f)) continue;
    const c = rgb(f.color), s = state.sel.includes(f.id);
    viewer.paint(f.indices, s ? c : c.map((v) => 0.55 * v + 0.45 * 0.68));
  }
  if (state.brushMask && state.brushCount) {
    const idx: number[] = []; state.brushMask.forEach((v, i) => v && idx.push(i));
    viewer.paint(Uint32Array.from(idx), [1, 0.85, 0]);
  }
  const p = state.preview;
  if (p?.aux?.indices.length) viewer.paint(p.aux.indices, rgb(AUX_COLOR));
  if (p && p.indices.length) viewer.paint(p.indices, rgb(PREVIEW_COLOR));
  viewer.commitColors();
  viewer.clearPrims();
  if (state.showPrims) for (const f of state.features) {
    if (!vis(f)) continue;
    const sel = state.sel.includes(f.id);
    if (f.type === 'Abstand') viewer.addDistance(f.measured!.p1!, f.measured!.p2!, f.color, sel);
    else viewer.addPrimitive(f.measured!, f.color, sel);
  }
  if (p) {
    if (p.fit.type === 'Abstand') viewer.addDistance(p.fit.p1!, p.fit.p2!, PREVIEW_COLOR, true);
    else viewer.addPrimitive(p.fit, PREVIEW_COLOR, true);
    if (p.aux) viewer.addPrimitive({ ...p.aux.plane, center: p.fit.center }, AUX_COLOR, false);
  }
  // Labels
  const fm = featMap();
  const specs: LabelSpec[] = state.showLabels ? state.features.filter(vis).map((f) => {
    const m = f.measured!;
    const anchor = (f.type === 'Abstand' ? m.p1!.map((v, i) => (v + m.p2![i]) / 2) : m.center) as V3;
    return { id: f.id, anchor, html: labelHTML(f, fm), color: hex(f.color), offset: state.labelOffsets.get(f.id) ?? null, selected: state.sel.includes(f.id) };
  }) : [];
  viewer.labels.set(specs);
}
viewer.labels.onMoved = (id, off) => state.labelOffsets.set(id, off);
viewer.labels.onSelect = (id) => selectFeature(id);

renderAll();
