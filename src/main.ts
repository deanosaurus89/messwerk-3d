// MessWerk 3D – Benutzeroberfläche (Ribbon oben, Baumansicht links, 3D-Szene Mitte,
// Dialogbereich rechts, Prüfmerkmal-Liste unten; auf Telefonen als Overlays).
import { Engine, PolyEngine } from './engine';
import { Viewer, Hit } from './viewer';
import { FitResult, GeomType } from './core/fit';
import {
  Control, ControlKind, Feature, availableControls, computeDistance, controlLabel, controlsCSV,
  defaultTolerance, evaluate, featureCSV, DEG, FORM_NAME, AuxPlane, controlCatalog,
} from './core/features';
import { Report, buildReport, reportCSV, reportHTML, reportTablesHTML } from './core/report';
import { DATUM_COUNT, DATUM_LETTERS, buildDRF, datumKind, dirLocal, isDatumControl, toLocal } from './core/datum';
import { datumText } from './core/features';
import { idbDel, idbGet, idbSet, packIndices, readProject, unpackIndex, writeProject } from './project';
import { Tour, TourStep } from './training';
import type { Vec3 } from './core/linalg';
import type { LabelSpec } from './overlay';
import { ICON } from './icons';
import { NurbsParams, evalSurface, insideTrim, toIGES, toJSON, toSTEP } from './core/nurbs';

type FitMode = { kind: 'fit'; type: GeomType | 'auto'; method: 'Klick' | 'Pinsel' };
type DistMode = { kind: 'dist'; a: number | null; b: number | null; slot: 0 | 1 };
type Mode = FitMode | DistMode | null;
interface FitParamsUI { k: number; nf: { on: boolean; angleDeg: number; maxPct: number }; maxAngleDeg: number; radius: number; aux: 'auto' | 'none' | number; }
interface FeatureView extends Feature { color: number; indices: Uint32Array; candidates?: { type: string; rms: number }[]; auxIndices?: Uint32Array;
  src?: Uint32Array; hit?: Hit; fp?: FitParamsUI; dev?: Float32Array; }
interface PreviewAux { plane: FitResult; indices: Uint32Array; source: string; refId?: number; }
interface Preview { fit: FitResult; indices: Uint32Array; candidates: { type: string; rms: number }[]; method: 'Klick' | 'Pinsel' | 'Konstruiert'; refs?: number[];
  aux?: PreviewAux; hit?: Hit; dev?: Float32Array; }
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
  showPrims: true, colorPts: true, devMap: true, ctrlNet: true,
  nurbs: { nu: 12, nv: 12, deg: 3, smooth: 1e-4 } as NurbsParams,
  nextId: 1, nextCtrl: 1, typeCount: {} as Record<string, number>,
  addFeat: null as number | null,
};
(window as any).__app = { state, viewer, engine, refitFeature: (...a: any[]) => (refitFeature as any)(...a) };
type PeTool = 'reduce' | 'subdiv' | 'smooth' | 'erase';
const PE_NAME: Record<PeTool, string> = { reduce: 'Dreiecksreduktion', subdiv: 'Dreiecksunterteilung', smooth: 'Glättung', erase: 'Magischer Radierer' };
const pe = {
  tool: null as PeTool | null,
  tol: 0.02, normalDeg: 10, featureDeg: 30, levels: 1, iters: 5, lambda: 0.5, smoothTol: 0.02, radius: 3,
  cmp: false, scale: 0, dev: null as Float32Array | null, devStats: null as null | { maxPos: number; maxNeg: number },
  undo: [] as { positions: Float32Array; indices: Uint32Array; label: string }[], edits: [] as string[],
  live: '', running: false, origTris: 0,
};
const polyEngine = new PolyEngine();
(window as any).__app.pe = pe;

const featMap = () => new Map<number, Feature>(state.features.map((f) => [f.id, f]));
// Punkte eines Merkmals (für Richtungs-/Lauftoleranzen mit Bezug) aus dem Netz, max. 6000, zwischengespeichert
const ptsCache = new Map<number, Vec3[]>();
function featPoints(fid: number): Vec3[] | null {
  const hit = ptsCache.get(fid); if (hit) return hit;
  const f = state.features.find((x) => x.id === fid); if (!f || !f.indices.length || !viewer.model) return null;
  const pos = viewer.model.geometry.getAttribute('position').array as Float32Array;
  const step = Math.max(1, Math.ceil(f.indices.length / 6000)), out: Vec3[] = [];
  for (let i = 0; i < f.indices.length; i += step) { const v = f.indices[i]; out.push([pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]]); }
  ptsCache.set(fid, out); return out;
}
const ctx = { points: featPoints };
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

const TYPES: (GeomType | 'auto')[] = ['auto', 'Ebene', 'Kreis', 'Zylinder', 'Langloch', 'Kegel', 'Kugel', 'Torus', 'Punkt', 'Freiformfläche'];
const FIT_TYPES = TYPES.filter((t) => t !== 'auto') as GeomType[];
const typeBtns = $('#feat-type-btns');
for (const t of TYPES) {
  const b = document.createElement('button');
  b.className = 'big'; b.dataset.ftype = t;
  b.innerHTML = `<span class="ico">${ICON[t]}</span>${t === 'auto' ? 'Automatisch' : t === 'Freiformfläche' ? 'Freiform' : t}`;
  if (t === 'Freiformfläche') b.title = 'Freiformfläche (B-Spline/NURBS) – Klick oder Pinsel';
  b.onclick = () => startFitMode(t);
  typeBtns.appendChild(b);
}
$('#btn-distance').onclick = () => startDistanceMode();

function startFitMode(t: GeomType | 'auto') {
  if (!state.data) { status('Bitte zuerst ein Polygonmodell laden.'); return; }
  pe.tool = null;
  // Typwahl im Menüband startet immer mit „Klick + Wachstum“ – ein vergessener Pinsel blockiert so nie die Extraktion
  state.mode = { kind: 'fit', type: t, method: 'Klick' };
  state.preview = null; clearBrush(); renderAll();
}
function startDistanceMode() {
  pe.tool = null;
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
// ---------- Beispielteile (Auswahl mit Vorschaubild)
interface SampleInfo { key: string; name: string; file: string; description: string; triangles: number; bytes: number; thumb: string; kind: string }
let samples: SampleInfo[] | null = null;
async function loadSample(s: SampleInfo) {
  $('#sample-dialog').classList.add('hidden');
  status(`Lade ${s.name} (${(s.bytes / 1048576).toFixed(1)} MB) …`); $('#busy').classList.remove('hidden');
  try {
    const r = await fetch('./samples/' + s.file); if (!r.ok) throw new Error('HTTP ' + r.status);
    await loadBuffer(s.file, await r.arrayBuffer());
  } catch (e: any) { toast('Beispiel konnte nicht geladen werden: ' + e.message); } finally { $('#busy').classList.add('hidden'); }
}
async function openSamples() {
  const d = $('#sample-dialog');
  if (!samples) { try { samples = await (await fetch('./samples/index.json')).json(); } catch { samples = []; } }
  const std = samples!.find((s) => s.key === 'beispielteil');
  if (tour && std) { loadSample(std); return; } // Trainingsmodus: immer das Standard-Beispielteil direkt laden
  d.innerHTML = `<div class="rv-head"><b>Beispielteil laden</b><span class="note">Demo-Messdaten (Scan-/CT-ähnlich) – Soll-Geometrie in samples/*.json</span><span style="flex:1"></span><button class="btn" id="sd-close">✕</button></div>
    <div class="sd-grid">${samples!.map((s) => `<button class="sample-card" data-key="${s.key}"><img src="./samples/${s.thumb}" alt="" loading="lazy"><span class="sc-t">${s.name}</span>
      <span class="sc-d">${s.description}</span><span class="sc-m">${s.kind} · ${(s.triangles / 1000).toFixed(0)} k Dreiecke · ${(s.bytes / 1048576).toFixed(1)} MB</span></button>`).join('')}</div>`;
  d.classList.remove('hidden');
  ($('#sd-close') as HTMLButtonElement).onclick = () => d.classList.add('hidden');
  d.querySelectorAll<HTMLButtonElement>('.sample-card').forEach((b) => (b.onclick = () => loadSample(samples!.find((s) => s.key === b.dataset.key)!)));
}
$('#btn-sample').onclick = () => openSamples();
$('#btn-csv').onclick = () => download('pruefmerkmale.csv', controlsCSV(state.controls, featMap(), ctx));
$('#btn-report').onclick = () => makeReport();
$('#btn-report2').onclick = () => makeReport();
$('#btn-toggle-labels').onclick = () => { state.showLabels = !state.showLabels; renderScene(); renderRibbon(); };
$('#btn-csv-feat').onclick = () => download('merkmale.csv', featureCSV(state.features));
$('#btn-delete-feat').onclick = () => deleteSelected();
$('#btn-toggle-prims').onclick = () => { state.showPrims = !state.showPrims; renderScene(); renderRibbon(); };
$('#btn-toggle-wire').onclick = () => { const on = !viewer.wire; viewer.setWireframe(on); $('#btn-toggle-wire').classList.toggle('on', on); };
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
    viewer.setModel(r.positions, r.indices, r.normals); peReset();
    state.data = { name: r.name, vertexCount: r.vertexCount, triCount: r.triCount, diag: r.bounds.diag };
    state.features = []; state.controls = []; state.sel = []; state.mode = null; state.preview = null;
    state.hidden.clear(); state.labelOffsets.clear(); state.modelVisible = true; state.typeCount = {};
    state.reports = []; state.openReport = null; state.nextId = 1; state.nextCtrl = 1; state.nextReport = 1; ptsCache.clear();
    loadCount++; storeMeshForAutosave(r.name); $('#restore-bar').classList.add('hidden');
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
  if (pe.tool === 'erase' && e.isPrimary && (e.pointerType !== 'mouse' || e.button === 0)) {
    const h = viewer.pick(e.clientX, e.clientY);
    if (h) { painting = true; pePaintErase = e.shiftKey; viewer.controls.enabled = false; peStroke.push([]); pePaint(h); }
    return;
  }
  if (state.mode?.kind === 'fit' && state.mode.method === 'Pinsel' && e.isPrimary && (e.pointerType !== 'mouse' || e.button === 0)) {
    const h = viewer.pick(e.clientX, e.clientY);
    if (h) { painting = true; strokeErase = brushErase || e.shiftKey; brushUndo.push([]); viewer.controls.enabled = false; brushAt(h); }
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (pe.tool === 'erase') { const h = viewer.pick(e.clientX, e.clientY); viewer.showCursor(h, pe.radius); if (painting && h) pePaint(h); return; }
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
let brushErase = false, strokeErase = false;
/** Undo-Stapel: je Pinselstrich die geänderten Knoten (Vorzeichen: + gemalt, − radiert). */
const brushUndo: number[][] = [];
async function brushAt(h: Hit) {
  if (brushBusy || !state.brushMask) return;
  brushBusy = true;
  try {
    const r = await engine.call<any>({ op: 'brush', center: h.point, radius: state.opts.brush, facing: h.normal });
    const stroke = brushUndo[brushUndo.length - 1] ?? [];
    const ch: number[] = [];
    for (const v of r.indices as Uint32Array) {
      if (!strokeErase && !state.brushMask[v]) { state.brushMask[v] = 1; state.brushCount++; ch.push(v); stroke.push(v + 1); }
      else if (strokeErase && state.brushMask[v]) { state.brushMask[v] = 0; state.brushCount--; ch.push(v); stroke.push(-(v + 1)); }
    }
    if (strokeErase) renderScene(); else { viewer.paint(Uint32Array.from(ch), [1, 0.85, 0]); viewer.commitColors(); }
    renderDialog(); renderModeBar();
  } finally { brushBusy = false; }
}
function undoBrush() {
  while (brushUndo.length && !brushUndo[brushUndo.length - 1].length) brushUndo.pop();
  const st = brushUndo.pop(); if (!st || !state.brushMask) { toast('Nichts rückgängig zu machen.'); return; }
  for (let i = st.length - 1; i >= 0; i--) { const v = Math.abs(st[i]) - 1; const was = st[i] > 0 ? 0 : 1; if (state.brushMask[v] !== was) { state.brushMask[v] = was; state.brushCount += was ? 1 : -1; } }
  state.preview = null; renderAll(); status(`Pinselstrich rückgängig – ${state.brushCount} Punkte markiert.`);
}
function clearBrush() { state.brushMask = state.data ? new Uint8Array(state.data.vertexCount) : null; state.brushCount = 0; brushUndo.length = 0; }
function clearSelectionAll() {
  const had = state.brushCount > 0 || !!state.preview;
  clearBrush(); state.preview = null; renderAll(); status(had ? 'Auswahl gelöscht.' : 'Keine Auswahl.');
}
function setMethod(m: 'Klick' | 'Pinsel') {
  if (state.mode?.kind !== 'fit') return;
  state.mode.method = m; state.preview = null; clearBrush(); brushErase = false; viewer.showCursor(null, 1); renderAll();
}
/** Immer sichtbare Modusanzeige über der 3D-Ansicht (aktives Werkzeug + Aktionen). */
const modeBar = document.createElement('div'); modeBar.id = 'mode-bar'; viewer.el.appendChild(modeBar);
modeBar.addEventListener('pointerdown', (e) => e.stopPropagation());
function renderModeBar() {
  if (state.data && pe.tool === 'erase') {
    modeBar.className = 'brush';
    modeBar.innerHTML = `<span class="mb-tool erase">✧ Magischer Radierer</span><label>r <input id="mb-rad" type="number" min="0.1" step="0.1" value="${pe.radius}" style="width:58px" inputmode="decimal"> mm</label>
      <b>${peCount}</b> Pkt <button data-a="pe-go" class="primary" ${peCount ? '' : 'disabled'}>✔ Entfernen &amp; füllen</button><button data-a="pe-sundo" ${peStroke.length ? '' : 'disabled'} title="Pinselstrich zurück">↶ Strich</button><button data-a="pe-clear" ${peCount ? '' : 'disabled'}>Auswahl löschen</button>
      <button data-a="pe-undo" ${pe.undo.length ? '' : 'disabled'} title="Bearbeitung rückgängig">↶ Netz</button><button data-a="pe-cmp" class="${pe.cmp ? 'on' : ''}">◐ Vergleich</button><button data-a="pe-exit">✕ Beenden</button>`;
    modeBar.querySelector<HTMLInputElement>('#mb-rad')!.oninput = (e) => { const v = Number((e.target as HTMLInputElement).value.replace(',', '.')); if (v > 0) { pe.radius = v; const n = document.querySelector<HTMLInputElement>('#pe-rad-n'), r = document.querySelector<HTMLInputElement>('#pe-rad-r'); if (n) n.value = String(v); if (r) r.value = String(v); } };
    modeBar.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) => (b.onclick = () => { const a = b.dataset.a; if (a === 'pe-go') peErase(); else if (a === 'pe-sundo') peUndoStroke(); else if (a === 'pe-clear') { peClearSel(); renderScene(); renderModeBar(); } else if (a === 'pe-undo') peUndo(); else if (a === 'pe-cmp') peToggleCompare(); else peExit(); }));
    return;
  }
  const m = state.mode;
  if (!state.data || !m) { modeBar.className = 'hidden'; return; }
  let html = '';
  if (m.kind === 'dist') html = `<span class="mb-tool">↔ Abstand</span><button data-a="exit">✕ Beenden (Esc)</button>`;
  else if (m.method === 'Klick') html = `<span class="mb-tool">👆 Klick + Wachstum · ${m.type === 'auto' ? 'Automatisch' : m.type}</span><button data-a="brush">🖌 Pinsel</button><button data-a="exit">✕ Beenden (Esc)</button>`;
  else html = `<span class="mb-tool ${brushErase ? 'erase' : 'paint'}">${brushErase ? '🧽 Radierer' : '🖌 Pinsel'} · ${m.type === 'auto' ? 'Automatisch' : m.type} · <b>${state.brushCount}</b> Punkte</span>
    <button data-a="paint" class="${brushErase ? '' : 'on'}">🖌 Malen</button><button data-a="erase" class="${brushErase ? 'on' : ''}" title="Radierer (oder Shift beim Malen)">🧽 Radieren</button>
    <button data-a="undo" title="Strg+Z">↶ Rückgängig</button><button data-a="clear" class="warn">🗑 Auswahl löschen</button>
    <button data-a="fit" class="primary" ${state.brushCount ? '' : 'disabled'}>Fitten</button><button data-a="click">👆 Zurück zu Klick</button>`;
  modeBar.className = m.kind === 'fit' && m.method === 'Pinsel' ? 'brush' : '';
  modeBar.innerHTML = html;
  modeBar.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => {
    const a = b.dataset.a;
    if (a === 'exit') stopMode(); else if (a === 'brush') setMethod('Pinsel'); else if (a === 'click') setMethod('Klick');
    else if (a === 'paint' || a === 'erase') { brushErase = a === 'erase'; renderModeBar(); renderDialog(); }
    else if (a === 'undo') undoBrush(); else if (a === 'clear') clearSelectionAll(); else if (a === 'fit') previewFromBrush();
  }));
}

// ------------------------------------------------------------------ Vorschau
const usesAux = (t: GeomType | 'auto') => (t === 'Kreis' || t === 'Langloch') && state.opts.aux !== 'none';
async function previewWithAux(h: Hit, type: 'Kreis' | 'Langloch') {
  const ref = typeof state.opts.aux === 'number' ? state.features.find((f) => f.id === state.opts.aux) : undefined;
  const r = await busy(engine.call<any>({ op: 'aux', tri: h.tri, point: h.point, maxAngleDeg: state.opts.maxAngleDeg, type, plane: ref?.measured }));
  state.preview = { fit: r.fit, indices: r.indices, candidates: [], method: 'Klick', hit: h,
    aux: { plane: r.aux.plane, indices: r.aux.indices, source: ref ? ref.name : 'automatisch (angrenzende Fläche)', refId: ref?.id } };
  status(`Vorschau: ${type} in Hilfsebene – ${r.indices.length} Wandpunkte (orange), ${ref ? 'Ebene ' + ref.name : r.aux.indices.length + ' Ebenenpunkte (blau)'} (${r.ms.toFixed(0)} ms).`);
}
async function previewNurbs(src: { indices?: Uint32Array; hit?: Hit }, method: 'Klick' | 'Pinsel', params: NurbsParams = state.nurbs) {
  try {
    const seed = src.hit ? { tri: src.hit.tri, point: src.hit.point, maxAngleDeg: state.opts.maxAngleDeg, radius: state.opts.radius } : undefined;
    const r = await busy(engine.call<any>({ op: 'nurbs', indices: seed ? undefined : src.indices, seed, params }));
    state.preview = { fit: r.fit, indices: r.indices, candidates: [], method, hit: src.hit, dev: r.dev };
    const nb = r.fit.nurbs;
    status(`Vorschau Freiformfläche (${nb.kind}, ${nb.surface.nu}×${nb.surface.nv} Kontrollpunkte, Grad ${nb.surface.degU}): ${r.indices.length} Punkte, Std.-Abw. ${fmt(nb.std, 4)} mm (${r.ms.toFixed(0)} ms).`);
  } catch (e: any) { state.preview = null; status('Freiformfläche: ' + e.message); toast('Freiformfläche: ' + e.message); }
  renderAll();
}
async function previewByClick(h: Hit) {
  const m = state.mode as FitMode;
  if (m.type === 'Freiformfläche') { await previewNurbs({ hit: h }, 'Klick'); return; }
  if (usesAux(m.type)) {
    try { await previewWithAux(h, m.type as 'Kreis' | 'Langloch'); }
    catch (e: any) { state.preview = null; status('Hilfsebene: ' + e.message); toast('Hilfsebene: ' + e.message); }
    renderAll(); return;
  }
  try {
    const r = await busy(engine.call<any>({ op: 'grow', tri: h.tri, point: h.point, maxAngleDeg: state.opts.maxAngleDeg, radius: state.opts.radius, type: m.type }));
    state.preview = { fit: r.fit, indices: r.indices, candidates: r.candidates, method: 'Klick', hit: h,
      aux: r.aux ? { plane: r.aux.plane, indices: r.aux.indices, source: 'automatisch (angrenzende Fläche)' } : undefined };
    if (r.aux) { status(`Automatik: ${r.fit.type} in Hilfsebene – ${r.indices.length} Wandpunkte (orange), ${r.aux.indices.length} Ebenenpunkte (blau).`); renderAll(); return; }
    status(`Vorschau: ${r.fit.type} aus ${r.indices.length} Punkten (${r.ms.toFixed(0)} ms). „Erzeugen“ übernimmt das Merkmal.`);
  } catch (e: any) { state.preview = null; status('Keine Geometrie gefunden: ' + e.message); }
  renderAll();
}

async function previewByClickAs(h: Hit, t: GeomType | 'auto') {
  const m = state.mode as FitMode; const old = m.type; m.type = t; await previewByClick(h); m.type = old;
}
async function previewFromBrush() {
  if (!state.brushMask || !state.brushCount) { status('Zuerst Bereich mit dem Pinsel markieren.'); return; }
  const idx = new Uint32Array(state.brushCount); let k = 0;
  state.brushMask.forEach((v, i) => { if (v) idx[k++] = i; });
  if ((state.mode as FitMode).type === 'Freiformfläche') { await previewNurbs({ indices: idx }, 'Pinsel'); return; }
  try {
    const r = await busy(engine.call<any>({ op: 'fit', indices: idx, type: (state.mode as FitMode).type }));
    state.preview = { fit: r.fit, indices: r.indices, candidates: r.candidates, method: 'Pinsel' };
  } catch (e: any) { status('Fit fehlgeschlagen: ' + e.message); }
  renderAll();
}

async function refitPreview(t: GeomType | 'auto') {
  const p = state.preview; if (!p || p.method === 'Konstruiert') return;
  if (t === 'Freiformfläche') { await previewNurbs(p.method === 'Klick' && p.hit ? { hit: p.hit } : { indices: p.indices }, p.method); return; }
  if (p.hit && t === 'auto' && p.method === 'Klick') { const m = state.mode; await previewByClickAs(p.hit, 'auto'); void m; return; }
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
    src: p.indices, hit: p.hit, fp: defaultFp(), dev: p.dev,
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
const defaultFp = (): FitParamsUI => ({ k: 3, nf: { on: false, angleDeg: 30, maxPct: 10 }, maxAngleDeg: state.opts.maxAngleDeg, radius: state.opts.radius, aux: state.opts.aux });
/** Merkmal mit seinen Fit-Parametern neu berechnen (Extraktion + Fit) und alles Abhängige aktualisieren. */
async function refitFeature(f: FeatureView, type: GeomType = f.type) {
  if (f.type === 'Abstand') return;
  const fp = (f.fp ??= defaultFp());
  try {
    if (type === 'Freiformfläche') {
      const params = f.measured?.nurbs?.params ?? state.nurbs;
      const seed = f.hit && f.method === 'Klick' ? { tri: f.hit.tri, point: f.hit.point, maxAngleDeg: fp.maxAngleDeg, radius: fp.radius } : undefined;
      const r = await busy(engine.call<any>({ op: 'nurbs', indices: seed ? undefined : f.src ?? f.indices, seed, params }));
      f.measured = r.fit; f.indices = r.indices; f.src = r.indices; f.dev = r.dev; f.aux = undefined; f.auxIndices = undefined;
      f.type = 'Freiformfläche'; f.pointCount = f.indices.length; ptsCache.delete(f.id);
      state.controls = state.controls.filter((c) => !(c.featureIds[0] === f.id && !availableControls(f.type).includes(c.kind)));
      recomputeDistances();
      const nb = r.fit.nurbs;
      status(`${f.name} neu rückgeführt: ${nb.surface.nu}×${nb.surface.nv} Kontrollpunkte, Grad ${nb.surface.degU}, Std.-Abw. ${fmt(nb.std, 4)} mm, Flächenprofil ${fmt(r.fit.form, 4)} mm.`);
      renderAll(); scheduleAutosave(); return;
    }
    let idx = f.src ?? f.indices, auxR: any = null;
    const inPlane = (type === 'Kreis' || type === 'Langloch') && fp.aux !== 'none';
    if (f.hit && f.method === 'Klick') {
      if (inPlane) {
        const ref = typeof fp.aux === 'number' ? state.features.find((g) => g.id === fp.aux) : undefined;
        auxR = await busy(engine.call<any>({ op: 'aux', tri: f.hit.tri, point: f.hit.point, maxAngleDeg: fp.maxAngleDeg, type, plane: ref?.measured }));
        auxR.source = ref ? ref.name : 'automatisch (angrenzende Fläche)'; auxR.refId = ref?.id;
      } else idx = (await busy(engine.call<any>({ op: 'grow', tri: f.hit.tri, point: f.hit.point, maxAngleDeg: fp.maxAngleDeg, radius: fp.radius, type }))).indices;
    }
    if (auxR) {
      f.measured = auxR.fit; f.indices = auxR.indices; f.src = auxR.indices;
      f.aux = { plane: auxR.aux.plane, pointCount: auxR.aux.indices.length, source: auxR.source, refId: auxR.refId } as AuxPlane; f.auxIndices = auxR.aux.indices;
    } else {
      const r = await busy(engine.call<any>({ op: 'fit', indices: idx, type, params: { k: fp.k, nf: fp.nf.on ? fp.nf : null } }));
      f.measured = r.fit; f.indices = r.indices; f.src = idx; f.aux = undefined; f.auxIndices = undefined; f.dev = undefined;
    }
    f.type = f.measured!.type; f.pointCount = f.indices.length; ptsCache.delete(f.id);
    state.controls = state.controls.filter((c) => !(c.featureIds[0] === f.id && !availableControls(f.type).includes(c.kind)));
    recomputeDistances();
    const m = f.measured!;
    status(`${f.name} neu gefittet: ${f.pointCount} Punkte, RMS ${fmt(m.rms, 4)}${m.outliers ? `, ${m.outliers} Ausreißer` : ''}${m.nfRemoved ? `, ${m.nfRemoved} durch Normalenfilter verworfen` : ''}.`);
  } catch (e: any) { status('Fit fehlgeschlagen: ' + e.message); toast('Fit fehlgeschlagen: ' + e.message); }
  renderAll(); scheduleAutosave();
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

// ------------------------------------------------------------------ Bezüge (ISO 5459)
const datumFeatures = () => state.features.filter((f) => f.datum).sort((a, b) => a.datum!.localeCompare(b.datum!));
const dependents = (fid: number) => state.controls.filter((c) => c.datumIds?.includes(fid));
/** Bezugsbuchstaben zuweisen (null = entfernen). Ist der Buchstabe vergeben, werden die Buchstaben getauscht. */
function setDatum(f: FeatureView, letter: string | null) {
  const old = f.datum;
  if (letter && old === letter) return;
  if (letter) {
    const other = state.features.find((g) => g.id !== f.id && g.datum === letter);
    if (other) { other.datum = old; toast(old ? `Bezüge getauscht: ${f.name} = ${letter}, ${other.name} = ${old}` : `${letter} von ${other.name} auf ${f.name} übertragen – ${other.name} hat keinen Bezug mehr`); }
    else toast(old ? `Bezug ${old} → ${letter} umbenannt (${f.name})` : `Bezug ${letter} = ${f.name}`);
    f.datum = letter;
  } else {
    f.datum = undefined;
    const n = dependents(f.id).length;
    toast(`Bezug ${old} entfernt${n ? ` – ${n} Prüfmerkmal${n > 1 ? 'e' : ''} als „Bezug entfernt“ markiert` : ''}`);
  }
  renderAll();
}
const nextFreeLetter = () => DATUM_LETTERS.find((l) => !state.features.some((f) => f.datum === l)) ?? 'Z';
function defaultDatums(kind: ControlKind, fid: number): number[] {
  const ds = datumFeatures().filter((d) => d.id !== fid);
  if (!isDatumControl(kind)) return [];
  const [, mx] = DATUM_COUNT[kind];
  if (['Koaxialität', 'Konzentrizität', 'Rundlauf', 'Gesamtrundlauf'].includes(kind)) {
    const a = ds.find((d) => datumKind(d.type) === 'axis') ?? ds[0]; return a ? [a.id] : [];
  }
  return ds.slice(0, mx).map((d) => d.id);
}
function defaultBasic(kind: ControlKind, f: FeatureView, datumIds: number[]): number[] | undefined {
  const fm = featMap();
  if (kind === 'Neigung') {
    const d = fm.get(datumIds[0]); if (!d) return [45];
    const a = Math.acos(Math.min(1, Math.abs(f.measured!.normal.reduce((s, v, i) => s + v * d.measured!.normal[i], 0)))) * DEG;
    return [Math.round(a * 2) / 2];
  }
  if (kind === 'Position' || kind === 'Profil (Bezug)') {
    const F = buildDRF(datumIds.map((i) => fm.get(i)!).filter(Boolean));
    const loc = toLocal(F, f.measured!.center);
    // Achse: Lage entlang der Achse ist für die Position bedeutungslos → Soll-Koordinate 0 (in der Bezugsebene)
    if (datumKind(f.type) === 'axis' && f.type !== 'Torus') {
      const a = dirLocal(F, f.measured!.normal); const ax = [0, 1, 2].reduce((q, k) => (Math.abs(a[k]) > Math.abs(a[q]) ? k : q), 0); loc[ax] = 0;
    }
    return loc.map((v) => Math.round(v * 10) / 10 + 0);
  }
  return undefined;
}
function parseDatumRef(txt: string): number[] | null {
  const letters = txt.toUpperCase().split(/[|,; ]+/).filter(Boolean);
  const ids = letters.map((l) => state.features.find((f) => f.datum === l)?.id);
  if (ids.some((x) => x == null)) return null;
  return ids as number[];
}

function addControl(kind: ControlKind, id: number) {
  const t = defaultTolerance(kind);
  const c: Control = { id: state.nextCtrl++, kind, featureIds: [id], nominal: t.nominal, tolUp: t.up, tolLo: t.lo };
  if (isDatumControl(kind)) { c.datumIds = defaultDatums(kind, id); c.basic = defaultBasic(kind, state.features.find((f) => f.id === id)!, c.datumIds); }
  state.controls.push(c);
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
  const r = buildReport(state.nextReport++, state.features, state.controls, state.data?.name ?? '', new Date(), ctx);
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
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && state.mode?.kind === 'fit' && state.mode.method === 'Pinsel') { e.preventDefault(); undoBrush(); return; }
  if (e.key === 'Escape' && pe.tool) { peExit(); return; }
  if (e.key === 'Escape') {
    if (state.preview) discardPreview();
    else if (state.mode?.kind === 'fit' && state.mode.method === 'Pinsel') { if (state.brushCount) clearSelectionAll(); else setMethod('Klick'); }
    else stopMode();
  }
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
function renderAll() { renderModeBar(); renderRibbon(); renderTree(); renderDialog(); renderPreviewCard(); renderTable(); renderScene(); renderHint(); renderReport(); scheduleAutosave(); }

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
  hint('');
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
  if (state.data) {
    const mn = node(`<span class="tw"></span>${ICON.mesh}${state.data.name} <span class="sub">(Polygonmodell)</span>`, 'indent2 model-node', () => { state.sel = []; renderAll(); }, false, undefined,
      eyeBtn(state.modelVisible, () => { state.modelVisible = !state.modelVisible; renderTree(); renderScene(); }));
    mn.ondblclick = () => centerOn(null); attachContext(mn, null);
  }
  node(`<span class="tw">▾</span>${ICON.folder}Merkmale (${state.features.length})`, 'indent1');
  const distSlots = state.mode?.kind === 'dist' ? [state.mode.a, state.mode.b] : [];
  for (const f of state.features) {
    if (q && !f.name.toLowerCase().includes(q) && !f.type.toLowerCase().includes(q)) continue;
    const ico = f.type === 'Abstand' ? ICON['Abstand 3D'] : ICON[f.type];
    const tag = distSlots.includes(f.id) ? ` <span class="sub">[${distSlots.indexOf(f.id) === 0 ? 'A' : 'B'}]</span>` : '';
    const sel = state.sel.includes(f.id), vis = !state.hidden.has(f.id);
    const fnode = node(`<span class="tw">▾</span><span style="color:${hex(f.color)}">${ico}</span>${f.name}${f.datum ? `<span class="dflag sm" title="Bezug ${f.datum}">${f.datum}</span>` : ''}${tag}`,
      'indent2' + (vis ? '' : ' hidden-feat'), (e) => selectFeature(f.id, e.ctrlKey || e.metaKey || e.shiftKey), sel, f.id,
      eyeBtn(vis, () => { vis ? state.hidden.add(f.id) : state.hidden.delete(f.id); renderTree(); renderScene(); }));
    fnode.ondblclick = () => centerOn(f.id);
    attachContext(fnode, f.id);
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
  if (!full && m.nurbs) { const nb = m.nurbs; return [['Std.-Abw. σ', fmt(nb.std)], ['Flächenprofil', fmt(m.form)], ['Max. +', sgn(m.maxPos)], ['Max. −', sgn(m.maxNeg)],
    ['Patch', `${nb.kind}, ${nb.surface.nu}×${nb.surface.nv}, Grad ${nb.surface.degU}`]]; }
  const rows: [string, string][] = [];
  if (full) rows.push(['Punkte', String(pointCount)]);
  rows.push(['Std.-Abw. (RMS)', fmt(m.rms)], [FORM_NAME[m.type], fmt(m.form)], ['Max. +', sgn(m.maxPos)], ['Max. −', sgn(m.maxNeg)]);
  if (m.outliers) rows.push(['Ausreißer entfernt', String(m.outliers)]);
  if (m.type === 'Torus') rows.push(['Leitkreis-Ø 2R', fmt(m.diameter)], ['Leitkreis R', fmt(m.radius)], ['Rohr-Ø 2r', fmt(2 * Math.abs(m.minorRadius ?? 0))], ['Rohr r', fmt(Math.abs(m.minorRadius ?? 0))]);
  else if (m.diameter != null && m.type !== 'Langloch') rows.push(['Durchmesser', fmt(m.diameter)]);
  if (m.type === 'Langloch') rows.push(['Länge', fmt(m.length)], ['Breite', fmt(m.width)]);
  if (m.type === 'Kegel') rows.push(['Kegelwinkel [°]', fmt(2 * m.halfAngle! * DEG, 3)]);
  if (m.nurbs) { const nb = m.nurbs; rows.splice(full ? 1 : 0, 0, ['Std.-Abw. σ', fmt(nb.std)]);
    rows.push(['Patch', nb.kind === 'vierseitig' ? 'vierseitig (4 Randkurven)' : 'getrimmt (1 Randkurve)'], ['Kontrollpunkte', `${nb.surface.nu} × ${nb.surface.nv}`], ['Grad', `${nb.surface.degU} / ${nb.surface.degV}`], ['Glättung λ', String(nb.params.smooth)]); }
  if (full && m.type === 'Freiformfläche') return rows;
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
  const size: [string, string][] = m.type === 'Langloch' ? [['Länge', fmt(m.length)], ['Breite', fmt(m.width)]] : m.type === 'Torus' ? [['Ø 2R', fmt(m.diameter)], ['Rohr-Ø', fmt(2 * Math.abs(m.minorRadius ?? 0))]] : [['Durchmesser', fmt(m.diameter)]];
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
  if (pe.tool) { renderPolyDialog(d); return; }
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
      <div class="row"><button class="btn ${brushErase ? 'on' : ''}" id="d-erase">🧽 Radierer ${brushErase ? 'an' : 'aus'}</button><button class="btn" id="d-undo">↶ Rückgängig</button></div>
      <p class="note">Malen: über das Netz streichen. Radieren: Radierer einschalten oder <b>Shift</b> gedrückt halten. Rückgängig: <b>Strg+Z</b>. <b>Esc</b> löscht die Auswahl, ein zweites Esc wechselt zurück zu „Klick“.</p>
      <button class="btn primary" id="d-fit">Fitten (Vorschau)</button><button class="btn warn" id="d-clear">🗑 Auswahl löschen</button>`}
      ${p ? `<h4>Vorschau: ${p.fit.type}</h4>${p.aux ? auxStats(p) : ''}${kv(fitRows(p.fit, p.indices.length))}
        ${p.candidates.length ? `<h4>Erkennung (RMS je Typ)</h4>${kv(p.candidates.map((c) => [c.type, fmt(c.rms)] as [string, string]))}` : ''}
        <div class="row"><select id="d-retype">${['auto', ...FIT_TYPES].map((t) => `<option value="${t}" ${t === p.fit.type ? 'selected' : ''}>${t === 'auto' ? 'Automatisch' : t}</option>`).join('')}</select><button class="btn" id="d-refit">Neu fitten</button></div>
        <button class="btn primary" id="d-create">✔ Erzeugen</button><button class="btn" id="d-discard">✕ Verwerfen</button>`
      : `<p class="note">Klick erzeugt zunächst eine <b>Vorschau</b> (Punkte + Geometrie + Kennwerte). Erst „Erzeugen“ legt das Merkmal an.</p>`}
      <div><button class="btn" id="d-close">Schließen</button></div>`;
    d.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => (b.onclick = () => setMethod(b.dataset.m as any)));
    d.querySelector('#d-erase')?.addEventListener('click', () => { brushErase = !brushErase; renderAll(); });
    d.querySelector('#d-undo')?.addEventListener('click', undoBrush);
    ($('#d-type') as HTMLSelectElement).onchange = (e) => { (state.mode as FitMode).type = (e.target as HTMLSelectElement).value as any; if (state.preview) refitPreview((state.mode as FitMode).type); else renderAll(); };
    const bind = (id: string, key: 'maxAngleDeg' | 'radius' | 'brush') => { const el = d.querySelector<HTMLInputElement>(id); if (el) el.onchange = () => { const x = Number(el.value.replace(',', '.')); if (isFinite(x)) state.opts[key] = x; }; };
    bind('#d-ang', 'maxAngleDeg'); bind('#d-rad', 'radius'); bind('#d-brush', 'brush');
    d.querySelector<HTMLSelectElement>('#d-aux')?.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value; state.opts.aux = v === 'auto' || v === 'none' ? v : +v;
      if (state.preview?.hit) refitPreview(state.preview.fit.type); else renderAll();
    });
    d.querySelector('#d-fit')?.addEventListener('click', previewFromBrush);
    d.querySelector('#d-clear')?.addEventListener('click', clearSelectionAll);
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
    ${f.type !== 'Abstand' ? fitParamsHTML(f) : ''}
    ${datumKind(f.type) ? `<h4><span class="dflag sm">${f.datum ?? '?'}</span> Bezug (ISO 5459)</h4>
      <div class="row" id="dt-box"><select id="dt-letter">${DATUM_LETTERS.slice(0, 10).map((l) => { const o = state.features.find((g) => g.datum === l && g.id !== f.id);
        return `<option value="${l}" ${(f.datum ?? nextFreeLetter()) === l ? 'selected' : ''}>${l}${o ? ` (tauschen mit ${o.name})` : ''}</option>`; }).join('')}</select>
        <button class="btn primary" id="dt-apply">${f.datum ? 'Umbenennen' : 'Bezug zuweisen'}</button></div>
      ${f.datum ? `<div class="row"><button class="btn" id="dt-remove">Bezug ${f.datum} entfernen</button><span class="note">${dependents(f.id).length} Prüfmerkmal(e) verwenden ${f.datum}</span></div>` : ''}
      <p class="note">${datumKind(f.type) === 'plane' ? 'Ebene als Bezug: legt eine Richtung (Normale) und Lage fest.' : datumKind(f.type) === 'axis' ? 'Achse als Bezug (Bohrung/Welle): legt Achsrichtung und -lage fest.' : 'Mittelpunkt als Bezug.'}
        <button class="linkbtn" id="dt-training">🎓 Trainingsmodus Bezüge</button></p>` : ''}
    <div><button class="btn" id="d-center">⌖ Zentrieren</button><button class="btn" id="d-addctrl">＋ Prüfmerkmal …</button><button class="btn" id="d-del">Merkmal löschen</button></div>`;
  d.querySelector('#dt-apply')?.addEventListener('click', () => setDatum(f, ($('#dt-letter') as HTMLSelectElement).value));
  d.querySelector('#dt-remove')?.addEventListener('click', () => setDatum(f, null));
  d.querySelector('#dt-training')?.addEventListener('click', () => startTraining());
  d.querySelector('#d-center')?.addEventListener('click', () => centerOn(f.id));
  ($('#d-name') as HTMLInputElement).onchange = (e) => { f.name = (e.target as HTMLInputElement).value; renderAll(); };
  ($('#d-del') as HTMLButtonElement).onclick = () => { state.selControl = null; deleteSelected(); };
  ($('#d-addctrl') as HTMLButtonElement).onclick = () => { state.addFeat = f.id; state.ctab = 'katalog'; renderTable(); togglePanel('table', true); };
  bindFitParams(d, f);
}

function nurbsParamsHTML(f: FeatureView) {
  const fp = (f.fp ??= defaultFp()); const grow = !!f.hit && f.method === 'Klick'; const nb = f.measured!.nurbs!; const P = nb.params;
  return `<h4>⚙ Freiform-Parameter <span class="note">(Änderung ⇒ automatisch neu rückführen)</span></h4><div id="fp-box">
    <div class="row"><label>Geometrietyp</label><select id="d-retype">${FIT_TYPES.map((t) => `<option ${t === f.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="row"><label>Kontrollpunkte u</label><input id="nb-nu" value="${P.nu}" inputmode="numeric"></div>
    <div class="row"><label>Kontrollpunkte v</label><input id="nb-nv" value="${P.nv}" inputmode="numeric"></div>
    <div class="row"><label>Grad</label><select id="nb-deg">${[1, 2, 3, 4, 5].map((d) => `<option ${d === P.deg ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
    <div class="row"><label>Glättung λ</label><input id="nb-sm" value="${P.smooth}" inputmode="decimal"></div>
    ${grow ? `<div class="row"><label>Regionenwachstum: max. Winkel [°]</label><input id="fp-ang" value="${fp.maxAngleDeg}" inputmode="decimal"></div>` : `<p class="note">Punkte aus ${f.method === 'Pinsel' ? 'Pinselauswahl' : 'Projektdatei'}.</p>`}
    <div class="row chk"><label><input type="checkbox" id="nb-dev" ${state.devMap ? 'checked' : ''}> Abweichungs-Farbkarte</label></div>
    <div class="row chk"><label><input type="checkbox" id="nb-net" ${state.ctrlNet ? 'checked' : ''}> Kontrollnetz anzeigen</label></div>
    <p class="note">Ablauf: Randschleife der Auswahl → ${nb.kind === 'vierseitig' ? '4 Ecken, 4 Randkurven' : 'getrimmtes Patch (1 Randkurve)'} → Parametrisierung → Ausgleich (kleinste Quadrate) mit Glättung → Parameterkorrektur. Mehr Kontrollpunkte = genauer, aber welliger; λ glättet.</p>
    <div class="row"><button class="btn" id="nb-igs">⇩ IGES (128)</button><button class="btn" id="nb-stp">⇩ STEP</button><button class="btn" id="nb-json">⇩ JSON</button></div>
    </div>`;
}
function bindNurbsParams(d: HTMLElement, f: FeatureView) {
  const fp = f.fp!; const P = f.measured!.nurbs!.params; const q = <T extends HTMLElement>(s: string) => d.querySelector<T>(s);
  const num = (id: string, set: (x: number) => void, ok: (x: number) => boolean) => { const el = q<HTMLInputElement>(id); if (el) el.onchange = () => { const x = Number(el.value.replace(',', '.')); if (isFinite(x) && ok(x)) { set(x); refitFeature(f); } else toast('Ungültiger Wert'); }; };
  q<HTMLSelectElement>('#d-retype')?.addEventListener('change', (e) => refitFeature(f, (e.target as HTMLSelectElement).value as GeomType));
  num('#nb-nu', (x) => (P.nu = Math.round(x)), (x) => x >= P.deg + 1 && x <= 40);
  num('#nb-nv', (x) => (P.nv = Math.round(x)), (x) => x >= P.deg + 1 && x <= 40);
  num('#nb-sm', (x) => (P.smooth = x), (x) => x >= 0 && x <= 100);
  num('#fp-ang', (x) => (fp.maxAngleDeg = x), (x) => x > 0 && x < 90);
  q<HTMLSelectElement>('#nb-deg')?.addEventListener('change', (e) => { P.deg = +(e.target as HTMLSelectElement).value; P.nu = Math.max(P.nu, P.deg + 1); P.nv = Math.max(P.nv, P.deg + 1); refitFeature(f); });
  q<HTMLInputElement>('#nb-dev')?.addEventListener('change', (e) => { state.devMap = (e.target as HTMLInputElement).checked; renderAll(); });
  q<HTMLInputElement>('#nb-net')?.addEventListener('change', (e) => { state.ctrlNet = (e.target as HTMLInputElement).checked; renderAll(); });
  const fit = () => ({ ...(f.measured!.nurbs! as any), dev: new Float32Array(0), uv: new Float32Array(0), rms: f.measured!.rms, form: f.measured!.form, maxPos: f.measured!.maxPos, maxNeg: f.measured!.maxNeg, n: f.pointCount });
  const nm = f.name.replace(/[^\w-]+/g, '_');
  q('#nb-igs')?.addEventListener('click', () => download(nm + '.igs', toIGES(fit(), nm), 'model/iges'));
  q('#nb-stp')?.addEventListener('click', () => download(nm + '.stp', toSTEP(fit(), nm), 'model/step'));
  q('#nb-json')?.addEventListener('click', () => download(nm + '.json', JSON.stringify(toJSON(fit()), null, 1), 'application/json'));
}
function fitParamsHTML(f: FeatureView) {
  if (f.measured?.nurbs) return nurbsParamsHTML(f);
  const fp = (f.fp ??= defaultFp()); const grow = !!f.hit && f.method === 'Klick';
  const planes = state.features.filter((g) => g.type === 'Ebene' && g.id !== f.id);
  const m = f.measured!;
  return `<h4>⚙ Fit-Parameter <span class="note">(Änderung ⇒ automatisch neu fitten)</span></h4><div id="fp-box">
    <div class="row"><label>Geometrietyp</label><select id="d-retype">${FIT_TYPES.map((t) => `<option ${t === f.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="row"><label>Methode</label><select id="fp-method"><option value="lsq" ${fp.k ? '' : 'selected'}>Gauß (kleinste Quadrate)</option><option value="rob" ${fp.k ? 'selected' : ''}>Gauß robust (Ausreißer entfernen)</option></select></div>
    ${fp.k ? `<div class="row"><label>Ausreißer &gt; k·σ, k =</label><input id="fp-k" value="${fp.k}" inputmode="decimal"></div>` : ''}
    ${grow ? `<div class="row"><label>Regionenwachstum: max. Winkel [°]</label><input id="fp-ang" value="${fp.maxAngleDeg}" inputmode="decimal"></div>
      <div class="row"><label>Suchradius [mm] (0 = ∞)</label><input id="fp-rad" value="${fp.radius}" inputmode="decimal"></div>` : `<p class="note">Punkte aus ${f.method === 'Pinsel' ? 'Pinselauswahl' : 'Projektdatei'} – kein Regionenwachstum.</p>`}
    <div class="row chk"><label><input type="checkbox" id="fp-nf" ${fp.nf.on ? 'checked' : ''}> Normalenrichtungsfilter</label></div>
    ${fp.nf.on ? `<div class="row"><label>max. Normalenabweichung [°]</label><input id="fp-nfa" value="${fp.nf.angleDeg}" inputmode="decimal"></div>
      <div class="row"><label>höchstens verwerfen [%]</label><input id="fp-nfp" value="${fp.nf.maxPct}" inputmode="decimal"></div>` : ''}
    <p class="note">Normalenfilter: Punkte, deren gemessene Flächennormale mehr als den Winkel von der Normalen des gefitteten Elements abweicht (Kanten, Fasen, Nachbarflächen), werden verworfen – die schlimmsten zuerst, höchstens der Prozentsatz.${m.nfRemoved ? ` <b>Aktuell ${m.nfRemoved} Punkte verworfen.</b>` : ''}</p>
    ${(f.type === 'Kreis' || f.type === 'Langloch') && grow ? `<div class="row"><label>Hilfsebene</label><select id="fp-aux"><option value="auto" ${fp.aux === 'auto' ? 'selected' : ''}>Automatisch</option>
      ${planes.map((g) => `<option value="${g.id}" ${fp.aux === g.id ? 'selected' : ''}>${g.name}</option>`).join('')}<option value="none" ${fp.aux === 'none' ? 'selected' : ''}>Keine (3D-Fit)</option></select></div>` : ''}
    </div>`;
}
function bindFitParams(d: HTMLElement, f: FeatureView) {
  if (f.measured?.nurbs) { bindNurbsParams(d, f); return; }
  const fp = f.fp!; const q = <T extends HTMLElement>(s: string) => d.querySelector<T>(s);
  const num = (id: string, set: (x: number) => void, min = 0) => { const el = q<HTMLInputElement>(id); if (el) el.onchange = () => { const x = Number(el.value.replace(',', '.')); if (isFinite(x) && x >= min) { set(x); refitFeature(f); } else el.value = ''; }; };
  q<HTMLSelectElement>('#d-retype')?.addEventListener('change', (e) => refitFeature(f, (e.target as HTMLSelectElement).value as GeomType));
  q<HTMLSelectElement>('#fp-method')?.addEventListener('change', (e) => { fp.k = (e.target as HTMLSelectElement).value === 'rob' ? 3 : 0; refitFeature(f); });
  num('#fp-k', (x) => (fp.k = Math.max(1, x)));
  num('#fp-ang', (x) => (fp.maxAngleDeg = x)); num('#fp-rad', (x) => (fp.radius = x));
  q<HTMLInputElement>('#fp-nf')?.addEventListener('change', (e) => { fp.nf.on = (e.target as HTMLInputElement).checked; refitFeature(f); });
  num('#fp-nfa', (x) => (fp.nf.angleDeg = Math.min(89, x))); num('#fp-nfp', (x) => (fp.nf.maxPct = Math.min(90, x)));
  q<HTMLSelectElement>('#fp-aux')?.addEventListener('change', (e) => { const v = (e.target as HTMLSelectElement).value; fp.aux = v === 'auto' || v === 'none' ? v : +v; refitFeature(f); });
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
      const r = c ? evaluate(c, fm, ctx) : null;
      const ist = r ? r.measured : isDatumControl(it.kind) ? null : evaluate({ id: 0, kind: it.kind, featureIds: [f.id], nominal: null, tolUp: 0, tolLo: 0 }, fm, ctx).measured;
      const needD = isDatumControl(it.kind) && !c && !datumFeatures().some((d) => d.id !== f.id);
      row.innerHTML = `<label><input type="checkbox" ${c ? 'checked' : ''} ${needD ? 'disabled' : ''}><span class="sym">${it.symbol}</span><span class="cl" title="${it.note ?? ''}">${it.label}</span></label>
        <span class="ist">${needD ? '<small>Bezug zuweisen</small>' : fmt(ist)}</span>`;
      row.querySelector('input')!.onchange = (e) => toggleControl(it.kind, f.id, (e.target as HTMLInputElement).checked);
      if (c && r && isDatumControl(c.kind)) {
        const ed = document.createElement('span'); ed.className = 'cat-ed datum-ed';
        const lab = (t: string, el: HTMLElement) => { const s = document.createElement('span'); s.className = 'ce'; s.innerHTML = `<small>${t}</small>`; s.appendChild(el); ed.appendChild(s); };
        lab(c.kind === 'Position' || c.kind === 'Koaxialität' || c.kind === 'Konzentrizität' ? 'Tol Ø' : 'Tol', numInput(c.tolUp, (x) => (c.tolUp = Math.abs(x ?? 0))));
        const di = document.createElement('input'); di.className = 'dref'; di.value = datumText(c, fm); di.title = 'Bezüge primär|sekundär|tertiär, z. B. A|B|C';
        di.onchange = () => { const ids = parseDatumRef(di.value); if (!ids) { toast('Unbekannter Bezugsbuchstabe: ' + di.value); } else { c.datumIds = ids; if (c.kind === 'Position' || c.kind === 'Profil (Bezug)') c.basic = c.basic ?? defaultBasic(c.kind, f, ids); } renderAll(); };
        lab('Bezug', di);
        if (c.kind === 'Position' || c.kind === 'Profil (Bezug)') ['X', 'Y', 'Z'].forEach((a, k) => lab(`[${a}]`, numInput(c.basic?.[k] ?? 0, (x) => { c.basic = c.basic ?? [0, 0, 0]; c.basic[k] = x ?? 0; })));
        if (c.kind === 'Neigung') lab('[∠°]', numInput(c.basic?.[0] ?? 45, (x) => (c.basic = [x ?? 0])));
        ed.insertAdjacentHTML('beforeend', `<span class="frame">${it.symbol} ${c.kind === 'Position' && datumKind(f.type) !== 'plane' ? (f.type === 'Kugel' || f.type === 'Punkt' || f.type === 'Torus' ? 'SØ' : 'Ø') : ''}${fmt(c.tolUp, 3)}${c.datumIds?.length ? ' | ' + datumText(c, fm) : ''}</span>
          <span class="dev ${r.status}">${r.measured == null ? '' : fmt(r.measured)}</span><span class="st ${r.status === '—' ? 'none' : r.status}">${r.flag ? '⚠' : r.status}</span>${r.flag ? `<span class="flag">⚠ ${r.flag}</span>` : ''}`);
        if (r.detail) ed.title = r.detail;
        row.appendChild(ed);
      } else if (c && r) {
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
  if (f && !datumFeatures().some((d) => d.id !== f.id) && f.type !== 'Abstand') cat.insertAdjacentHTML('beforeend',
    '<p class="note" style="padding:2px 8px 8px">Toleranzen mit Bezug (∥ ⟂ ∠ ⌖ ◎ ⌯ ↗) werden aktiv, sobald einem anderen Merkmal ein Bezug (A, B, C …) zugewiesen ist – Dialog › Bezug.</p>');

  // ---------- Liste aller Prüfmerkmale
  $('#ctab-n').textContent = String(state.controls.length);
  const tb = $('#ctrl-table tbody'); tb.innerHTML = '';
  let io = 0, nio = 0;
  for (const c of state.controls) {
    const r = evaluate(c, fm, ctx); if (r.status === 'IO') io++; if (r.status === 'NIO') nio++;
    const fc = fm.get(c.featureIds[0]);
    const tr = document.createElement('tr');
    if (state.selControl === c.id) tr.className = 'sel';
    const td = (html: string | HTMLElement, cls = '') => { const e = document.createElement('td'); e.className = cls; if (typeof html === 'string') e.innerHTML = html; else e.appendChild(html); tr.appendChild(e); return e; };
    td(fc?.name ?? '?');
    td(`<span class="sym">${CTRL_SYMBOL(c, fc)}</span> ${controlLabel(c, fc)}${c.datumIds?.length ? ` <span class="frame">${datumText(c, fm)}</span>` : ''}${r.flag ? ` <span class="flag">⚠ ${r.flag}</span>` : ''}`);
    td(isDatumControl(c.kind) ? '<span class="note">0</span>' : numInput(c.nominal, (x) => (c.nominal = x)), 'num');
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
    const r = evaluate(c, fm, ctx);
    return `<tr class="${r.status === '—' ? '' : r.status}"><td>${CTRL_SYMBOL(c, f)} ${controlLabel(c, f)}${c.datumIds?.length ? ` |${datumText(c, fm)}|` : ''}${r.flag ? ' ⚠' : ''}</td><td>${fmt(r.measured, 3)}</td><td>${c.nominal == null ? '—' : fmt(c.nominal, 3)}</td><td>${r.deviation == null ? '' : sgn(r.deviation, 3)}</td></tr>`;
  }).join('');
  return `<div class="lh"><i></i>${f.name}${f.datum ? `<span class="dflag">${f.datum}</span>` : ''}</div>${cs.length ? `<table><tr class="lt"><th></th><th>Ist</th><th>Soll</th><th>Abw.</th></tr>${rows}</table>` : ''}`;
}

/** Farbskala symmetrisch: ±max(3σ, |max|) begrenzt auf 3σ, mind. 1 µm. */
function devRange(dev: Float32Array) { let s = 0; for (const d of dev) s += d * d; return Math.max(1e-3, 3 * Math.sqrt(s / Math.max(1, dev.length))); }
function renderDevLegend(dev: Float32Array | null) {
  let el = document.getElementById('dev-legend');
  if (!dev) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'dev-legend'; viewer.el.appendChild(el); }
  const r = devRange(dev);
  el.innerHTML = `<b>Abweichung [mm]</b><div class="bar"></div><div class="ticks"><span>${sgn(-r, 3)}</span><span>0</span><span>${sgn(r, 3)}</span></div>`;
}
function renderScene() {
  if (!state.data) return;
  if (viewer.model) viewer.model.visible = state.modelVisible;
  const vis = (f: FeatureView) => !state.hidden.has(f.id);
  viewer.resetColors();
  const peOn = paintPolyCompare();
  if (pe.tool === 'erase' && peMask && peCount && peMask.length === state.data.vertexCount) { const ids: number[] = []; peMask.forEach((v, i) => v && ids.push(i)); viewer.paint(Uint32Array.from(ids), [0.62, 0.2, 0.95]); }
  if (state.colorPts && !peOn) for (const f of state.features) {
    if (f.type === 'Abstand' || !vis(f)) continue;
    const c = rgb(f.color), s = state.sel.includes(f.id);
    if (s && f.dev && state.devMap && f.dev.length === f.indices.length) viewer.paintScalar(f.indices, f.dev, devRange(f.dev));
    else viewer.paint(f.indices, s ? c : c.map((v) => 0.55 * v + 0.45 * 0.68));
  }
  if (state.brushMask && state.brushCount) {
    const idx: number[] = []; state.brushMask.forEach((v, i) => v && idx.push(i));
    viewer.paint(Uint32Array.from(idx), [1, 0.85, 0]);
  }
  const p = state.preview;
  if (p?.aux?.indices.length) viewer.paint(p.aux.indices, rgb(AUX_COLOR));
  if (p && p.indices.length) { if (p.dev && state.devMap) viewer.paintScalar(p.indices, p.dev, devRange(p.dev)); else viewer.paint(p.indices, rgb(PREVIEW_COLOR)); }
  const lg = [p?.dev && state.devMap ? p.dev : null, ...state.features.filter((f) => state.sel.includes(f.id) && f.dev && state.devMap && vis(f)).map((f) => f.dev!)].find(Boolean);
  if (!peOn) renderDevLegend(lg ?? null);
  viewer.commitColors();
  viewer.clearPrims();
  if (state.showPrims) for (const f of state.features) {
    if (!vis(f)) continue;
    const sel = state.sel.includes(f.id);
    if (f.type === 'Abstand') viewer.addDistance(f.measured!.p1!, f.measured!.p2!, f.color, sel);
    else if (f.measured!.nurbs) viewer.addFreeform(f.measured!.nurbs, f.color, sel, sel && state.ctrlNet);
    else viewer.addPrimitive(f.measured!, f.color, sel);
  }
  if (p) {
    if (p.fit.type === 'Abstand') viewer.addDistance(p.fit.p1!, p.fit.p2!, PREVIEW_COLOR, true);
    else if (p.fit.nurbs) viewer.addFreeform(p.fit.nurbs, PREVIEW_COLOR, true, state.ctrlNet);
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

// ------------------------------------------------------------------ Zentrieren
function featureRadius(f: FeatureView): number {
  const m = f.measured!;
  if (f.type === 'Abstand') return Math.max(m.distance! / 2, 1);
  const P = featPoints(f.id);
  if (P && P.length) { let r = 0; for (const q of P) r = Math.max(r, Math.hypot(q[0] - m.center[0], q[1] - m.center[1], q[2] - m.center[2])); return r; }
  return Math.max(m.radius ?? 0, (m.length ?? 0) / 2, 2);
}
/** Kamera auf Merkmal (id) bzw. gesamtes Modell (null) zentrieren; ohne Argument: Auswahl. */
function centerOn(id?: number | null) {
  const fid = id === undefined ? state.sel[0] ?? null : id;
  const f = state.features.find((x) => x.id === fid);
  if (!f) { viewer.view('fit'); status('Modell zentriert.'); return; }
  viewer.focus(f.measured!.center as [number, number, number], featureRadius(f));
  status(`${f.name} zentriert.`);
}
{
  const b = document.createElement('button'); b.id = 'btn-center'; b.title = 'Zentrieren: Ansicht auf Auswahl (oder Modell) ausrichten';
  b.innerHTML = '<span>⌖</span> Zentrieren'; b.onclick = () => centerOn();
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  viewer.el.appendChild(b);
}

// ------------------------------------------------------------------ Kontextmenü (Rechtsklick / langes Tippen)
const ctxMenu = document.createElement('div'); ctxMenu.id = 'ctx-menu'; ctxMenu.className = 'hidden'; document.body.appendChild(ctxMenu);
function openContext(x: number, y: number, fid: number | null) {
  const f = state.features.find((g) => g.id === fid);
  const items: [string, () => void][] = [['⌖ Zentrieren', () => centerOn(fid)]];
  if (f) {
    state.sel = [f.id]; state.addFeat = f.id; renderAll();
    if (datumKind(f.type)) {
      items.push([f.datum ? `Bezug ${f.datum} umbenennen …` : 'Bezug zuweisen …', () => { togglePanel('dialog', true); setTimeout(() => ($('#dt-letter') as HTMLSelectElement)?.focus(), 50); }]);
      if (!f.datum) items.push([`Als Bezug ${nextFreeLetter()} festlegen`, () => setDatum(f, nextFreeLetter())]);
      else items.push([`Bezug ${f.datum} entfernen`, () => setDatum(f, null)]);
    }
    items.push([state.hidden.has(f.id) ? 'Einblenden' : 'Ausblenden', () => { state.hidden.has(f.id) ? state.hidden.delete(f.id) : state.hidden.add(f.id); renderAll(); }]);
    items.push(['Prüfmerkmale (Katalog)', () => { state.ctab = 'katalog'; togglePanel('table', true); renderTable(); }]);
    items.push(['Löschen', () => { state.selControl = null; deleteSelected(); }]);
  }
  ctxMenu.innerHTML = items.map(([t], i) => `<button data-i="${i}">${t}</button>`).join('');
  ctxMenu.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => { ctxMenu.classList.add('hidden'); items[+b.dataset.i!][1](); }));
  ctxMenu.classList.remove('hidden');
  const w = ctxMenu.offsetWidth, h = ctxMenu.offsetHeight;
  ctxMenu.style.left = Math.min(x, innerWidth - w - 4) + 'px'; ctxMenu.style.top = Math.min(y, innerHeight - h - 4) + 'px';
}
window.addEventListener('pointerdown', (e) => { if (!ctxMenu.contains(e.target as Node)) ctxMenu.classList.add('hidden'); }, true);
function attachContext(el: HTMLElement, fid: number | null) {
  el.oncontextmenu = (e) => { e.preventDefault(); openContext(e.clientX, e.clientY, fid); };
  let t = 0, x0 = 0, y0 = 0;
  el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; x0 = e.clientX; y0 = e.clientY; t = window.setTimeout(() => { t = 0; openContext(x0, y0, fid); }, 550); });
  el.addEventListener('pointermove', (e) => { if (t && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) { clearTimeout(t); t = 0; } });
  el.addEventListener('pointerup', () => { if (t) clearTimeout(t); t = 0; });
}

// ------------------------------------------------------------------ Projekt speichern / öffnen / Autosave
let loadCount = 0, meshKey = '', restoring = false;
function projectJSON() {
  const feats = state.features.map(({ indices, auxIndices, candidates, src, dev, ...rest }) => { void indices; void auxIndices; void candidates; void src; void dev; return rest; });
  return {
    savedAt: new Date().toISOString(), app: 'MessWerk 3D',
    mesh: { name: state.data!.name, vertexCount: state.data!.vertexCount, triCount: state.data!.triCount },
    state: {
      features: feats, controls: state.controls, typeCount: state.typeCount, nextId: state.nextId, nextCtrl: state.nextCtrl, nextReport: state.nextReport,
      reports: state.reports, hidden: [...state.hidden], modelVisible: state.modelVisible, labelOffsets: [...state.labelOffsets.entries()],
      showLabels: state.showLabels, showPrims: state.showPrims, colorPts: state.colorPts, opts: state.opts, camera: viewer.getCamera(),
    },
  };
}
function featureIndexBlob() {
  const o: Record<string, Uint32Array | undefined> = {};
  for (const f of state.features) { o['f' + f.id] = f.indices; o['a' + f.id] = f.auxIndices; o['s' + f.id] = f.src; o['d' + f.id] = f.dev ? new Uint32Array(f.dev.buffer.slice(f.dev.byteOffset, f.dev.byteOffset + f.dev.byteLength)) : undefined; }
  return packIndices(o);
}
function meshArrays() {
  const g = viewer.model!.geometry;
  return { positions: g.getAttribute('position').array as Float32Array, indices: (g.index?.array ?? new Uint32Array(0)) as Uint32Array };
}
async function saveProject() {
  if (!state.data) { toast('Kein Projekt zum Speichern.'); return; }
  const bin = writeProject(projectJSON(), meshArrays(), featureIndexBlob());
  const name = state.data.name.replace(/\.[^.]+$/, '') + '.mw3d';
  const file = new File([bin as BlobPart], name, { type: 'application/octet-stream' });
  const nav = navigator as any;
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: name }); toast(`✔ ${name} geteilt/gesichert`); return; } catch (e: any) { if (e?.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`✔ Projekt gespeichert: ${name} (${(bin.length / 1048576).toFixed(1)} MB)`);
}
async function applyProject(json: any, mesh: { positions: Float32Array; indices: Uint32Array }, idx: { offsets: any; data: Uint32Array }) {
  restoring = true;
  try {
    const r = await busy(engine.call<any>({ op: 'loadRaw', name: json.mesh.name, positions: mesh.positions.slice(), indices: mesh.indices.slice() }));
    viewer.setModel(r.positions, r.indices, r.normals); peReset();
    const st = json.state;
    state.data = { name: r.name, vertexCount: r.vertexCount, triCount: r.triCount, diag: r.bounds.diag };
    state.features = st.features.map((f: any) => ({ ...f, indices: unpackIndex(idx, 'f' + f.id) ?? new Uint32Array(0), auxIndices: unpackIndex(idx, 'a' + f.id), src: unpackIndex(idx, 's' + f.id), dev: ((d) => (d ? new Float32Array(d.slice().buffer) : undefined))(unpackIndex(idx, 'd' + f.id)) }));
    state.controls = st.controls; state.typeCount = st.typeCount; state.nextId = st.nextId; state.nextCtrl = st.nextCtrl; state.nextReport = st.nextReport;
    state.reports = st.reports ?? []; state.hidden = new Set(st.hidden ?? []); state.modelVisible = st.modelVisible ?? true;
    state.labelOffsets = new Map(st.labelOffsets ?? []); state.showLabels = st.showLabels ?? true; state.showPrims = st.showPrims ?? true; state.colorPts = st.colorPts ?? true;
    if (st.opts) Object.assign(state.opts, st.opts);
    state.sel = []; state.mode = null; state.preview = null; state.openReport = null; ptsCache.clear();
    $('#projname').textContent = r.name; $('#stats').textContent = `${r.vertexCount} Punkte · ${r.triCount} Dreiecke`;
    loadCount++; await storeMeshForAutosave(r.name); $('#restore-bar').classList.add('hidden');
    renderAll();
    if (st.camera) viewer.setCamera(st.camera);
  } finally { restoring = false; }
  scheduleAutosave();
}
async function openProjectFile(buf: ArrayBuffer, name: string) {
  try {
    const p = readProject(new Uint8Array(buf));
    await applyProject(p.json, p.mesh, p.idx);
    toast(`✔ Projekt ${name} geladen (${state.features.length} Merkmale, ${state.controls.length} Prüfmerkmale)`);
  } catch (e: any) { toast('Projekt konnte nicht geladen werden: ' + e.message); }
}
async function storeMeshForAutosave(name: string) {
  if (!viewer.model) return;
  meshKey = name + ':' + Date.now();
  try { const m = meshArrays(); await idbSet('mesh', { key: meshKey, name, positions: m.positions, indices: m.indices }); } catch (e) { console.warn('Autosave (Netz) nicht möglich', e); }
}
let autoTimer = 0;
function scheduleAutosave() {
  if (!state.data || restoring || !meshKey) return;
  clearTimeout(autoTimer);
  autoTimer = window.setTimeout(async () => {
    try {
      const b = featureIndexBlob();
      await idbSet('project', { meshKey, savedAt: new Date().toISOString(), json: projectJSON(), idxOffsets: b.offsets, idxData: b.data, features: state.features.length });
      $('#autosave').textContent = 'Autosave ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) { console.warn('Autosave fehlgeschlagen', e); }
  }, 1500);
}
async function restoreLast() {
  const p = await idbGet('project'), m = await idbGet('mesh');
  if (!p || !m || p.meshKey !== m.key) { toast('Kein gespeichertes Projekt gefunden.'); return; }
  await applyProject(p.json, { positions: m.positions, indices: m.indices }, { offsets: p.idxOffsets, data: p.idxData });
  $('#restore-bar').classList.add('hidden');
  toast(`✔ Letztes Projekt wiederhergestellt (${p.features} Merkmale)`);
}
(async () => {
  try {
    const p = await idbGet('project');
    if (p && !state.data) {
      const bar = $('#restore-bar');
      bar.innerHTML = `<span>Letztes Projekt vom ${new Date(p.savedAt).toLocaleString('de-DE')} (${p.json.mesh.name}, ${p.features} Merkmale)</span>
        <button class="btn primary" id="rb-restore">Letztes Projekt wiederherstellen</button><button class="btn" id="rb-discard">Verwerfen</button>`;
      bar.classList.remove('hidden');
      ($('#rb-restore') as HTMLButtonElement).onclick = () => restoreLast();
      ($('#rb-discard') as HTMLButtonElement).onclick = async () => { await idbDel('project'); await idbDel('mesh'); bar.classList.add('hidden'); };
    }
  } catch { /* IndexedDB nicht verfügbar */ }
})();
$('#btn-save').onclick = () => saveProject();
$('#file-project').onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
  await openProjectFile(await f.arrayBuffer(), f.name); (e.target as HTMLInputElement).value = '';
};
$('#btn-restore').onclick = () => restoreLast();

// ------------------------------------------------------------------ Hilfe + Trainingsmodus
$('#btn-help').onclick = () => {
  const el = $('#help-view'); el.classList.remove('hidden');
  el.innerHTML = `<div class="rv-head"><b>Hilfe: Bezüge und Toleranzen mit Bezug</b><span style="flex:1"></span><button class="btn" id="hv-train">🎓 Training starten</button><button class="btn" id="hv-close">✕</button></div>
  <div class="rv-body">${HELP_HTML}</div>`;
  ($('#hv-close') as HTMLButtonElement).onclick = () => el.classList.add('hidden');
  ($('#hv-train') as HTMLButtonElement).onclick = () => { el.classList.add('hidden'); startTraining(); };
};
const HELP_HTML = `<h3>Bezug zuweisen (ISO 5459)</h3><ol><li>Merkmal wählen (Ebene, Zylinder/Bohrung, Kreis, Kegel, Langloch, Torus, Kugel).</li>
<li>Dialog › <b>Bezug</b>: Buchstaben wählen › <b>Bezug zuweisen</b> – oder Rechtsklick/langes Tippen im Baum › „Als Bezug … festlegen“.</li>
<li>Umbenennen: anderen Buchstaben wählen; ist er vergeben, werden die Buchstaben <b>getauscht</b>. Prüfmerkmale verweisen auf das Merkmal und passen sich an.</li>
<li>Entfernen: Prüfmerkmale, die den Bezug nutzen, bleiben erhalten und werden mit ⚠ „Bezug entfernt“ markiert, bis ein Bezug wieder zugewiesen wird.</li></ol>
<h3>Bezugssystem A|B|C</h3><ul><li><b>Primär A</b> legt die Orientierung fest: Ebene → Z = Normale aus dem Material, Ursprung auf A; Achse → Z = Achse.</li>
<li><b>Sekundär B</b>: Ebene → Richtung in A (senkrecht zu B) und Ursprung auf B; Achse/Kreis → Ursprung auf der Achse von B.</li>
<li><b>Tertiär C</b> legt die verbleibende Drehung bzw. die letzte Ursprungskoordinate fest. X/Y werden so benannt, dass X der Welt-X-Richtung am nächsten liegt.</li></ul>
<h3>Toleranzen mit Bezug</h3><ul><li><b>∥ Parallelität / ⟂ Rechtwinkligkeit / ∠ Neigung</b>: Ebenen – Abstand zweier Ebenen in Sollrichtung, die alle Punkte enthalten; Achsen – Länge × sin(Winkelfehler).</li>
<li><b>⌖ Position</b>: theoretisch genaue Maße [X][Y][Z] im Bezugssystem von Hand. Achsen: zylindrische Zone Ø = 2 × größter Abstand der Achsendpunkte von der Soll-Achse; Kugel/Torus/Punkt: SØ; Ebene: 2 × größter Punktabstand zur Soll-Ebene.</li>
<li><b>◎ Koaxialität / Konzentrizität</b>: Ø = 2 × Abstand der Achse (Endpunkte) bzw. des Mittelpunkts zur Bezugsachse.</li>
<li><b>⌯ Symmetrie</b>: 2 × Abstand der Mittelebene/des Mittelpunkts vom Bezug (Langloch: in Breitenrichtung).</li>
<li><b>↗ Rundlauf</b>: radiale Abstände der Punkte zur Bezugsachse in Messkreisen (Schnitte); größte Spanne. <b>⌰ Gesamtrundlauf</b>: Spanne über die ganze Fläche.</li>
<li><b>⌓ Flächenprofil mit Bezug</b>: konservative Abschätzung 2 × (max. Formabweichung + Lageabweichung des Mittelpunkts).</li></ul>
<p class="note">Alle Werte werden aus den gemessenen (Ist-)Geometrien berechnet; ohne CAD gibt es kein Soll-Modell – Sollmaße werden eingetippt.</p>`;

let tour: Tour | null = null;
const worldToScreen = (p: Vec3) => {
  const v = viewer.camera.position.clone().set(p[0], p[1], p[2]).project(viewer.camera);
  const r = canvas.getBoundingClientRect();
  if (v.z > 1) return null;
  const x = r.left + ((v.x + 1) / 2) * r.width, y = r.top + ((1 - v.y) / 2) * r.height;
  const h = viewer.pick(x, y); // verdeckt? dann kein Marker
  if (!h || Math.hypot(h.point[0] - p[0], h.point[1] - p[1], h.point[2] - p[2]) > 1.5) return null;
  return { x, y };
};
const findF = (pred: (f: FeatureView) => boolean) => state.features.find(pred);
const isTop = (f: FeatureView) => f.type === 'Ebene' && f.measured!.normal[2] > 0.99 && Math.abs(f.measured!.center[2] - 20) < 0.2;
const isFront = (f: FeatureView) => f.type === 'Ebene' && Math.abs(f.measured!.normal[1]) > 0.99 && Math.abs(f.measured!.center[1]) < 0.2;
const isLeft = (f: FeatureView) => f.type === 'Ebene' && Math.abs(f.measured!.normal[0]) > 0.99 && Math.abs(f.measured!.center[0]) < 0.2;
const isHole = (f: FeatureView) => f.type === 'Zylinder' && Math.abs(f.measured!.diameter! - 12.08) < 0.3;
const pv = (pred: (m: FitResult) => boolean) => () => !!state.preview && pred(state.preview.fit);
const tab = (t: string) => () => (document.querySelector(`.tab[data-tab="${t}"]`) as HTMLButtonElement)?.click();
// ---- Automatik für übersprungene Schritte
/** Nächstes Dreieck zu p, dessen Normale ungefähr n entspricht (für automatisch erzeugte Merkmale). */
function hitAt(p: Vec3, n: Vec3): Hit | null {
  const g = viewer.model?.geometry; if (!g?.index) return null;
  const P = g.getAttribute('position').array as Float32Array, I = g.index.array as Uint32Array;
  let best = -1, bd = Infinity, bn: Vec3 = [0, 0, 1];
  for (let t = 0; t < I.length / 3; t++) {
    const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
    const cx = (P[a] + P[b] + P[c]) / 3, cy = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, cz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    const d = (cx - p[0]) ** 2 + (cy - p[1]) ** 2 + (cz - p[2]) ** 2; if (d >= bd) continue;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    if (nx * n[0] + ny * n[1] + nz * n[2] < 0.7) continue;
    bd = d; best = t; bn = [nx, ny, nz];
  }
  return best < 0 ? null : { tri: best, point: [p[0], p[1], p[2]], normal: bn };
}
async function ensureSample() {
  if (state.data?.name.startsWith('beispielteil')) return;
  if (!samples) samples = await (await fetch('./samples/index.json')).json();
  await loadSample(samples!.find((s) => s.key === 'beispielteil')!);
}
async function ensurePreview(type: GeomType, p: Vec3, n: Vec3, pred: (f: FeatureView) => boolean) {
  await ensureSample(); if (findF(pred)) return;
  tab('merkmale')(); if (state.mode?.kind !== 'fit' || state.mode.type !== type) startFitMode(type);
  const h = hitAt(p, n); if (h) await previewByClick(h);
}
async function ensureFeature(type: GeomType, p: Vec3, n: Vec3, pred: (f: FeatureView) => boolean) {
  await ensureSample(); if (findF(pred)) return;
  if (!(state.preview && state.preview.fit.type === type)) await ensurePreview(type, p, n, pred);
  if (state.preview) commitPreview();
}
const TRAIN_FEATS: Record<string, [GeomType, Vec3, Vec3]> = { A: ['Ebene', [70, 50, 20], [0, 0, 1]], B: ['Ebene', [50, 0, 10], [0, -1, 0]], C: ['Ebene', [0, 30, 10], [-1, 0, 0]], H: ['Zylinder', [20, 26.04, 15], [0, -1, 0]] };
async function ensureDatum(letter: string, pred: (f: FeatureView) => boolean) {
  const [t, p, n] = TRAIN_FEATS[letter]; await ensureFeature(t, p, n, pred);
  const f = findF(pred); if (f && f.datum !== letter) setDatum(f, letter);
}
async function ensurePosition() {
  await ensureDatum('A', isTop); await ensureDatum('B', isFront); await ensureDatum('C', isLeft);
  const [t, p, n] = TRAIN_FEATS.H; await ensureFeature(t, p, n, isHole);
  const f = findF(isHole)!; if (!state.controls.some((c) => c.kind === 'Position' && c.featureIds[0] === f.id)) toggleControl('Position', f.id, true);
}
function datumSteps(letter: string, pred: (f: FeatureView) => boolean, what: string): TourStep {
  return {
    auto: () => ensureDatum(letter, pred),
    title: `Bezug ${letter} zuweisen`, text: `${what} ist ausgewählt. Wähle im Dialog unter <b>Bezug</b> den Buchstaben <b>${letter}</b> und tippe auf <b>Bezug zuweisen</b>.`,
    target: () => document.querySelector('#dt-box'),
    enter: () => { const f = findF(pred); if (f) { state.sel = [f.id]; state.mode = null; renderAll(); } if (isPhone()) togglePanel('dialog', true); setTimeout(() => { const s = document.querySelector<HTMLSelectElement>('#dt-letter'); if (s && !findF(pred)?.datum) s.value = letter; }, 50); },
    check: () => findF(pred)?.datum === letter,
  };
}
function planeSteps(name: string, p: Vec3, dir: [number, number, number] | null, pred: (f: FeatureView) => boolean, nPred: (m: FitResult) => boolean, n: Vec3 = [0, 0, 1]): TourStep[] {
  return [
    { auto: () => ensurePreview('Ebene', p, n, pred), title: `${name} antippen`, text: `Modus <b>Ebene</b> ist aktiv. Tippe auf die markierte Stelle (gelber Ring) – die <b>${name}</b> des Teils. Es erscheint eine orange Vorschau.`,
      world: () => worldToScreen(p),
      enter: () => { if (isPhone()) togglePanel('dialog', false); tab('merkmale')(); if (state.mode?.kind !== 'fit' || state.mode.type !== 'Ebene') startFitMode('Ebene'); dir ? viewer.viewDir(dir) : viewer.view('iso'); },
      check: () => !!findF(pred) || pv(nPred)() },
    { auto: () => ensureFeature('Ebene', p, n, pred), title: 'Erzeugen', text: 'Prüfe die Kennwerte (Punkte, RMS, Ebenheit) und tippe auf <b>✔ Erzeugen</b>.', target: () => document.querySelector('#pc-create'), check: () => !!findF(pred) },
  ];
}
function startTraining() {
  if (tour) return;
  let lc0 = loadCount;
  const steps: TourStep[] = [
    { title: 'Training: Bezüge & Position', text: 'In dieser geführten Übung legst du am Beispielteil das Bezugssystem <b>A|B|C</b> fest (Oberseite, Vorderseite, linke Seite) und prüfst die <b>Position</b> der Bohrung Ø12 mit Bezug auf A|B|C.<br>Jeder Schritt wird automatisch geprüft. Mit <b>Weiter</b> geht es los.' },
    { title: 'Beispielteil laden', text: 'Tippe im Register <b>Start</b> auf <b>Beispiel laden</b> – im Training wird direkt das Standard-Beispielteil geladen. (Ein laufendes Projekt wird ersetzt – vorher ggf. „Projekt speichern“.)',
      auto: ensureSample, target: () => document.querySelector('#btn-sample'), enter: () => { lc0 = loadCount; tab('start')(); if (isPhone()) document.body.classList.remove('show-tree', 'show-dialog', 'show-table'); },
      check: () => (loadCount > lc0 || state.features.length > 0) && !!state.data?.name.startsWith('beispielteil') },
    { auto: async () => tab('merkmale')(), title: 'Register „Merkmale“', text: 'Öffne oben das Register <b>Merkmale</b>.', target: () => document.querySelector('.tab[data-tab="merkmale"]'), check: () => !!document.querySelector('.tab.active[data-tab="merkmale"]') },
    { auto: async () => { await ensureSample(); tab('merkmale')(); startFitMode('Ebene'); }, title: 'Merkmalstyp Ebene', text: 'Wähle <b>Ebene</b>. Damit wird nur eine Ebene gefittet.', target: () => document.querySelector('[data-ftype="Ebene"]'), check: () => (state.mode?.kind === 'fit' && state.mode.type === 'Ebene') || !!findF(isTop) },
    ...planeSteps('Oberseite', [70, 50, 20], null, isTop, (m) => m.type === 'Ebene' && m.normal[2] > 0.99),
    datumSteps('A', isTop, 'Die Oberseite (primärer Bezug: legt die Orientierung fest)'),
    ...planeSteps('Vorderseite', [50, 0, 10], null, isFront, (m) => m.type === 'Ebene' && Math.abs(m.normal[1]) > 0.99, [0, -1, 0]),
    datumSteps('B', isFront, 'Die Vorderseite (sekundärer Bezug: Richtung in A und Ursprung in Y)'),
    ...planeSteps('linke Seite', [0, 30, 10], [-1, -1.2, 0.9], isLeft, (m) => m.type === 'Ebene' && Math.abs(m.normal[0]) > 0.99, [-1, 0, 0]),
    datumSteps('C', isLeft, 'Die linke Seite (tertiärer Bezug: Ursprung in X)'),
    { auto: async () => { await ensureSample(); tab('merkmale')(); startFitMode('Zylinder'); }, title: 'Merkmalstyp Zylinder', text: 'Wähle im Register Merkmale den Typ <b>Zylinder</b>.', target: () => document.querySelector('[data-ftype="Zylinder"]'),
      enter: () => { if (isPhone()) togglePanel('dialog', false); tab('merkmale')(); viewer.view('iso'); }, check: () => (state.mode?.kind === 'fit' && state.mode.type === 'Zylinder') || !!findF(isHole) },
    { auto: () => ensurePreview('Zylinder', TRAIN_FEATS.H[1], TRAIN_FEATS.H[2], isHole), title: 'Bohrung Ø12 antippen', text: 'Tippe auf die <b>Wand der Bohrung</b> (gelber Ring).', world: () => worldToScreen([20, 26.04, 15]), enter: () => viewer.view('iso'),
      check: () => !!findF(isHole) || pv((m) => m.type === 'Zylinder' && Math.abs(m.diameter! - 12.08) < 0.3)() },
    { auto: () => ensureFeature('Zylinder', TRAIN_FEATS.H[1], TRAIN_FEATS.H[2], isHole), title: 'Erzeugen', text: 'Tippe auf <b>✔ Erzeugen</b>.', target: () => document.querySelector('#pc-create'), check: () => !!findF(isHole) },
    { auto: async () => { await ensureFeature('Zylinder', TRAIN_FEATS.H[1], TRAIN_FEATS.H[2], isHole); const f = findF(isHole)!; f.fp ??= defaultFp(); if (!f.fp.nf.on) { f.fp.nf.on = true; await refitFeature(f); } },
      title: 'Normalenrichtungsfilter', text: 'Beim Antasten liegen oft Punkte von <b>Kanten und Fasen</b> in der Auswahl. Ihre Flächennormale passt nicht zur Bohrungswand. Der <b>Normalenrichtungsfilter</b> verwirft Punkte, deren Normale mehr als den eingestellten <b>Winkel</b> abweicht – die schlimmsten zuerst, aber höchstens den eingestellten <b>Prozentsatz</b>.<br>Setze im Dialog unter <b>⚙ Fit-Parameter</b> den Haken bei <b>Normalenrichtungsfilter</b>. Das Merkmal wird sofort neu gefittet; Winkel und % kannst du danach ändern.',
      target: () => document.querySelector('#fp-nf')?.closest('.row') ?? null,
      enter: () => { const f = findF(isHole); if (f) { state.sel = [f.id]; state.mode = null; renderAll(); } if (isPhone()) togglePanel('dialog', true); },
      check: () => !!findF(isHole)?.fp?.nf.on },
    { auto: ensurePosition, title: 'Positionstoleranz ⌖ A|B|C', text: 'Im Fenster <b>Prüfmerkmale</b> (Katalog) unter „Mit Bezug“ den Haken bei <b>⌖ Position</b> setzen. Die Bezüge A|B|C werden automatisch eingetragen.',
      target: () => document.querySelector('#catalog .cat-item[data-kind="Position"]'),
      enter: () => { const f = findF(isHole); if (f) { state.sel = [f.id]; state.addFeat = f.id; state.ctab = 'katalog'; state.mode = null; renderAll(); } if (isPhone()) togglePanel('table', true); },
      check: () => { const f = findF(isHole); const fm = featMap(); return !!f && state.controls.some((c) => c.kind === 'Position' && c.featureIds[0] === f.id && datumText(c, fm) === 'A|B|C'); } },
    { auto: async () => { await ensurePosition(); const f = findF(isHole)!; const c = state.controls.find((k) => k.kind === 'Position' && k.featureIds[0] === f.id)!; c.basic = [20, 20, c.basic?.[2] ?? 0]; renderAll(); }, title: 'Sollmaße [X] [Y] und Toleranz', text: 'Trage die theoretisch genauen Maße <b>[X] = 20</b> und <b>[Y] = 20</b> ein (bereits vorbelegt, bitte prüfen) und lasse die Toleranz <b>Ø 0,1</b>. Ergebnis: IO/NIO und Eintrag im 3D-Label.',
      target: () => document.querySelector('#catalog .cat-item[data-kind="Position"] .cat-ed'),
      check: () => { const f = findF(isHole); const c = state.controls.find((k) => k.kind === 'Position' && k.featureIds[0] === f?.id); return !!c && Math.abs((c.basic?.[0] ?? 0) - 20) < 1e-6 && Math.abs((c.basic?.[1] ?? 0) - 20) < 1e-6; } },
    { title: 'Geschafft! 🎉', text: 'Die Bohrung ist jetzt mit <b>⌖ Ø0,1 | A | B | C</b> toleriert. Die Bezugsfahnen stehen im Baum und in den 3D-Labels. Bezüge lassen sich im Dialog umbenennen (Buchstaben tauschen) oder entfernen – abhängige Prüfmerkmale werden dann markiert.',
      enter: () => { if (isPhone()) togglePanel('table', false); viewer.view('iso'); } },
  ];
  tour = new Tour('Training Bezüge', steps, () => { tour = null; (window as any).__app.tour = null; });
  (window as any).__app.tour = tour;
  tour.start();
}
$('#btn-training').onclick = () => startTraining();
/** Test-Hilfe: Abstand der rückgeführten Fläche zur bekannten Formel des Freiform-Demoteils (nur innerhalb der Trimmung, 3 % Rand). */
function nurbsAccuracy(fit: FitResult) {
  const Zf = (x: number, y: number) => 20 + Math.sin((Math.PI * x) / 70) * (17 + 3 * Math.cos((2 * Math.PI * y) / 80) + (2.5 * y) / 80);
  const nb = fit.nurbs!; let mx = 0, s = 0, n = 0;
  for (let i = 0; i <= 50; i++) for (let j = 0; j <= 50; j++) {
    const u = 0.03 + 0.94 * i / 50, v = 0.03 + 0.94 * j / 50; if (!insideTrim(nb.trimUV, u, v)) continue;
    const P = evalSurface(nb.surface, u, v, 0)[0]; const d = P[2] - Zf(P[0], P[1]); mx = Math.max(mx, Math.abs(d)); s += d * d; n++;
  }
  return { max: +mx.toFixed(5), rms: +Math.sqrt(s / Math.max(1, n)).toFixed(5), samples: n };
}
Object.assign((window as any).__app, { nurbsAccuracy, renderAll, togglePanel, evaluate, ctx: () => ctx, startTraining, centerOn, setDatum, saveProject, openProjectFile, restoreLast, projectJSON });
viewer.controls.addEventListener('end', () => scheduleAutosave());


// ------------------------------------------------------------------ Polygonbearbeitung

const TOL_MIN = 0.001, TOL_MAX = 1;
const tolToRange = (t: number) => Math.round(1000 * Math.log10(Math.max(TOL_MIN, Math.min(TOL_MAX, t)) / TOL_MIN) / 3);
const rangeToTol = (r: number) => +(TOL_MIN * 10 ** (3 * r / 1000)).toPrecision(2);

function peReset() { pe.undo = []; pe.edits = []; pe.dev = null; pe.devStats = null; pe.cmp = false; pe.origTris = 0; pe.live = ''; }
function curMesh() { const m = meshArrays(); return { positions: m.positions.slice(), indices: m.indices.slice() }; }

document.querySelectorAll<HTMLButtonElement>('[data-pe]').forEach((b) => (b.onclick = () => {
  if (!state.data) { toast('Bitte zuerst ein Polygonmodell laden.'); return; }
  if (!state.data.triCount) { toast('Polygonbearbeitung benötigt ein Dreiecksnetz (keine Punktwolke).'); return; }
  const t = b.dataset.pe as PeTool;
  if (pe.tool === t) { peExit(); return; }
  state.mode = null; state.preview = null; clearBrush();
  pe.tool = t; if (t === 'erase') pe.radius = pe.radius || +(state.data.diag / 40).toFixed(1);
  viewer.controls.enabled = true; viewer.showCursor(null, 1);
  renderAll(); if (isPhone()) togglePanel('dialog', t !== 'erase'); // Radierer: Steuerung in der Modusleiste, 3D frei zum Tippen
}));
$('#btn-pe-cmp').onclick = () => peToggleCompare();
$('#btn-pe-undo').onclick = () => peUndo();
$('#btn-pe-reset').onclick = () => peResetOriginal();
function peExit() { if (pe.running) polyEngine.cancel(); pe.tool = null; peClearSel(); viewer.showCursor(null, 1); if (isPhone()) togglePanel('dialog', false); renderAll(); }

function renderPolyRibbon() {
  document.querySelectorAll<HTMLButtonElement>('[data-pe]').forEach((b) => b.classList.toggle('on', pe.tool === b.dataset.pe));
  $('#btn-pe-cmp').classList.toggle('on', pe.cmp);
  ($('#btn-pe-undo') as HTMLButtonElement).disabled = !pe.undo.length;
  ($('#btn-pe-reset') as HTMLButtonElement).disabled = !pe.undo.length;
  const i = $('#pe-info'); if (i) i.textContent = pe.edits.length ? `${pe.edits.length} Bearbeitung(en) · ${state.data?.triCount.toLocaleString('de-DE')} Dreiecke` : 'Original';
}

/** Toleranz: Zahlenfeld und Schieberegler (logarithmisch 0,001…1 mm), gegenseitig synchronisiert. */
function tolRow(id: string, label: string, val: number) {
  return `<div class="row pe-tol"><label>${label}</label><input type="number" id="${id}-n" value="${val}" min="${TOL_MIN}" max="${TOL_MAX}" step="0.001" inputmode="decimal"><span class="unit">mm</span></div>
    <div class="row pe-tol"><input type="range" id="${id}-r" min="0" max="1000" step="1" value="${tolToRange(val)}" aria-label="${label}"></div>`;
}
function bindTol(d: HTMLElement, id: string, set: (v: number) => void) {
  const n = d.querySelector<HTMLInputElement>(`#${id}-n`)!, r = d.querySelector<HTMLInputElement>(`#${id}-r`)!;
  n.addEventListener('input', () => { const v = Number(n.value.replace(',', '.')); if (isFinite(v) && v > 0) { r.value = String(tolToRange(v)); set(Math.min(TOL_MAX, Math.max(TOL_MIN, v))); } });
  r.addEventListener('input', () => { const v = rangeToTol(+r.value); n.value = String(v); set(v); });
}

function renderPolyDialog(d: HTMLElement) {
  const t = pe.tool!, tris = state.data?.triCount ?? 0;
  const run = pe.running ? `<button class="btn" id="pe-cancel">✕ Abbrechen</button>` : `<button class="btn primary" id="pe-run">▶ Anwenden</button>`;
  let body = '';
  if (t === 'reduce') body = `<p class="note">Quadrik-Kantenkollaps, krümmungsadaptiv: entfernt Dreiecke, solange das reduzierte Netz beidseitig höchstens um die Toleranz vom Original abweicht und die Normalen kaum kippen – wie die Sehnenhöhe beim Polygonisieren eines Kreises. Ebene Bereiche werden stark, Radien und Kanten kaum reduziert.</p>
    ${tolRow('pe-tol', 'Max. Abweichung', pe.tol)}
    <div class="row"><label title="Krümmungsadaptiv: neue Dreiecke dürfen höchstens so stark von den Originalnormalen abweichen">Max. Normalenabw.</label><input type="number" id="pe-nd" value="${pe.normalDeg}" min="1" max="45" step="1"><span class="unit">°</span></div>
    <div class="row"><label title="Kanten mit größerem Flächenwinkel bleiben als Kante erhalten (Ecken fest)">Kantenwinkel</label><input type="number" id="pe-fd" value="${pe.featureDeg}" min="5" max="90" step="1"><span class="unit">°</span></div>
    <div class="row">${run}</div>`;
  else if (t === 'subdiv') body = `<p class="note">Teilt jedes Dreieck in vier (Loop). Neue Punkte werden geglättet, aber höchstens um die Toleranz von der ursprünglichen Fläche verschoben.</p>
    ${tolRow('pe-tol', 'Max. Abweichung', pe.tol)}
    <div class="row"><label>Stufen</label><select id="pe-lv">${[1, 2].map((x) => `<option ${x === pe.levels ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
    <div class="row"><span class="note">Ergebnis: ≈ ${(tris * 4 ** pe.levels).toLocaleString('de-DE')} Dreiecke${tris * 4 ** pe.levels > 3e6 ? ' – über 3 Mio., wird begrenzt' : ''}</span></div><div class="row">${run}</div>`;
  else if (t === 'smooth') body = `<p class="note">Taubin-Glättung (schrumpft nicht). Rauschen wird reduziert; jeder Punkt bewegt sich höchstens um die Toleranz (0 = unbegrenzt). Ränder bleiben fest.</p>
    <div class="row"><label>Stärke λ</label><input type="number" id="pe-lam" value="${pe.lambda}" min="0.05" max="0.9" step="0.05"></div>
    <div class="row"><label>Iterationen</label><input type="number" id="pe-it" value="${pe.iters}" min="1" max="100" step="1"></div>
    ${tolRow('pe-stol', 'Max. Verschiebung', pe.smoothTol)}<div class="row">${run}</div>`;
  else body = `<p class="note">Unebenheit (Streuung, Schweißspritzer, Beule) mit dem Pinsel markieren (Shift = radieren), dann <b>Entfernen &amp; füllen</b>. Aus dem umgebenden Ring wird die saubere Fläche gefittet (Ebene, Zylinder, Kugel; zwei Flächen mit scharfer Kante oder Verrundungsübergang; sonst Quadrik), das Loch mit gleicher Dreiecksdichte trianguliert und auf diese Fläche gelegt.</p>
    <div class="row"><b>${peCount}</b>&nbsp;Punkte markiert</div>
    <div class="row"><button class="btn primary" id="pe-go" ${peCount ? '' : 'disabled'}>✔ Entfernen &amp; füllen</button><button class="btn" id="pe-clear" ${peCount ? '' : 'disabled'}>Auswahl löschen</button></div>
    <div class="row"><label>Pinselradius</label><input type="number" id="pe-rad-n" value="${pe.radius}" min="0.1" step="0.1" inputmode="decimal"><span class="unit">mm</span></div>
    <div class="row pe-tol"><input type="range" id="pe-rad-r" min="0.2" max="${Math.max(1, +((state.data?.diag ?? 100) / 8).toFixed(1))}" step="0.1" value="${pe.radius}" aria-label="Pinselradius"></div>`;
  d.innerHTML = `<h3>${PE_NAME[t]}</h3>${body}
    <div class="pe-live" id="pe-live">${pe.live || `Aktuell: <b>${tris.toLocaleString('de-DE')}</b> Dreiecke`}</div>
    <h4>Vergleich</h4>
    <div class="row"><button class="btn ${pe.cmp ? 'on' : ''}" id="pe-cmp">◐ Farbvergleich zum Original ${pe.cmp ? 'an' : 'aus'}</button></div>
    ${pe.cmp && pe.devStats ? `<div class="row"><span class="note">Abweichung zum Original: +${pe.devStats.maxPos.toFixed(4)} / ${pe.devStats.maxNeg.toFixed(4)} mm</span></div>
      <div class="row"><label>Farbskala ±</label><input type="number" id="pe-scale" value="${pe.scale || ''}" placeholder="auto ${peScale().toFixed(3)}" min="0" step="0.001" inputmode="decimal"><span class="unit">mm</span></div>` : ''}
    <div class="row"><button class="btn" id="pe-undo" ${pe.undo.length ? '' : 'disabled'}>↶ Rückgängig</button><button class="btn" id="pe-reset" ${pe.undo.length ? '' : 'disabled'}>⟲ Original</button><button class="btn" id="pe-exit">Schließen</button></div>
    ${pe.edits.length ? `<p class="note">Verlauf: ${pe.edits.join(' → ')}</p>` : ''}
    <p class="note">Merkmale bleiben erhalten; ihre Punkte werden auf das bearbeitete Netz übertragen. Ist-Werte bei Bedarf in den Eigenschaften neu fitten.</p>`;
  if (t === 'reduce' || t === 'subdiv') bindTol(d, 'pe-tol', (v) => (pe.tol = v));
  if (t === 'smooth') {
    bindTol(d, 'pe-stol', (v) => (pe.smoothTol = v));
    d.querySelector<HTMLInputElement>('#pe-lam')!.onchange = (e) => { const v = +(e.target as HTMLInputElement).value; if (v > 0 && v < 1) pe.lambda = v; };
    d.querySelector<HTMLInputElement>('#pe-it')!.onchange = (e) => { const v = Math.round(+(e.target as HTMLInputElement).value); if (v >= 1) pe.iters = Math.min(100, v); };
  }
  if (t === 'erase') {
    const n = d.querySelector<HTMLInputElement>('#pe-rad-n')!, r = d.querySelector<HTMLInputElement>('#pe-rad-r')!;
    n.addEventListener('input', () => { const v = Number(n.value.replace(',', '.')); if (v > 0) { pe.radius = v; r.value = String(v); } });
    r.addEventListener('input', () => { pe.radius = +r.value; n.value = r.value; });
  }
  d.querySelector<HTMLSelectElement>('#pe-lv')?.addEventListener('change', (e) => { pe.levels = +(e.target as HTMLSelectElement).value; renderDialog(); });
  d.querySelector<HTMLInputElement>('#pe-scale')?.addEventListener('change', (e) => { const v = Number((e.target as HTMLInputElement).value.replace(',', '.')); pe.scale = isFinite(v) && v > 0 ? v : 0; renderScene(); });
  d.querySelector<HTMLInputElement>('#pe-nd')?.addEventListener('change', (e) => { const v = +(e.target as HTMLInputElement).value; if (v > 0) pe.normalDeg = v; });
  d.querySelector<HTMLInputElement>('#pe-fd')?.addEventListener('change', (e) => { const v = +(e.target as HTMLInputElement).value; if (v > 0) pe.featureDeg = v; });
  d.querySelector('#pe-go')?.addEventListener('click', () => peErase());
  d.querySelector('#pe-clear')?.addEventListener('click', () => { peClearSel(); renderAll(); });
  d.querySelector('#pe-run')?.addEventListener('click', () => peRun());
  d.querySelector('#pe-cancel')?.addEventListener('click', () => { polyEngine.cancel(); });
  d.querySelector('#pe-cmp')?.addEventListener('click', () => peToggleCompare());
  d.querySelector('#pe-undo')?.addEventListener('click', () => peUndo());
  d.querySelector('#pe-reset')?.addEventListener('click', () => peResetOriginal());
  d.querySelector('#pe-exit')?.addEventListener('click', () => peExit());
}
function setLive(html: string) { pe.live = html; const e = document.getElementById('pe-live'); if (e) e.innerHTML = html; }

async function peRun() {
  if (!state.data || pe.running) return;
  const t = pe.tool!, before = state.data.triCount, t0 = performance.now();
  const req: any = t === 'reduce' ? { op: 'decimate', tol: pe.tol, normalDeg: pe.normalDeg, featureDeg: pe.featureDeg } : t === 'subdiv' ? { op: 'subdivide', tol: pe.tol, levels: pe.levels }
    : { op: 'smooth', iterations: pe.iters, lambda: pe.lambda, tol: pe.smoothTol };
  req.mesh = curMesh();
  pe.running = true; setLive(`Läuft … <b>${before.toLocaleString('de-DE')}</b> Dreiecke`); renderDialog(); status(`${PE_NAME[t]} läuft …`);
  try {
    const r = await polyEngine.run<any>(req, (p) => setLive(t === 'smooth' ? `Iteration ${p.done} / ${pe.iters}` :
      `Läuft … <b>${p.tris.toLocaleString('de-DE')}</b> Dreiecke (${(100 * p.tris / before).toFixed(1)} %)`));
    pe.running = false;
    const label = t === 'reduce' ? `Reduktion ${pe.tol} mm` : t === 'subdiv' ? `Unterteilung ×${pe.levels} (${pe.tol} mm)` : `Glättung ${pe.iters}×λ${pe.lambda}${pe.smoothTol ? ` ≤${pe.smoothTol} mm` : ''}`;
    await applyEditedMesh(r.positions, r.indices, label);
    const after = state.data!.triCount;
    setLive(`${before.toLocaleString('de-DE')} → <b>${after.toLocaleString('de-DE')}</b> Dreiecke (${(100 * after / before).toFixed(1)} %) in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    toast(`✔ ${label}: ${before.toLocaleString('de-DE')} → ${after.toLocaleString('de-DE')} Dreiecke`);
  } catch (e: any) {
    pe.running = false;
    setLive(e.message === 'abgebrochen' ? 'Abgebrochen – Netz unverändert.' : 'Fehler: ' + e.message);
    status(e.message === 'abgebrochen' ? `${PE_NAME[t]} abgebrochen.` : 'Fehler: ' + e.message);
  }
  renderDialog();
}

/** Radierer-Auswahl: Pinsel (Radius, Blickseite) wie bei der Merkmalsauswahl; Shift = Auswahl radieren. */
let peMask: Uint8Array | null = null, peCount = 0, pePaintBusy = false, pePaintErase = false;
const peStroke: number[][] = [];
async function pePaint(h: Hit) {
  if (pePaintBusy || !state.data) return;
  if (!peMask || peMask.length !== state.data.vertexCount) { peMask = new Uint8Array(state.data.vertexCount); peCount = 0; }
  pePaintBusy = true;
  try {
    const cam = viewer.camera.position, f = [cam.x - h.point[0], cam.y - h.point[1], cam.z - h.point[2]], l = Math.hypot(f[0], f[1], f[2]) || 1;
    const r = await engine.call<any>({ op: 'brush', center: h.point, radius: pe.radius, facing: [f[0] / l, f[1] / l, f[2] / l] });
    const st = peStroke[peStroke.length - 1] ?? [];
    for (const v of r.indices as Uint32Array) {
      if (!pePaintErase && !peMask[v]) { peMask[v] = 1; peCount++; st.push(v + 1); }
      else if (pePaintErase && peMask[v]) { peMask[v] = 0; peCount--; st.push(-(v + 1)); }
    }
    renderScene(); renderModeBar(); setLive(`Ausgewählt: <b>${peCount}</b> Punkte – „Entfernen &amp; füllen“`);
  } finally { pePaintBusy = false; }
}
function peClearSel() { peMask = null; peCount = 0; peStroke.length = 0; }
function peUndoStroke() {
  const st = peStroke.pop(); if (!st || !peMask) return;
  for (let i = st.length - 1; i >= 0; i--) { const v = Math.abs(st[i]) - 1, was = st[i] > 0 ? 0 : 1; if (peMask[v] !== was) { peMask[v] = was; peCount += was ? 1 : -1; } }
  renderScene(); renderModeBar();
}
async function peErase() {
  if (pe.running || !state.data || !peMask || !peCount) { toast('Zuerst die Unebenheit mit dem Pinsel markieren.'); return; }
  const sel = new Uint32Array(peCount); let k = 0; peMask.forEach((v, i) => { if (v) sel[k++] = i; });
  pe.running = true; setLive('Entferne Auswahl, fitte Umgebung, fülle Loch …');
  try {
    const r = await busy(polyEngine.run<any>({ op: 'erase', mesh: curMesh(), sel }));
    pe.running = false;
    if (!r.loops) { setLive(r.skipped ? 'Auswahl berührt einen offenen Rand – nicht gefüllt.' : 'Nichts entfernt.'); return; }
    peClearSel();
    await applyEditedMesh(r.positions, r.indices, `Radierer (${r.surfaces.join(', ')})`);
    setLive(`Loch geschlossen: ${r.removed} Dreiecke entfernt, ${r.added} Punkte neu · Ersatzfläche: <b>${r.surfaces.join(', ')}</b>${r.skipped ? ` · ${r.skipped} offene Ränder übersprungen` : ''}`);
  } catch (e: any) { pe.running = false; setLive('Fehler: ' + e.message); }
  renderDialog(); renderModeBar();
}

/** Neues Netz übernehmen: Rückgängig-Stapel, Worker-Netz + Merkmalspunkte umrechnen, Anzeige ohne Kamerasprung, ggf. Farbvergleich neu. */
async function applyEditedMesh(positions: Float32Array, indices: Uint32Array, label: string | null, pushUndo = true) {
  if (pushUndo) { pe.undo.push({ ...curMesh(), label: label ?? '' }); if (pe.undo.length > 8) pe.undo.shift(); }
  if (!pe.origTris) pe.origTris = state.data!.triCount;
  const lists: (Uint32Array | null)[] = [];
  for (const f of state.features) lists.push(f.indices ?? null, f.auxIndices ?? null, f.src ?? null);
  const r = await busy(engine.call<any>({ op: 'setMesh', positions: positions.slice(), indices: indices.slice(), remap: lists }));
  state.features.forEach((f, i) => {
    const [a, b, c] = [r.remap[3 * i], r.remap[3 * i + 1], r.remap[3 * i + 2]];
    if (a) f.indices = a; f.auxIndices = b ?? undefined; f.src = c ?? undefined;
    if (f.dev && f.dev.length !== f.indices.length) f.dev = undefined;
  });
  ptsCache.clear();
  viewer.setModel(positions, indices, r.normals, true);
  if (label) pe.edits.push(label); else pe.edits.pop();
  state.data!.vertexCount = r.vertexCount; state.data!.triCount = r.triCount;
  $('#stats').textContent = `${r.vertexCount} Punkte · ${r.triCount} Dreiecke`;
  state.preview = null; clearBrush();
  pe.dev = null; pe.devStats = null;
  if (pe.cmp) await peCompute();
  storeMeshForAutosave(state.data!.name);
  renderAll();
}
async function peCompute() {
  const c = await busy(engine.call<any>({ op: 'compare' }));
  pe.dev = c.dev; pe.devStats = { maxPos: c.maxPos, maxNeg: c.maxNeg };
}
async function peToggleCompare() {
  if (!state.data) return;
  pe.cmp = !pe.cmp;
  if (pe.cmp && !pe.dev) await peCompute();
  renderAll();
  if (pe.cmp && pe.devStats) status(`Farbvergleich zum Original: max. +${pe.devStats.maxPos.toFixed(4)} / ${pe.devStats.maxNeg.toFixed(4)} mm`);
}
async function peUndo() {
  const u = pe.undo.pop(); if (!u) { toast('Nichts rückgängig zu machen.'); return; }
  await applyEditedMesh(u.positions, u.indices, null, false); toast('Bearbeitung rückgängig gemacht.');
}
async function peResetOriginal() {
  if (!pe.undo.length) return;
  const o = await busy(engine.call<any>({ op: 'getOriginal' }));
  pe.undo = []; await applyEditedMesh(o.positions, o.indices, null, false); pe.edits = []; pe.origTris = 0; renderAll();
  toast('Original-Polygonmodell wiederhergestellt.');
}
/** Farbskala ±: manuell oder automatisch = 99. Perzentil der geänderten Knoten (|d| > 0,1 µm), damit einzelne große Füllungen die Reduktions-Abweichungen nicht überdecken. */
function peScale() {
  if (pe.scale > 0) return pe.scale;
  const a: number[] = []; for (const x of pe.dev!) { const v = Math.abs(x); if (v > 1e-4) a.push(v); }
  if (!a.length) return 1e-3; a.sort((x, y) => x - y);
  return Math.max(1e-3, a[Math.min(a.length - 1, Math.floor(0.99 * a.length))]);
}
/** Farbkarte über das ganze Netz; liefert true, wenn aktiv (dann keine Merkmalsfarben). */
function paintPolyCompare(): boolean {
  if (!pe.cmp || !pe.dev || !viewer.colors || pe.dev.length !== viewer.colors.length / 3) return false;
  const all = new Uint32Array(pe.dev.length); for (let i = 0; i < all.length; i++) all[i] = i;
  const r = peScale();
  viewer.paintScalar(all, pe.dev, r);
  let el = document.getElementById('dev-legend');
  if (!el) { el = document.createElement('div'); el.id = 'dev-legend'; viewer.el.appendChild(el); }
  el.innerHTML = `<b>Abweichung zum Original [mm]</b><div class="bar"></div><div class="ticks"><span>${sgn(-r, 3)}</span><span>0</span><span>${sgn(r, 3)}</span></div>`;
  return true;
}
