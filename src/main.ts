import { gunzipSync } from 'fflate';
// MessWerk 3D – Benutzeroberfläche (Ribbon oben, Baumansicht links, 3D-Szene Mitte,
// Dialogbereich rechts, Prüfmerkmal-Liste unten; auf Telefonen als Overlays).
import { initCtxPanel, setCtx, CtxSpec } from './ctxpanel';
import { initLayout, setPaneOpen, paneOpen, initPanelsMenu, showAllPanes } from './layout';
import { docsHtml } from './docs';
import { provenanceOf, hardParentsOf, dependentsOf } from './core/provenance';
import { AxisAnalysis, analyzeAxis, axisNominal } from './core/axisan';
import { sideView } from './ui/axisview';
import { TRIM_TYPES, trimmedSurface, CURVE_TRIM_TYPES, trimmedCurve } from './core/trim';
import { REEX_TYPES, bindReex, initReexUI, reexHTML, reexPreview } from './ui/reexui';
/** cache of trimmed geometry per feature (key: fit centre + point count) */
const trimCache = new Map<number, { key: string; tri: Float32Array; edges: Float32Array }>();
const curveCache = new Map<number, { key: string; seg: Float32Array | null }>();
/** covered arc / segment of a circle, slot or line (null = whole closed curve → normal display) */
function curveTrimFor(f: FeatureView) {
  const key = f.measured!.center.join(',') + '|' + f.measured!.radius + '|' + f.indices.length;
  const c = curveCache.get(f.id); if (c && c.key === key) return c.seg;
  const pts = featPoints(f.id); const seg = pts ? trimmedCurve(f.measured!, pts) : null; curveCache.set(f.id, { key, seg }); return seg;
}
function trimFor(f: FeatureView) {
  const key = f.measured!.center.join(',') + '|' + f.measured!.radius + '|' + f.indices.length;
  const c = trimCache.get(f.id); if (c && c.key === key) return c;
  const g = viewer.model!.geometry; if (!g.index) return null;
  const r = trimmedSurface(f.measured!, g.getAttribute('position').array as Float32Array, g.index.array as ArrayLike<number>, f.indices);
  const e = { key, ...r }; trimCache.set(f.id, e); return e;
}
import { t as tt, typeName, kindName, methodName } from './i18n';
import { showWhatsNew, versionText, maybeShowWhatsNew } from './changelog';
import { initProgress, progressBegin, progressEnd, progressUpdate } from './progress';
import { Engine, PolyEngine } from './engine';
import { Viewer, Hit } from './viewer';
import { FitResult, GeomType, anchorFit } from './core/fit';
import {
  Control, ControlKind, Feature, availableControls, computeDistance, controlLabel, controlsCSV,
  defaultTolerance, evaluate, featureCSV, DEG, FORM_NAME, AuxPlane, controlCatalog,
} from './core/features';
import { Report, buildReport, reportCSV, reportHTML, reportTablesHTML } from './core/report';
import { evalBSpline } from './core/curves';
import { initCad, cadOpen, cadTree, cadDialog, cadActive, setCadEdges, cadEdgesOn } from './cadui';
import { simulateDatums, DatumAssoc } from './core/datumsim';
import { DERIVES, derivesFor, runDerive } from './core/derive';
import { axisColorScale } from './core/axisan';
import { defaultDia } from './core/median';
import { DATUM_COUNT, DATUM_LETTERS, buildDRF, datumKind, dirLocal, isDatumControl, toLocal, NOMINAL_MISSING, NOMINAL_UNCONFIRMED, isPattern, tedSpec, resolveBasic, TedField } from './core/datum';
import { datumText, isZoneControl, MOD_SYM } from './core/features';
import { statusText } from './core/report';
import { idbDel, idbGet, idbSet, packIndices, readProject, unpackIndex, writeProject } from './project';
import { Tour, TourStep } from './training';
import { type Vec3, sub, scale, dot, norm, add, basis, cross, unit } from './core/linalg';
import type { LabelSpec } from './overlay';
import { ICON } from './icons';
import { CONSTRUCTIONS, CON_OUTS, Construction, accepts, conByKey, constructionsFor, recomputeOrder, runConstruction, slotFor } from './core/construct';
import { CSys, Axis, Frame, computeCSys, newCSys, toLocal as csLocal, dirLocal as csDir, usableAs, suggestOrigin, nextEmptyField } from './core/csys';
import { NurbsParams, evalSurface, insideTrim, toIGES, toJSON, toSTEP } from './core/nurbs';

type FitMode = { kind: 'fit'; type: GeomType | 'auto'; method: 'Klick' | 'Pinsel' };
type DimComp = '3D' | 'X' | 'Y' | 'Z';
type DistMode = { kind: 'dist'; a: number | null; b: number | null; slot: 0 | 1; comp: DimComp };
type ConMode = { kind: 'con'; out: GeomType; key: string; refs: (number | null)[]; slot: number; params: Record<string, number> };
type AnchorMode = { kind: 'anchor'; out: GeomType | 'Abstand'; pts: Vec3[]; nrm: Vec3[] };
type Mode = FitMode | DistMode | ConMode | AnchorMode | null;
/** Anchor: mathematical minimum of picked points per feature type. */
const ANCHOR_N: Partial<Record<GeomType | 'Abstand', number>> = { Punkt: 1, Linie: 2, Ebene: 3, Kreis: 3, Kugel: 4, Zylinder: 5, Kegel: 6, Abstand: 2 };
interface FitParamsUI { k: number; nf: { on: boolean; angleDeg: number; maxPct: number }; maxAngleDeg: number; radius: number; aux: 'auto' | 'ring' | 'none' | number; ring?: { gap: number; width: number }; }
interface FeatureView extends Feature { color: number; colorSet?: boolean; dim?: { comp: DimComp }; indices: Uint32Array; candidates?: { type: string; rms: number }[]; auxIndices?: Uint32Array;
  src?: Uint32Array; hit?: Hit; fp?: FitParamsUI; dev?: Float32Array; }
interface PreviewAux { plane: FitResult; indices: Uint32Array; source: string; refId?: number; }
interface Preview { fit: FitResult; indices: Uint32Array; candidates: { type: string; rms: number }[]; method: 'Klick' | 'Pinsel' | 'Konstruiert'; refs?: number[];
  aux?: PreviewAux; hit?: Hit; dev?: Float32Array; /** multi-seed plane: index sets of the merged regions */ regions?: Uint32Array[]; }
type V3 = [number, number, number];
interface CurveView { id: number; name: string; kind: 'Kante' | 'Tangente' | 'Übergang' | 'Benutzer' | 'Vorschlag'; visible: boolean; chain: number[]; closed: boolean; ctrl: number[][]; pts: number[][]; length: number; }

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
  opts: { maxAngleDeg: 20, radius: 0, brush: 3, aux: 'auto' as 'auto' | 'ring' | 'none' | number, lineSide: 0 as 0 | 1, ring: { gap: 0.5, width: 3 }, multi: false, datumAssoc: 'iso' as DatumAssoc, datumFilter: true, newDatum: '' as string },
  an: { on: false, kind: 'form' as AnKind, ids: [] as number[], res: null as AnResult | null, whisk: false, exag: 50, axExag: 0, axLoc: 1, axHide: false, axEnv: true, axZones: true, derivePrev: null as { key: string; parent: number; fit: FitResult } | null, ctrl: null as number | null, trans: true, scale: 0, steps: 0, center: 'zone' as 'zone' | 'zero' | 'custom', c0: 0, zones: false },
  hidden: new Set<number>(), modelVisible: true, showLabels: true,
  /** per-feature: annotation hidden (geometry stays) */
  hiddenLabels: new Set<number>(),
  /** model node selected in tree / 3D (dialog shows the polygon model) */
  selModel: false,
  /** annotation contents (optional rows) */
  annot: { pts: false, std: false },
  /** feature colors: sequential palette or one uniform color */
  colorMode: 'sequential' as 'sequential' | 'uniform', uniformColor: 0x1f77b4,
  /** filter of the All Controls list */
  ctrlFilter: false,
  labelOffsets: new Map<number, V3>(),
  /** local coordinate systems (3-2-1); activeCs null = global WCS */
  csys: [] as CSys[], activeCs: null as number | null, nextCs: 1, csSel: null as number | null, showCs: true,
  csEdit: null as null | { draft: CSys; orig: CSys | null; field: CsField | null; activate: boolean },
  reports: [] as Report[], nextReport: 1, openReport: null as number | null,
  ctab: 'katalog' as 'katalog' | 'liste',
  brushMask: null as Uint8Array | null,
  brushCount: 0,
  showPrims: true, trimGeo: true, colorPts: true, devMap: true, ctrlNet: true,
  nurbs: { nu: 12, nv: 12, deg: 3, smooth: 1e-4 } as NurbsParams,
  nextId: 1, nextCtrl: 1, typeCount: {} as Record<string, number>,
  addFeat: null as number | null,
  curves: [] as CurveView[], nextCurve: 1, curveSel: null as number | null, showLayout: false,
  layout: null as null | { nodes: { p: number[]; degree: number; v: number }[]; corners: { v: number; kind: string; p: number[] }[]; suggestions: (CurveView & { reason: string; region: number })[]; regions: { faces: number; sides: number; loops: number; area: number; center: number[] }[]; regionOf: Int32Array; tJunctions: number; foursided: number },
};
initReexUI({ geometry: () => viewer.model?.geometry, renderAll: () => renderAll(), toast: (t) => toast(t), invalidate: (id) => { ptsCache.delete(id); trimCache.delete(id); curveCache.delete(id); },
  recompute: () => recomputeDistances(), autosave: () => scheduleAutosave() });
(window as any).__app = { state, viewer, engine, refitFeature: (...a: any[]) => (refitFeature as any)(...a) };
type PeTool = 'reduce' | 'subdiv' | 'smooth' | 'erase' | 'curve' | 'curveopts';
const PE_NAME: Record<PeTool, string> = { curveopts: 'Curve network options', curve: 'Draw curve', reduce: 'Triangle reduction', subdiv: 'Triangle subdivision', smooth: 'Smoothing', erase: 'Magic eraser' };
const pe = {
  tool: null as PeTool | null,
  tol: 0.02, normalDeg: 10, featureDeg: 30, maxEdge: 0, minAngle: 0, levels: 1, iters: 5, lambda: 0.5, smoothTol: 0.02, radius: 3,
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
/** Vertex normals belonging to featPoints(fid) (same order) – material side for the ISO 5459 datum simulation. */
const nrmOf = new WeakMap<Vec3[], Vec3[]>();
function featNormals(fid: number): Vec3[] | null {
  const P = featPoints(fid); if (!P) return null; const hit = nrmOf.get(P); if (hit) return hit;
  const f = state.features.find((x) => x.id === fid), na = viewer.model?.geometry.getAttribute('normal')?.array as Float32Array | undefined; if (!f || !na) return null;
  const step = Math.max(1, Math.ceil(f.indices.length / 6000)), out: Vec3[] = [];
  for (let i = 0; i < f.indices.length; i += step) { const v = f.indices[i]; out.push([na[3 * v], na[3 * v + 1], na[3 * v + 2]]); }
  nrmOf.set(P, out); return out;
}
const ctx = { points: featPoints, normals: featNormals, get datumAssoc() { return state.opts.datumAssoc; }, get datumFilter() { return state.opts.datumFilter !== false; }, get frame() { return activeFrame(); }, get controls() { return state.controls; } };
let showCurves = true;
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
async function busy<T>(p: Promise<T>, label = tt('Computing …')): Promise<T> {
  progressBegin(label);
  try { return await p; } finally { progressEnd(); }
}

// ------------------------------------------------------------------ Ribbon
document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll<HTMLElement>('.panel').forEach((p) => p.classList.toggle('hidden', p.dataset.tab !== b.dataset.tab));
  renderDialog();
}));
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => (b.onclick = () => viewer.view(b.dataset.view as any)));
$('#ico-dist').innerHTML = ICON['Abstand 3D'];

const TYPES: (GeomType | 'auto')[] = ['auto', 'Ebene', 'Kreis', 'Zylinder', 'Langloch', 'Linie', 'Kegel', 'Kugel', 'Torus', 'Punkt', 'Freiformfläche'];
const FIT_TYPES = TYPES.filter((t) => t !== 'auto') as GeomType[];
const typeBtns = $('#feat-type-btns');
for (const t of TYPES) {
  const tr = (x: string) => tt(x);
  const b = document.createElement('button');
  b.className = 'big'; b.dataset.ftype = t;
  b.innerHTML = `<span class="ico">${ICON[t]}</span>${t === 'Freiformfläche' ? tr('Freeform') : typeName(t)}`;
  if (t === 'Freiformfläche') b.title = tr('Freeform surface (B-spline/NURBS) – click or brush');
  b.onclick = () => startFitMode(t);
  if (t !== 'auto' && t !== 'Freiformfläche') {
    // split button: main part = From polygon model, ▾ = method menu (Construction, Anchor, CAD later)
    const w = document.createElement('span'); w.className = 'split'; const dd = document.createElement('button'); dd.className = 'split-dd'; dd.textContent = '▾';
    dd.title = tr('Choose the creation method'); dd.onclick = (e) => { e.stopPropagation(); splitMenu(dd, t as GeomType); };
    w.append(b, dd); typeBtns.appendChild(w);
  } else typeBtns.appendChild(b);
}
{ // Polyline: no nominal on the polygon model → only From CAD reference (later) or Derived from Analyze
  const b = document.createElement('button'); b.className = 'big'; b.id = 'btn-polyline'; b.innerHTML = `<span class="ico">${ICON['Linienzug']}</span>${typeName('Linienzug')}`;
  b.title = tt('Polyline (connected line segments). Not from the polygon model (it has no nominal there): derive it in Analyze (e.g. the median line of a bore) – From CAD reference comes later');
  b.onclick = (e) => { e.stopPropagation(); ctxMenu.className = 'ctx-menu'; const items: [string, (() => void) | null][] = [[tt('From CAD reference (later)'), null],
    [`🔗 ${tt('Derived from Analyze')}`, () => { (document.querySelector('.tab[data-tab="analyze"]') as HTMLButtonElement)?.click(); toast(tt('Analyze a cylinder/cone (axis view), then 🔗 Derive › Derived median line (Polyline).')); }]];
    ctxMenu.innerHTML = items.map(([l, f], i) => `<button data-i="${i}" ${f ? '' : 'disabled'}>${l}</button>`).join('');
    ctxMenu.querySelectorAll<HTMLButtonElement>('button').forEach((x) => (x.onclick = () => { ctxMenu.classList.add('hidden'); items[+x.dataset.i!][1]?.(); }));
    const r = b.getBoundingClientRect(); ctxMenu.style.left = Math.min(r.left, innerWidth - 220) + 'px'; ctxMenu.style.top = r.bottom + 2 + 'px'; };
  typeBtns.appendChild(b); }
{ const w = document.createElement('span'); w.className = 'split'; const dd = document.createElement('button'); dd.className = 'split-dd'; dd.textContent = '▾'; dd.title = tt('Choose the creation method');
  dd.onclick = (e) => { e.stopPropagation(); splitMenu(dd, 'Abstand'); }; w.append($('#btn-distance'), dd); typeBtns.appendChild(w); }
function splitMenu(anchorEl: HTMLElement, t: GeomType | 'Abstand') {
  const items: [string, (() => void) | null][] = [
    [t === 'Abstand' ? tt('Between features') : tt('From polygon model'), () => (t === 'Abstand' ? startDistanceMode() : startFitMode(t))],
    [`🔗 ${tt('Construction')}`, t !== 'Abstand' && constructionsFor(t).length ? () => startConstruct(t) : null],
    [`📍 ${tt('Anchor')}${ANCHOR_N[t] ? ` (${ANCHOR_N[t]} ${tt('pts')})` : ''}`, ANCHOR_N[t] ? () => startAnchor(t) : null],
    [tt('From CAD reference (later)'), null]];
  ctxMenu.className = 'ctx-menu';
  ctxMenu.innerHTML = items.map(([l, f], i) => `<button data-i="${i}" ${f ? '' : 'disabled'}>${l}</button>`).join('');
  ctxMenu.querySelectorAll<HTMLButtonElement>('button').forEach((x) => (x.onclick = () => { ctxMenu.classList.add('hidden'); items[+x.dataset.i!][1]?.(); }));
  const r = anchorEl.getBoundingClientRect(); ctxMenu.style.left = Math.min(r.left, innerWidth - 220) + 'px'; ctxMenu.style.top = r.bottom + 2 + 'px';
}
$('#btn-distance').onclick = () => startDistanceMode();
$('#ico-ff2').innerHTML = ICON['Freiformfläche'];
document.querySelectorAll<HTMLButtonElement>('#ribbon [data-tab="re"] [data-ftype]').forEach((b) => (b.onclick = () => startFitMode(b.dataset.ftype as GeomType)));

function startFitMode(t: GeomType | 'auto') {
  if (!state.data) { status('Please load a polygon model first.'); return; }
  pe.tool = null;
  // Typwahl im Menüband startet immer mit „Klick + Wachstum“ – ein vergessener Pinsel blockiert so nie die Extraktion
  state.mode = { kind: 'fit', type: t, method: 'Klick' };
  state.preview = null; clearBrush(); renderAll();
}
function startDistanceMode() {
  pe.tool = null;
  if (state.features.filter((f) => f.type !== 'Abstand').length < 2) { toast(tt('Fewer than two features – distance between two clicked points (Anchor).')); startAnchor('Abstand'); return; }
  const s = state.sel.filter((id) => state.features.find((f) => f.id === id)?.type !== 'Abstand');
  state.mode = { kind: 'dist', a: s[0] ?? null, b: s[1] ?? null, slot: s[0] != null && s[1] == null ? 1 : 0, comp: (state.mode as DistMode | null)?.comp ?? '3D' };
  state.labelOffsets.delete(-1);
  state.preview = null; clearBrush();
  updateDistancePreview(); renderAll();
  if (isPhone()) togglePanel('dialog', true);
}
function stopMode() {
  state.mode = null; state.preview = null; clearBrush(); clearAuxHover();
  viewer.controls.enabled = true; viewer.showCursor(null, 1); renderAll();
}

$('#file').onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
  await loadBuffer(f.name, await f.arrayBuffer(), true);
  (e.target as HTMLInputElement).value = '';
};
// ---------- Beispielteile (Auswahl mit Vorschaubild)
interface SampleInfo { key: string; name: string; file: string; description: string; triangles: number; bytes: number; thumb: string; kind: string; hidden?: boolean; default?: boolean; cad?: boolean }
let samples: SampleInfo[] | null = null;
async function loadSample(s: SampleInfo) {
  $('#sample-dialog').classList.add('hidden');
  status(`${tt('Loading')} ${s.name} (${(s.bytes / 1048576).toFixed(1)} MB) …`); $('#busy').classList.remove('hidden');
  try {
    const r = await fetch('./samples/' + s.file); if (!r.ok) throw new Error('HTTP ' + r.status);
    if (s.cad) { // CAD sample: gzip → IGES/STEP into the CAD trimming module
      let b = new Uint8Array(await r.arrayBuffer()); if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
      await cadOpen(new File([b as any], s.file.replace(/\.gz$/, ''))); document.querySelector<HTMLElement>('.tab[data-tab="nuetz"]')?.click();
    } else await loadBuffer(s.file, await r.arrayBuffer());
  } catch (e: any) { toast('Sample could not be loaded: ' + e.message); } finally { $('#busy').classList.add('hidden'); }
}
async function openSamples() {
  const d = $('#sample-dialog');
  if (!samples) { try { samples = await (await fetch('./samples/index.json')).json(); } catch { samples = []; } }
  const std = samples!.find((s) => s.key === 'beispielteil');
  if (tour && std) { loadSample(std); return; } // Trainingsmodus: immer das Standard-Beispielteil direkt laden
  d.innerHTML = `<div class="rv-head"><b>${tt('Load sample part')}</b><span class="note">${tt('Demo measurement data (scan/CT-like) – nominal geometry in samples/*.json')}</span><span style="flex:1"></span><button class="btn" id="sd-close">✕</button></div>
    <div class="sd-grid">${samples!.filter((s) => !s.hidden).map((s) => `<button class="sample-card" data-key="${s.key}"><img src="./samples/${s.thumb}" alt="" loading="lazy"><span class="sc-t">${s.name}</span>
      <span class="sc-d">${s.description}</span><span class="sc-m">${s.kind} · ${(s.triangles / 1000).toFixed(0)} k ${tt('triangles')} · ${(s.bytes / 1048576).toFixed(1)} MB</span></button>`).join('')}</div>`;
  d.classList.remove('hidden');
  ($('#sd-close') as HTMLButtonElement).onclick = () => d.classList.add('hidden');
  d.querySelectorAll<HTMLButtonElement>('.sample-card').forEach((b) => (b.onclick = () => loadSample(samples!.find((s) => s.key === b.dataset.key)!)));
}
$('#btn-sample').onclick = () => openSamples();
$('#btn-csv').onclick = () => download('pruefmerkmale.csv', controlsCSV(state.controls, featMap(), ctx));
$('#btn-report').onclick = () => makeReport();
$('#btn-report2').onclick = () => makeReport();
$('#btn-toggle-labels').onclick = () => { state.showLabels = !state.showLabels; renderScene(); renderRibbon(); syncViewToggles(); };
$('#btn-csv-feat').onclick = () => download('merkmale.csv', featureCSV(state.features, ctx));
$('#btn-delete-feat').onclick = () => deleteSelected();
$('#btn-toggle-prims').onclick = () => { state.showPrims = !state.showPrims; renderScene(); renderRibbon(); syncViewToggles(); };
$('#btn-toggle-wire').onclick = () => toggleWire();
$('#btn-toggle-curves').onclick = () => toggleCurves();
$('#btn-view-center').onclick = () => centerOn();
$('#btn-view-fit').onclick = () => viewer.view('fit');
$('#btn-toggle-pts').onclick = () => { state.colorPts = !state.colorPts; renderScene(); renderRibbon(); };

function download(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  status(`${name} exportiert.`);
}

const UNITS: { id: string; label: string; f: number }[] = [{ id: 'mm', label: 'mm', f: 1 }, { id: 'cm', label: 'cm', f: 10 }, { id: 'm', label: 'm', f: 1000 }, { id: 'in', label: 'Zoll (inch)', f: 25.4 }];
/** Einheit wählen: Bounding-Box in Datei-Einheiten, Vorschlag aus der Größe, Plausibilität (typisch 5 mm … 2 m). */
function unitDialog(b: { min: number[]; max: number[] }): Promise<number> {
  const d = [0, 1, 2].map((k) => b.max[k] - b.min[k]); const big = Math.max(...d);
  const guess = big < 2 ? 'm' : big < 40 ? 'cm' : 'mm';
  return new Promise((res) => {
    const el = document.createElement('div'); el.id = 'unit-dlg';
    const draw = (u: string) => { const f = UNITS.find((x) => x.id === u)!.f; const mm = d.map((x) => x * f); const mx = Math.max(...mm);
      const ok = mx >= 5 && mx <= 2000;
      el.innerHTML = `<div class="ud-box"><h3>${tt('File unit')}</h3>
        <p class="note">${tt('Bounding box in file units')}: <b>${d.map((x) => fmt(x, 3)).join(' × ')}</b></p>
        <div class="seg">${UNITS.map((x) => `<button data-u="${x.id}" class="${x.id === u ? 'on' : ''}">${x.label}</button>`).join('')}</div>
        <p>${tt('Gives')} <b>${mm.map((x) => fmt(x, 1)).join(' × ')} mm</b>${u === guess ? ` <span class="note">(${tt('suggested')})</span>` : ''}</p>
        <p class="${ok ? 'ud-ok' : 'ud-warn'}">${ok ? tt('✓ Plausible part size.') : mx < 5 ? tt('⚠ Very small (< 5 mm) – is the unit correct?') : tt('⚠ Very large (> 2 m) – is the unit correct?')}</p>
        <div class="row"><button class="btn primary" data-ok>${tt('Apply')}</button></div></div>`;
      el.querySelectorAll<HTMLButtonElement>('[data-u]').forEach((x) => (x.onclick = () => draw(x.dataset.u!)));
      el.querySelector<HTMLButtonElement>('[data-ok]')!.onclick = () => { el.remove(); res(f); }; };
    draw(guess); document.body.appendChild(el);
  });
}
async function loadBuffer(name: string, buf: ArrayBuffer, askUnit = false, scale = 1): Promise<void> {
  try {
    const t0 = performance.now(); const keep = askUnit ? buf.slice(0) : null;
    const r = await busy(engine.call<any>({ op: 'load', name, buffer: buf, scale } as any, [buf]), `Import ${name}`);
    if (keep) { const f = await unitDialog(r.bounds); if (f !== 1) return loadBuffer(name, keep, false, f); }
    viewer.setModel(r.positions, r.indices, r.normals); peReset(); curvesReset();
    state.data = { name: r.name, vertexCount: r.vertexCount, triCount: r.triCount, diag: r.bounds.diag };
    state.features = []; state.controls = []; state.sel = []; state.mode = null; state.preview = null;
    if (!isPhone()) showAllPanes(); // new project: all panels visible
    state.hidden.clear(); state.labelOffsets.clear(); state.modelVisible = true; state.typeCount = {};
    state.reports = []; state.openReport = null; state.nextId = 1; state.nextCtrl = 1; state.nextReport = 1; ptsCache.clear();
    loadCount++; storeMeshForAutosave(r.name); $('#restore-bar').classList.add('hidden');
    state.opts.brush = +(r.bounds.diag / 25).toFixed(1);
    $('#projname').textContent = r.name;
    status(tt('{0} loaded in {1} s.', name, ((performance.now() - t0) / 1000).toFixed(1)));
    $('#stats').textContent = `${r.vertexCount.toLocaleString('en-US')} points · ${r.triCount.toLocaleString('en-US')} triangles`; showBBoxInfo(r.bounds);
    renderAll();
  } catch (e: any) { status('Import error: ' + e.message); }
}

// ------------------------------------------------------------------ 3D-Interaktion
let down: { x: number; y: number; t: number } | null = null;
let painting = false;
canvas.addEventListener('pointerdown', (e) => {
  document.body.classList.remove('show-tree', 'show-dialog');
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
  if (e.isPrimary && (e.pointerType !== 'mouse' || e.button === 0) && curveDragStart(e.clientX, e.clientY)) return;
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
  if (cv.drag) { curveDragMove(e.clientX, e.clientY); return; }
  if (e.pointerType === 'mouse' && !e.buttons) curveHover(e.clientX, e.clientY);
  const desk = e.pointerType === 'mouse';
  if (pe.tool === 'erase') { const h = viewer.pick(e.clientX, e.clientY); lastHit = h; viewer.showCursor(h, pe.radius, desk); if (painting && h) pePaint(h); return; }
  if (state.mode?.kind === 'fit' && state.mode.method === 'Klick' && desk && !e.buttons) {
    const h = viewer.pick(e.clientX, e.clientY); lastHit = h;
    // Klick + Wachstum mit Suchradius: Saatbereich als Kreis zeigen
    viewer.showCursor(state.opts.radius > 0 ? h : null, state.opts.radius, true);
    scheduleAuxHover(h); return;
  }
  if (state.mode?.kind !== 'fit' || state.mode.method !== 'Pinsel') return;
  const h = viewer.pick(e.clientX, e.clientY); lastHit = h;
  viewer.showCursor(h, state.opts.brush, desk);
  if (painting && h) brushAt(h);
});
// Rechtsklick (ohne Ziehen) = Polylinie/Kurve abschließen; Rechts-Ziehen bleibt Verschieben
let rdown: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button === 2) rdown = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => { if (e.button !== 2 || !rdown) return; const d = Math.hypot(e.clientX - rdown.x, e.clientY - rdown.y); rdown = null;
  if (d > 6) return; if (pe.tool === 'curve' && curveDraft.length > 1) { curveFinish(); return; } window.dispatchEvent(new CustomEvent('mw-rclick')); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerleave', () => { if (!painting) { viewer.showCursor(null, 1); clearAuxHover(); } });
let lastHit: Hit | null = null;
/** Pinsel aktiv (Fit-Pinsel oder Polygon-Radierer)? Dann ändert das Mausrad den Radius, Strg+Rad zoomt. */
const brushActive = () => pe.tool === 'erase' || state.mode?.kind === 'fit';
const areaMode = () => state.mode?.kind === 'fit' && state.mode.method === 'Klick';
function setBrushRadius(v: number) {
  v = +Math.min(Math.max(v, 0.05), (state.data?.diag ?? 1000) / 2).toFixed(v < 1 ? 2 : 1);
  if (areaMode() && pe.tool !== 'erase') { state.opts.radius = v; const a = document.querySelector<HTMLInputElement>('#cp-area'); if (a) a.value = String(v); const d = document.querySelector<HTMLInputElement>('#d-rad'); if (d) d.value = String(v);
    if (lastHit) viewer.showCursor(lastHit, v, true); status(tt('Analysis area r = {0} mm (mouse wheel; Ctrl+wheel = zoom).', v)); return; }
  if (pe.tool === 'erase') { pe.radius = v; for (const id of ['#pe-rad-n', '#pe-rad-r']) { const el = document.querySelector<HTMLInputElement>(id); if (el) el.value = String(v); } }
  else { state.opts.brush = v; const el = document.querySelector<HTMLInputElement>('#d-brush'); if (el) el.value = String(v); const mb = document.querySelector('#mb-brush-r'); if (mb) mb.textContent = String(v); }
  if (lastHit) viewer.showCursor(lastHit, v, true);
  status(`Pinselradius ${v} mm (Mausrad; Strg+Mausrad = Zoom).`);
}
canvas.parentElement!.addEventListener('wheel', (e) => {
  if (!brushActive() || e.ctrlKey || e.metaKey) return; // Strg/⌘ + Rad: normal zoomen
  e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
  const cur = pe.tool === 'erase' ? pe.radius : areaMode() ? state.opts.radius || (state.data?.diag ?? 100) / 30 : state.opts.brush;
  setBrushRadius(cur * Math.pow(1.1, e.deltaY > 0 ? -1 : 1));
}, { capture: true, passive: false });
// Ctrl+Rad soll im Pinselmodus zoomen statt die Seite zu skalieren: OrbitControls übernimmt (preventDefault dort)
// ---- Live-Vorschau Hilfsebene (Kreis/Langloch per Klick): Ebenenpunkte blau, Wandpunkte orange
let auxT = 0, auxSeq = 0, auxBusy = false, hoverType: string | null = null;
function clearAuxHover() { clearTimeout(auxT); auxSeq++; viewer.showHoverSets([]); if (hoverType) { hoverType = null; renderModeBar(); } }
function scheduleAuxHover(h: Hit | null) {
  clearTimeout(auxT); const m = state.mode as FitMode | null;
  if (!h || !m || m.kind !== 'fit' || m.type === 'Freiformfläche' || state.preview) { if (!h) viewer.showHoverSets([]); return; }
  const seq = ++auxSeq;
  auxT = window.setTimeout(async () => {
    if (seq !== auxSeq) return;
    if (auxBusy) { scheduleAuxHover(h); return; } // höchstens eine Vorschau-Rechnung gleichzeitig
    auxBusy = true;
    const ref = typeof state.opts.aux === 'number' ? state.features.find((f) => f.id === state.opts.aux) : undefined;
    try {
      if (!usesAux(m.type)) { // Live-Vorschau des erkannten Typs (Auto bzw. gewählter Typ)
        const r = await engine.call<any>({ op: 'grow', tri: h.tri, point: h.point, maxAngleDeg: state.opts.maxAngleDeg, radius: state.opts.radius, type: m.type });
        if (seq !== auxSeq || state.preview) return;
        viewer.showHoverSets([...(r.aux ? [{ idx: r.aux.indices, color: 0x2f7de1 }] : []), { idx: r.indices, color: 0xff8c1a }]);
        hoverType = r.fit.type; renderModeBar();
        status(tt('Hover: {0} ({1} pts) – click to preview.', typeName(r.fit.type) + (r.aux ? ' + ' + tt('aux. plane') : ''), r.indices.length)); return;
      }
      const r = await auxCall(h.tri, h.point, state.opts.maxAngleDeg, m.type as GeomType, ref);
      if (seq !== auxSeq || state.preview) return;
      viewer.showHoverSets([{ idx: r.aux.indices, color: 0x2f7de1 }, { idx: r.indices, color: 0xff8c1a }]);
      status(tt('Hover preview: {0} wall points (orange), {1} aux. plane points (blue) – click to take it.', r.indices.length, r.aux.indices.length));
    } catch (err: any) { if (seq === auxSeq) { viewer.showHoverSets([]); status(tt('Preview: no auxiliary plane combination here ({0})', err.message)); } } finally { auxBusy = false; }
  }, 220);
}
window.addEventListener('pointerup', async (e) => {
  if ((e as any).cadHandled) { down = null; return; }
  if (painting) { painting = false; viewer.controls.enabled = true; down = null; return; }
  if (cv.drag) { const d0 = down; down = null; const tap = d0 && Math.hypot(e.clientX - d0.x, e.clientY - d0.y) < 8; if (tap) cv.drag.moved = false; await curveDragEnd(); if (!tap) return; await curveClick(e.clientX, e.clientY); return; }
  if (!down || e.target !== canvas) { down = null; return; }
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
  down = null;
  if (moved > 8 || dt > 700) return;
  if (!state.mode && await curveClick(e.clientX, e.clientY)) return;
  const h = viewer.pick(e.clientX, e.clientY);
  if (!h) { if (!state.mode && !pe.tool) clearSelection(); return; }
  if (pe.tool === 'curve') curveAddPoint(h);
  else if (state.mode?.kind === 'fit' && state.mode.method === 'Klick') { clearAuxHover(); await previewByClick(h, e.shiftKey); }
  else if (state.mode?.kind === 'anchor') anchorPick(h);
  else if (state.mode?.kind === 'dist') pickFeatureForDistance(h);
  else if (state.mode?.kind === 'con') { const f = featureAtHit(h); if (f) conPick(f.id); else status(tt('No feature at this location.')); }
  else if (state.csEdit) { const f = featureAtHit(h); if (f) selectFeature(f.id); else status(tt('No feature at this location.')); }
  else if (!pe.tool) { const f = featureAtHit(h); if (f) selectFeature(f.id); else selectModel(); }
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
  const st = brushUndo.pop(); if (!st || !state.brushMask) { toast('Nothing to undo.'); return; }
  for (let i = st.length - 1; i >= 0; i--) { const v = Math.abs(st[i]) - 1; const was = st[i] > 0 ? 0 : 1; if (state.brushMask[v] !== was) { state.brushMask[v] = was; state.brushCount += was ? 1 : -1; } }
  state.preview = null; renderAll(); status(tt('Brush stroke undone – {0} points marked.', state.brushCount));
}
function clearBrush() { state.brushMask = state.data ? new Uint8Array(state.data.vertexCount) : null; state.brushCount = 0; brushUndo.length = 0; }
function clearSelectionAll() {
  const had = state.brushCount > 0 || !!state.preview;
  clearBrush(); state.preview = null; renderAll(); status(had ? tt('Selection cleared.') : tt('No selection.'));
}
function setMethod(m: 'Klick' | 'Pinsel') {
  if (state.mode?.kind !== 'fit') return;
  state.mode.method = m; state.preview = null; clearBrush(); brushErase = false; viewer.showCursor(null, 1); clearAuxHover(); renderAll();
}
// ------------------------------------------------------------------ Bottom context panel (one for all modes and previews)
initCtxPanel(viewer.el); initProgress(viewer.el); initLayout(); initPanelsMenu(viewer.el, (s) => tt(s), (p, on) => { if (isPhone()) togglePanel(p, on); });
const typeOptions = (cur: string, withAuto = true) => [...(withAuto ? ['auto'] : []), ...FIT_TYPES].map((x) => `<option value="${x}" ${x === cur ? 'selected' : ''}>${typeName(x)}</option>`).join('');
const formName = (t: GeomType) => FORM_NAME[t];
const patchKind = (k: string) => (k === 'vierseitig' ? tt('four-sided') : k === 'getrimmt' ? tt('trimmed') : k);
function sizeRows(f: FitResult): [string, string][] {
  const r: [string, string][] = [];
  if (f.radius != null && f.type !== 'Langloch') r.push([tt('Ø'), fmt(2 * f.radius)]);
  if (f.type === 'Langloch') r.push([tt('Length'), fmt(f.length)], [tt('Width'), fmt(f.width)]);
  if (f.type === 'Linie') r.push([tt('Length'), fmt(f.length)]);
  return r;
}
/** compact statistics of the current preview */
function previewStats(p: Preview): string {
  if (p.method === 'Konstruiert') return '';
  const rows = p.aux ? [[tt('Points'), String(p.indices.length)], [tt('RMS'), fmt(p.fit.rms)], [formName(p.fit.type), fmt(p.fit.form)], ...sizeRows(p.fit), [tt('Aux. plane'), p.aux.refId ? nameOf(p.aux.refId) : `${p.aux.indices.length} ${tt('pts')}`]]
    : [[tt('Points'), String(p.indices.length)], ...fitRows(p.fit, p.indices.length, false)];
  return `<span class="cp-type">${ICON[p.fit.type] ?? ''} ${typeName(p.fit.type)}</span>` + rows.map(([k, v]) => `<span class="cp-kv"><small>${k}</small><b>${v}</b></span>`).join('');
}
function renderModeBar() {
  const spec = ctxSpec(); setCtx('mesh', spec); setCtx('tool', analysisSpec());
}
function ctxSpec(): CtxSpec | null {
  if (!state.data) return null;
  if (pe.tool === 'curve') return { title: `〰 ${tt('Draw curve')} · <b>${curveDraft.length}</b> ${tt('pts')}`,
    ok: { run: () => curveFinish(), disabled: curveDraft.length < 2, title: tt('Create curve') }, undo: { run: () => { curveDraft.pop(); renderAll(); }, disabled: !curveDraft.length }, cancel: { run: () => peExit() } };
  if (pe.tool === 'erase') return { title: `✧ ${tt('Magic eraser')}`, cls: 'brush',
    controls: `<label>r <input id="cp-rad" type="number" min="0.1" step="0.1" value="${pe.radius}" inputmode="decimal"> mm</label><span><b>${peCount}</b> ${tt('pts')}</span>
      <button data-a="pe-clear" ${peCount ? '' : 'disabled'}>${tt('Clear selection')}</button><button data-a="pe-undo" ${pe.undo.length ? '' : 'disabled'} title="${tt('Undo mesh edit')}">↶ ${tt('Mesh')}</button><button data-a="pe-cmp" class="${pe.cmp ? 'on' : ''}">◐ ${tt('Compare')}</button>`,
    bind: (el) => { el.querySelector<HTMLInputElement>('#cp-rad')!.oninput = (e) => { const v = Number((e.target as HTMLInputElement).value.replace(',', '.')); if (v > 0) { pe.radius = v; const n = document.querySelector<HTMLInputElement>('#pe-rad-n'), r = document.querySelector<HTMLInputElement>('#pe-rad-r'); if (n) n.value = String(v); if (r) r.value = String(v); } };
      el.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) => (b.onclick = () => { const a = b.dataset.a; if (a === 'pe-clear') { peClearSel(); renderScene(); renderModeBar(); } else if (a === 'pe-undo') peUndo(); else peToggleCompare(); })); },
    ok: { run: () => peErase(), disabled: !peCount, title: tt('Remove & fill') }, undo: { run: () => peUndoStroke(), disabled: !peStroke.length, title: tt('Undo brush stroke') }, cancel: { run: () => peExit() } };
  if (pe.tool && pe.tool !== 'curveopts') return { title: PE_NAME[pe.tool], stats: pe.live ? `<span class="cp-live">${pe.live}</span>` : '',
    ok: pe.running ? null : { run: () => peRun(), title: tt('Apply') }, undo: pe.running ? null : { run: () => peUndo(), disabled: !pe.undo.length, title: tt('Undo mesh edit') },
    cancel: { run: () => (pe.running ? polyEngine.cancel() : peExit()), title: pe.running ? tt('Abort') : tt('Close') } };
  if (state.csEdit) return csSpec();
  const m = state.mode; if (!m) return null;
  const p = state.preview;
  if (m.kind === 'dist') return distSpec(m);
  if (m.kind === 'con') return conSpec(m);
  if (m.kind === 'anchor') return anchorSpec();
  const seg = `<span class="cp-seg"><button data-a="click" class="${m.method === 'Klick' ? 'on' : ''}">👆 ${tt('Click & grow')}</button><button data-a="brush" class="${m.method === 'Pinsel' ? 'on' : ''}">🖌 ${tt('Brush')}</button></span>`;
  const type = `<select id="cp-type" title="${tt('Feature type')}">${typeOptions(p ? p.fit.type : m.type)}</select>`;
  const ctl = m.method === 'Klick'
    ? `${seg}${type}${(p ? p.fit.type : m.type) === 'Linie' ? `<span class="cp-seg" title="${tt('Which adjacent face is the auxiliary plane')}"><button data-side="0" class="${state.opts.lineSide === 0 ? 'on' : ''}">${tt('Aux: clicked face')}</button><button data-side="1" class="${state.opts.lineSide === 1 ? 'on' : ''}">${tt('Aux: adjacent face')}</button></span>` : ''}${p && p.fit.type === 'Ebene' && !p.aux ? `<button data-a="multi" class="${state.opts.multi ? 'on' : ''}" title="${tt('Add more regions to this plane: click further faces (or Shift+click). Also for split or disjoint plane areas.')}">＋ ${tt('Add region')}${p.regions ? ` (${p.regions.length})` : ''}</button>${p.regions ? `<button data-a="unregion" title="${tt('Remove the last added region')}">↶ ${tt('Region')}</button>` : ''}` : ''}<label title="${tt('Analysis area at the cursor (mouse wheel). 0 = unlimited region growing')}">${tt('Area r')} <input id="cp-area" type="number" min="0" step="0.5" value="${state.opts.radius}" inputmode="decimal"> mm</label>`
    : `${seg}${type}<label>r <input id="cp-brush" type="number" min="0.05" step="0.1" value="${state.opts.brush}" inputmode="decimal"> mm</label>
       <button data-a="paint" class="${brushErase ? '' : 'on'}">🖌 ${tt('Paint')}</button><button data-a="erase" class="${brushErase ? 'on' : ''}" title="${tt('Eraser (or Shift while painting)')}">🧽 ${tt('Erase')}</button>
       <span><b>${state.brushCount}</b> ${tt('pts')}</span><button data-a="clear" class="warn" ${state.brushCount ? '' : 'disabled'}>🗑</button>`;
  const dsel = p && p.fit.type !== 'Abstand' && p.fit.type !== 'Winkel' && p.fit.type !== 'Linienzug'
    ? `<label class="cp-datum" title="${tt('Assign a datum label to the new feature directly (it can be changed later in the Feature dialog)')}">${tt('Datum')} <select id="cp-datum"><option value="">–</option>${DATUM_LETTERS.filter((l) => !state.features.some((g) => g.datum === l)).slice(0, 8).map((l) => `<option ${state.opts.newDatum === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : '';
  return {
    title: p ? `${tt('Creation Panel')} · ${tt('Preview')}` : m.method === 'Klick' ? (m.type === 'auto' ? tt('Auto detection') : typeName(m.type)) : tt('Brush'), cls: m.method === 'Pinsel' ? 'brush' : '',
    controls: ctl + dsel, stats: p ? previewStats(p) : hoverType ? `<span class="cp-hint">${tt('Detected')}: <b>${typeName(hoverType)}</b></span>` : '',
    bind: (el) => {
      el.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) => (b.onclick = () => { const a = b.dataset.a;
        if (a === 'click') setMethod('Klick'); else if (a === 'brush') setMethod('Pinsel'); else if (a === 'paint' || a === 'erase') { brushErase = a === 'erase'; renderModeBar(); renderDialog(); } else if (a === 'clear') clearSelectionAll(); else if (a === 'multi') { state.opts.multi = !state.opts.multi; renderModeBar(); renderHint(); } else if (a === 'unregion') { const pv = state.preview!; const rg = pv.regions!.slice(0, -1); refitRegions(rg, pv.hit).then(() => renderAll()); } }));
      el.querySelectorAll<HTMLButtonElement>('[data-side]').forEach((b) => (b.onclick = async () => { state.opts.lineSide = Number(b.dataset.side) as 0 | 1;
        if (state.preview?.hit && state.preview.fit.type === 'Linie') { try { await previewWithAux(state.preview.hit, 'Linie'); } catch (e: any) { toast(e.message); } } renderAll(); }));
      el.querySelector<HTMLSelectElement>('#cp-type')!.onchange = (e) => { const v = (e.target as HTMLSelectElement).value as GeomType | 'auto'; (state.mode as FitMode).type = v; if (state.preview) refitPreview(v); else renderAll(); };
      const dz = el.querySelector<HTMLSelectElement>('#cp-datum'); if (dz) dz.onchange = () => { state.opts.newDatum = dz.value; };
      const ar = el.querySelector<HTMLInputElement>('#cp-area'); if (ar) ar.onchange = () => { const x = Number(ar.value.replace(',', '.')); if (isFinite(x) && x >= 0) { state.opts.radius = x; renderDialog(); } };
      const br = el.querySelector<HTMLInputElement>('#cp-brush'); if (br) br.onchange = () => { const x = Number(br.value.replace(',', '.')); if (x > 0) setBrushRadius(x); };
    },
    ok: p ? { run: commitPreview, title: tt('Create feature (Enter)') } : m.method === 'Pinsel' ? { run: previewFromBrush, disabled: !state.brushCount, title: tt('Fit (preview)'), label: tt('Fit') } : null,
    undo: m.method === 'Pinsel' ? { run: undoBrush, disabled: !brushUndo.some((x) => x.length), title: tt('Undo brush stroke (Ctrl+Z)') } : null,
    cancel: p ? { run: discardPreview, title: tt('Discard preview (Esc)') } : { run: stopMode, title: tt('Exit mode (Esc)') },
  };
}

// ------------------------------------------------------------------ Vorschau
const usesAux = (t: GeomType | 'auto') => (t === 'Kreis' || t === 'Langloch' || t === 'Linie') && state.opts.aux !== 'none';
const usesAuxType = usesAux;
/** Hilfsebenen-Extraktion im Worker: Kreis/Langloch (Wand in Ebene) bzw. Linie (Kante, Seite wählbar). */
function auxCall(tri: number, point: Vec3, maxAngleDeg: number, type: GeomType, ref?: FeatureView, ring?: { gap: number; width: number }) {
  return type === 'Linie'
    ? engine.call<any>({ op: 'auxLine', tri, point, maxAngleDeg, side: state.opts.lineSide ?? 0, plane: ref?.measured, ring })
    : engine.call<any>({ op: 'aux', tri, point, maxAngleDeg, type: type as 'Kreis' | 'Langloch', plane: ref?.measured, ring });
}
async function previewWithAux(h: Hit, type: 'Kreis' | 'Langloch' | 'Linie') {
  const ref = typeof state.opts.aux === 'number' ? state.features.find((f) => f.id === state.opts.aux) : undefined;
  const r = await busy(auxCall(h.tri, h.point, state.opts.maxAngleDeg, type, ref, state.opts.aux === 'ring' ? state.opts.ring : undefined));
  state.preview = { fit: r.fit, indices: r.indices, candidates: [], method: 'Klick', hit: h,
    aux: { plane: r.aux.plane, indices: r.aux.indices, source: ref ? ref.name : tt('automatic (adjacent face)'), refId: ref?.id } };
  status(tt('Preview: {0} in auxiliary plane – {1} wall points (orange), {2} ({3} ms).', typeName(type), r.indices.length, ref ? tt('plane') + ' ' + ref.name : r.aux.indices.length + ' ' + tt('plane points (blue)'), r.ms.toFixed(0)));
}
async function previewNurbs(src: { indices?: Uint32Array; hit?: Hit }, method: 'Klick' | 'Pinsel', params: NurbsParams = state.nurbs) {
  try {
    const seed = src.hit ? { tri: src.hit.tri, point: src.hit.point, maxAngleDeg: state.opts.maxAngleDeg, radius: state.opts.radius } : undefined;
    const r = await busy(engine.call<any>({ op: 'nurbs', indices: seed ? undefined : src.indices, seed, params }));
    state.preview = { fit: r.fit, indices: r.indices, candidates: [], method, hit: src.hit, dev: r.dev };
    const nb = r.fit.nurbs;
    status(tt('Freeform preview ({0}, {1}×{2} control points, degree {3}): {4} points, std. dev. {5} mm ({6} ms).', patchKind(nb.kind), nb.surface.nu, nb.surface.nv, nb.surface.degU, r.indices.length, fmt(nb.std, 4), r.ms.toFixed(0)));
  } catch (e: any) { state.preview = null; status(tt('Freeform surface: {0}', e.message)); toast(tt('Freeform surface: {0}', e.message)); }
  renderAll();
}
async function previewByClick(h: Hit, add = false) {
  const m = state.mode as FitMode;
  const pv = state.preview;
  if ((add || state.opts.multi) && pv && pv.fit.type === 'Ebene' && !pv.aux && (m.type === 'Ebene' || m.type === 'auto')) { await addPlaneRegion(h); return; }
  if (m.type === 'Freiformfläche') { await previewNurbs({ hit: h }, 'Klick'); return; }
  if (usesAux(m.type)) {
    try { await previewWithAux(h, m.type as 'Kreis' | 'Langloch'); }
    catch (e: any) { state.preview = null; status(tt('Auxiliary plane: {0}', e.message)); toast(tt('Auxiliary plane: {0}', e.message)); }
    renderAll(); return;
  }
  try {
    const r = await busy(engine.call<any>({ op: 'grow', tri: h.tri, point: h.point, maxAngleDeg: state.opts.maxAngleDeg, radius: state.opts.radius, type: m.type }));
    state.preview = { fit: r.fit, indices: r.indices, candidates: r.candidates, method: 'Klick', hit: h,
      aux: r.aux ? { plane: r.aux.plane, indices: r.aux.indices, source: tt('automatic (adjacent face)') } : undefined };
    if (r.aux) { status(`Automatik: ${r.fit.type} in Hilfsebene – ${r.indices.length} Wandpunkte (orange), ${r.aux.indices.length} Ebenenpunkte (blau).`); renderAll(); return; }
    status(tt('Preview: {0} from {1} points ({2} ms). ✓ creates the feature.', typeName(r.fit.type), r.indices.length, r.ms.toFixed(0)));
  } catch (e: any) { state.preview = null; status(tt('No geometry found: {0}', e.message)); }
  renderAll();
}

/** Multi-seed plane: grow another region at the click and fit one plane through all regions (also split/disjoint faces). */
async function addPlaneRegion(h: Hit) {
  const pv = state.preview!;
  try {
    const g = await busy(engine.call<any>({ op: 'grow', tri: h.tri, point: h.point, maxAngleDeg: state.opts.maxAngleDeg, radius: state.opts.radius, type: 'Ebene' }));
    const regions = [...(pv.regions ?? [pv.indices]), g.indices as Uint32Array];
    await refitRegions(regions, pv.hit);
    status(tt('Plane from {0} regions: {1} points, flatness {2} mm.', regions.length, state.preview!.indices.length, fmt(state.preview!.fit.form, 4)));
  } catch (e: any) { status(tt('No geometry found: {0}', e.message)); }
  renderAll();
}
async function refitRegions(regions: Uint32Array[], hit?: Hit) {
  const set = new Set<number>(); for (const r of regions) for (const v of r) set.add(v);
  const idx = Uint32Array.from(set);
  const r = await busy(engine.call<any>({ op: 'fit', indices: idx, type: 'Ebene' }));
  state.preview = { fit: r.fit, indices: r.indices, candidates: [], method: 'Klick', hit, regions: regions.length > 1 ? regions : undefined };
}
async function previewByClickAs(h: Hit, t: GeomType | 'auto') {
  const m = state.mode as FitMode; const old = m.type; m.type = t; await previewByClick(h); m.type = old;
}
async function previewFromBrush() {
  if (!state.brushMask || !state.brushCount) { status('Mark an area with the brush first.'); return; }
  const idx = new Uint32Array(state.brushCount); let k = 0;
  state.brushMask.forEach((v, i) => { if (v) idx[k++] = i; });
  if ((state.mode as FitMode).type === 'Freiformfläche') { await previewNurbs({ indices: idx }, 'Pinsel'); return; }
  try {
    const r = await busy(engine.call<any>({ op: 'fit', indices: idx, type: (state.mode as FitMode).type }));
    state.preview = { fit: r.fit, indices: r.indices, candidates: r.candidates, method: 'Pinsel' };
  } catch (e: any) { status(tt('Fit failed: {0}', e.message)); }
  renderAll();
}

async function refitPreview(t: GeomType | 'auto') {
  const p = state.preview; if (!p || p.method === 'Konstruiert') return;
  if (t === 'Freiformfläche') { await previewNurbs(p.method === 'Klick' && p.hit ? { hit: p.hit } : { indices: p.indices }, p.method); return; }
  if (p.hit && t === 'auto' && p.method === 'Klick') { const m = state.mode; await previewByClickAs(p.hit, 'auto'); void m; return; }
  if (p.hit && (t === 'Kreis' || t === 'Langloch') && state.opts.aux !== 'none') {
    try { await previewWithAux(p.hit, t); } catch (e: any) { status(tt('Auxiliary plane: {0}', e.message)); }
    renderAll(); return;
  }
  try {
    const r = await busy(engine.call<any>({ op: 'fit', indices: p.indices, type: t }));
    state.preview = { ...p, aux: undefined, fit: r.fit, candidates: r.candidates.length ? r.candidates : p.candidates };
    status(tt('Refitted as {0}.', typeName(r.fit.type)));
  } catch (e: any) { status(tt('Fit failed: {0}', e.message)); }
  renderAll();
}

function commitPreview() {
  const p = state.preview; if (!p) return;
  const t = p.fit.type;
  const n = (state.typeCount[t] = (state.typeCount[t] ?? 0) + 1);
  const f: FeatureView = {
    id: state.nextId++, name: `${typeName(t)} ${n}`, type: t, measured: p.fit, pointCount: p.indices.length,
    method: p.method, color: state.colorMode === 'uniform' ? state.uniformColor : PALETTE[state.features.length % PALETTE.length], indices: p.indices, candidates: p.candidates, refs: p.refs,
    src: p.indices, hit: p.hit, fp: defaultFp(), dev: p.dev,
  };
  if (p.regions) { f.hit = undefined; state.opts.multi = false; }
  if (state.mode?.kind === 'con') f.cons = { key: state.mode.key, refs: p.refs!, params: { ...state.mode.params } };
  if (p.aux) {
    f.aux = { plane: p.aux.plane, pointCount: p.aux.indices.length, source: p.aux.source, refId: p.aux.refId } as AuxPlane;
    f.auxIndices = p.aux.indices;
  }
  state.features.push(f);
  if (state.opts.newDatum && !state.features.some((g) => g.datum === state.opts.newDatum)) setDatum(f, state.opts.newDatum);
  state.opts.newDatum = '';
  state.preview = null; clearBrush();
  state.sel = [f.id]; state.selControl = null; state.addFeat = f.id;
  if (state.mode?.kind === 'dist') { const comp = state.mode.comp; f.dim = { comp }; const off = state.labelOffsets.get(-1); if (off) state.labelOffsets.set(f.id, off); state.labelOffsets.delete(-1);
    addControl(('Abstand ' + comp) as ControlKind, f.id); state.mode = { kind: 'dist', a: null, b: null, slot: 0, comp }; }
  if (f.cons) { if (t === 'Winkel') addControl('Winkelwert', f.id); if (f.measured!.pattern) { addControl('Durchmesser', f.id); addControl('Teilung', f.id); }
    const m = state.mode as ConMode; state.mode = { ...m, refs: [], slot: 0 }; state.preview = null; }
  renderAll();
  const node = document.querySelector<HTMLElement>(`#tree [data-fid="${f.id}"]`);
  node?.classList.add('flash'); node?.scrollIntoView({ block: 'nearest' });
  toast(`✔ ${tt('{0} created', f.name)} (${f.cons ? tt('constructed') : p.method === 'Konstruiert' ? fmt(distValue(p.fit, f.dim?.comp ?? '3D'), 3) + ' mm' : p.indices.length + ' ' + tt('points')})`);
}
const defaultFp = (): FitParamsUI => ({ k: 3, nf: { on: false, angleDeg: 30, maxPct: 10 }, maxAngleDeg: state.opts.maxAngleDeg, radius: state.opts.radius, aux: state.opts.aux, ring: { ...state.opts.ring } });
/** Merkmal mit seinen Fit-Parametern neu berechnen (Extraktion + Fit) und alles Abhängige aktualisieren. */
async function refitFeature(f: FeatureView, type: GeomType = f.type) {
  if (f.type === 'Abstand' || f.cons || f.derived) { recomputeDistances(); renderAll(); return; }
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
      status(tt('{0} refitted: {1}×{2} control points, degree {3}, std. dev. {4} mm, surface profile {5} mm.', f.name, nb.surface.nu, nb.surface.nv, nb.surface.degU, fmt(nb.std, 4), fmt(r.fit.form, 4)));
      renderAll(); scheduleAutosave(); return;
    }
    let idx = f.src ?? f.indices, auxR: any = null;
    const inPlane = (type === 'Kreis' || type === 'Langloch' || type === 'Linie') && fp.aux !== 'none';
    if (f.hit && f.method === 'Klick') {
      if (inPlane) {
        const ref = typeof fp.aux === 'number' ? state.features.find((g) => g.id === fp.aux) : undefined;
        auxR = await busy(auxCall(f.hit.tri, f.hit.point, fp.maxAngleDeg, type, ref, fp.aux === 'ring' ? (fp.ring ??= { ...state.opts.ring }) : undefined));
        auxR.source = ref ? ref.name : fp.aux === 'ring' ? tt('local ring (gap {0} mm, width {1} mm)', fp.ring!.gap, fp.ring!.width) : tt('automatic (adjacent face)'); auxR.refId = ref?.id;
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
    status(tt('{0} refitted: {1} points, RMS {2}', f.name, f.pointCount, fmt(m.rms, 4)) + (m.outliers ? tt(', {0} outliers', m.outliers) : '') + (m.nfRemoved ? tt(', {0} removed by normal filter', m.nfRemoved) : '') + '.');
  } catch (e: any) { status(tt('Fit failed: {0}', e.message)); toast(tt('Fit failed: {0}', e.message)); }
  renderAll(); scheduleAutosave();
}
function discardPreview() { state.preview = null; clearBrush(); status(tt('Preview discarded.')); renderAll(); }

// ------------------------------------------------------------------ Abstand
function pickFeatureForDistance(h: Hit) {
  const f = featureAtHit(h);
  if (!f) { status(tt('No feature at this location.')); return; }
  setDistanceSlot(f.id);
}
function setDistanceSlot(id: number) {
  const m = state.mode as DistMode;
  if (m.slot === 0) { m.a = id; if (m.b === id) m.b = null; m.slot = 1; }
  else { if (id === m.a) { status(tt('The second feature must be different.')); return; } m.b = id; m.slot = 0; }
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
const deriveSrc = new WeakMap<Feature, { m: unknown; P: unknown }>();
function recomputeDistances() {
  // all derived features (distances, constructions) in parent-first order, so chains update completely
  const byId = new Map(state.features.map((f) => [f.id, f]));
  const order = recomputeOrder(state.features.map((f) => ({ id: f.id, refs: hardParentsOf(f) })).filter((x) => x.refs.length));
  for (const id of order) {
    const f = byId.get(id)!; const ps = hardParentsOf(f).map((r) => byId.get(r)?.measured);
    if (ps.some((x) => !x)) { if (f.cons) f.cons.error = tt('Parent feature missing'); if (f.derived) f.derived.error = tt('Parent feature missing'); continue; }
    if (f.derived) { const par = byId.get(f.derived.parent)!, P = featPoints(par.id), hit = deriveSrc.get(f);
      if (hit && hit.m === par.measured && hit.P === P) continue;
      try { f.measured = runDerive(f.derived.key, par, P); f.derived.error = undefined; deriveSrc.set(f, { m: par.measured, P }); } catch (e: any) { f.derived.error = tt(e.message); }
      continue; }
    if (f.type === 'Abstand' && !f.cons) { f.measured = computeDistance(ps[0]!, ps[1]!); continue; }
    if (f.cons) {
      try { const r = runConstruction(f.cons.key, ps as FitResult[], f.cons.params); f.measured = r; f.cons.error = undefined; }
      catch (e: any) { f.cons.error = tt(e.message); }
    }
  }
}

const COMP_VEC: Record<Exclude<DimComp, '3D'>, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
/** Messrichtung u und vorzeichenbehafteter Betrag entlang u (3D: Verbindungsrichtung). */
function dimDir(fit: FitResult, comp: DimComp): { u: Vec3; L: number } {
  const d = fit.delta!; if (comp === '3D') { const L = Math.hypot(...d) || 1e-12; return { u: [d[0] / L, d[1] / L, d[2] / L], L }; }
  const fr = activeFrame(); const u = fr ? fr.R['XYZ'.indexOf(comp)] : COMP_VEC[comp]; return { u, L: d[0] * u[0] + d[1] * u[1] + d[2] * u[2] };
}
const distValue = (fit: FitResult, comp: DimComp) => Math.abs(dimDir(fit, comp).L);
/** Bemaßung wie im CAD: Maßlinie parallel zu u, verschoben um den zu u senkrechten Anteil des Annotation-Versatzes. */
function dimGeometry(fit: FitResult, comp: DimComp, off: V3 | null) {
  const { u, L } = dimDir(fit, comp), d = fit.delta!, p1 = fit.p1!;
  const perp = (v: Vec3): Vec3 => { const k = v[0] * u[0] + v[1] * u[1] + v[2] * u[2]; return [v[0] - k * u[0], v[1] - k * u[1], v[2] - k * u[2]]; };
  const pd = perp(d), po = off ? perp(off) : [0, 0, 0];
  const w: Vec3 = [pd[0] / 2 + po[0], pd[1] / 2 + po[1], pd[2] / 2 + po[2]];
  const d1: Vec3 = [p1[0] + w[0], p1[1] + w[1], p1[2] + w[2]];
  return { d1, d2: [d1[0] + u[0] * L, d1[1] + u[1] * L, d1[2] + u[2] * L] as Vec3 };
}
function setDistComp(c: DimComp) { const m = state.mode as DistMode; m.comp = c; renderAll(); }
function distSpec(m: DistMode): CtxSpec {
  const p = state.preview;
  const chip = (slot: 0 | 1, id: number | null) => `<button data-slot="${slot}" class="cp-chip ${m.slot === slot ? 'on' : ''}" title="${tt('Pick in 3D view or tree')}">${slot ? 'B' : 'A'}: ${id != null ? nameOf(id) : '…'}</button>`;
  const seg = `<span class="cp-seg">${(['3D', 'X', 'Y', 'Z'] as DimComp[]).map((c) => `<button data-comp="${c}" class="${m.comp === c ? 'on' : ''}">${c}</button>`).join('')}</span>`;
  return {
    title: `${ICON['Abstand 3D']} ${tt('Distance')}`,
    controls: `${chip(0, m.a)}${chip(1, m.b)}${seg}`,
    stats: p ? `<span class="cp-kv"><small>${tt('Distance')} ${m.comp}</small><b>${fmt(distValue(p.fit, m.comp), 3)} mm</b></span><span class="cp-hint">${tt('Drag the annotation to place the dimension')}</span>`
      : `<span class="cp-hint">${m.a == null ? tt('Pick the first feature') : tt('Pick the second feature')}</span>`,
    bind: (el) => {
      el.querySelectorAll<HTMLButtonElement>('[data-comp]').forEach((b) => (b.onclick = () => setDistComp(b.dataset.comp as DimComp)));
      el.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((b) => (b.onclick = () => { m.slot = Number(b.dataset.slot) as 0 | 1; renderModeBar(); }));
    },
    ok: { run: commitPreview, disabled: !p, title: tt('Create distance (Enter)') },
    undo: { run: () => { if (m.b != null) { m.b = null; m.slot = 1; } else { m.a = null; m.slot = 0; } updateDistancePreview(); renderAll(); }, disabled: m.a == null && m.b == null, title: tt('Undo last pick') },
    cancel: { run: stopMode, title: tt('Exit (Esc)') },
  };
}

// ------------------------------------------------------------------ Analyze (deviation color map, whiskers)
// Architektur: eine Abweichungsquelle liefert Knotenindizes + vorzeichenbehaftete Abweichungen (+ optional Lage/Richtung
// für Whisker). Quellen heute: Formabweichung je Merkmal (Punkte ↔ Ausgleichselement) und Polygon ↔ Original;
// eine CAD-Quelle (Netz ↔ Sollgeometrie) lässt sich als weiterer Eintrag in AN_SOURCES ergänzen.
type AnKind = 'form' | 'mesh' | 'axis';
/** Controls shown in the axis view (cylinder/cone): orientation/location of the axis and straightness of the axis. */
const AXIS_CTRL = ['Position', 'Rechtwinkligkeit', 'Parallelität', 'Neigung', 'Koaxialität', 'Geradheit Achse'];
/** Which analysis view a control gets: axis view, surface colour map, or none (dimensions). */
function ctrlAnalysisKind(c: Control): 'axis' | 'form' | null {
  const f = state.features.find((x) => x.id === c.featureIds[0]); if (!f || !f.indices.length || !f.measured) return null;
  if ((f.type === 'Zylinder' || f.type === 'Kegel') && AXIS_CTRL.includes(c.kind)) return 'axis';
  if ((isZoneControl(c.kind) || isDatumControl(c.kind)) && f.type !== 'Abstand' && f.type !== 'Winkel') return 'form';
  return null;
}
const ctrlTitle = (c: Control) => { const f = state.features.find((x) => x.id === c.featureIds[0]); return `${f?.name ?? '?'} · ${controlLabel(c, f)}${c.datumIds?.length ? ` |${datumText(c, featMap())}|` : ''}`; };
/** Axis analysis of one cylinder/cone for one control (or against its own fitted axis). */
function axisFor(f: FeatureView, C: Control | null): AxisAnalysis {
  const pts = featPoints(f.id) ?? []; // same point sample as the Controls table → identical values
  const c = C && C.kind !== 'Geradheit Achse' && C.datumIds?.length ? C : null;
  // nominal axis from the full datum reference frame of the control (buildDRF: A|B|C); TED missing → direction only
  const DS = c ? c.datumIds!.map((i) => state.features.find((x) => x.id === i)).filter((x): x is FeatureView => !!x?.measured) : [];
  const rb = c ? resolveBasic(c, f, DS) : null, miss = !!rb?.missing.length;
  let nominal = c && DS.length ? axisNominal(c.kind, simulateDatums(DS, ctx).feats, rb!.basic, f.measured!.normal, f, c.dia) : undefined;
  if (nominal && miss) nominal = { dir: nominal.dir };
  const an = analyzeAxis(f.measured!, pts, nominal, C && C.tolUp > 0 ? C.tolUp : null, 0,
    `${f.name}${C ? ` · ${kindName(C.kind)}${c ? ` → ${c.datumIds!.map(nameOf).join('|')}` : ''}` : ` · ${tt('vs. fitted axis')}`}${miss ? ` · ⚠ ${tt('Nominal missing')}` : rb?.unconfirmed.length ? ` · ⚠ ${tt('Nominal unconfirmed')}` : ''}`);
  if (miss) { an.missing = true; an.tol = null; }
  else if (c?.kind === 'Position') {
    // the table value accounts for DOF the datums leave free, datum shift and Ⓜ/Ⓛ bonus → show the same zone and limit
    const r = evaluate(c, featMap(), ctx);
    if (r.measured != null) an.zone = r.measured;
    if (r.bonus && an.tol != null) { an.tol += r.bonus; an.label += ` · ${tt('bonus')} +${fmt(r.bonus, 4)}`; }
  }
  if (C?.kind === 'Geradheit Achse') { an.colorBy = 'form'; an.zone = an.straightness; } // straightness control: zone = minimum-zone straightness
  return an;
}
/** Analyse exactly one control (form → colour map, axis-based → axis view). */
async function analyzeControl(cid: number, keepView = false) {
  const c = state.controls.find((x) => x.id === cid); if (!c) return;
  const k = ctrlAnalysisKind(c); if (!k) { toast(tt('{0}: no analysis view for this control (dimension).', ctrlTitle(c))); return; }
  state.an.ctrl = cid; state.sel = [...c.featureIds]; state.selControl = cid;
  await analyze(k, keepView, true);
}
/** Menu entries “Analyze …” for a feature: 0 controls → form deviation; 1 → that control; several → one entry each. */
function analyzeItems(f: FeatureView): [string, (() => void) | null][] {
  const cs = state.controls.filter((c) => c.featureIds[0] === f.id && ctrlAnalysisKind(c));
  if (!cs.length) return f.type === 'Abstand' ? [] : [[`◐ ${tt('Analyze form deviation')}`, () => { state.an.ctrl = null; state.sel = [f.id]; analyze('form'); }]];
  return cs.map((c) => [`◐ ${tt('Analyze: {0}', controlLabel(c, f) + (c.datumIds?.length ? ` |${datumText(c, featMap())}|` : ''))}`, () => analyzeControl(c.id)] as [string, () => void]);
}
interface AnResult { idx: Uint32Array; dev: Float32Array; pos?: Float32Array; dir?: Float32Array; label: string; feats?: { id: number; lo: number; hi: number }[]; axes?: AxisAnalysis[] }
const AN_SOURCES: Record<AnKind, () => Promise<AnResult | null>> = {
  form: async () => {
    const C = state.an.ctrl != null ? state.controls.find((c) => c.id === state.an.ctrl) : undefined;
    let fs = state.features.filter((f) => (C ? f.id === C.featureIds[0] : state.sel.includes(f.id)) && f.type !== 'Abstand' && f.indices.length);
    if (!fs.length) fs = state.features.filter((f) => !state.hidden.has(f.id) && f.type !== 'Abstand' && f.indices.length);
    if (!fs.length) { toast(tt('No features to analyze – create a feature first.')); return null; }
    const parts = await busy(Promise.all(fs.map((f) => engine.call<any>({ op: 'dev', indices: f.indices, fit: f.measured! }))));
    const n = parts.reduce((a, r) => a + r.dev.length, 0), idx = new Uint32Array(n), dev = new Float32Array(n), pos = new Float32Array(3 * n), dir = new Float32Array(3 * n);
    let o = 0; parts.forEach((r, k) => { const f = fs[k]; idx.set(f.indices, o); dev.set(f.dev && f.dev.length === f.indices.length ? f.dev : r.dev, o); pos.set(r.pos, 3 * o); dir.set(r.dir, 3 * o); o += r.dev.length; });
    state.an.ids = fs.map((f) => f.id);
    let off = 0; const feats = fs.map((f) => { let lo = Infinity, hi = -Infinity; for (let i = off; i < off + f.indices.length; i++) { lo = Math.min(lo, dev[i]); hi = Math.max(hi, dev[i]); } off += f.indices.length; return { id: f.id, lo, hi }; });
    return { feats, idx, dev, pos, dir, label: C ? `◐ ${ctrlTitle(C)}` : fs.length === 1 ? tt('Form deviation – {0}', fs[0].name) : tt('Form deviation – {0} features', fs.length) };
  },
  axis: async () => {
    const C = state.an.ctrl != null ? state.controls.find((c) => c.id === state.an.ctrl) : undefined;
    let fs = C ? state.features.filter((f) => f.id === C.featureIds[0]) : state.features.filter((f) => state.sel.includes(f.id) && (f.type === 'Zylinder' || f.type === 'Kegel') && f.indices.length);
    if (!fs.length) fs = state.features.filter((f) => !state.hidden.has(f.id) && (f.type === 'Zylinder' || f.type === 'Kegel') && f.indices.length).slice(0, 1);
    if (!fs.length) { toast(tt('Axis analysis needs a cylinder or cone – create one first.')); return null; }
    const axes = fs.map((f) => axisFor(f, C ?? null));
    state.an.ids = fs.map((f) => f.id);
    return { idx: new Uint32Array(0), dev: new Float32Array(0), axes, label: C ? `◐ ${ctrlTitle(C)}` : tt('Axis analysis') };
  },
  mesh: async () => {
    if (!pe.dev) await peCompute();
    if (!pe.dev) return null;
    const n = pe.dev.length, idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i;
    const g = viewer.model!.geometry; const pos = g.getAttribute('position').array as Float32Array, nrm = g.getAttribute('normal')?.array as Float32Array | undefined;
    return { idx, dev: pe.dev, pos, dir: nrm, label: tt('Polygon model vs. original') };
  },
};
async function analyze(kind: AnKind, keepView = false, fromControl = false) {
  if (!state.data) { toast(tt('Load a polygon model first.')); return; }
  if (!fromControl) state.an.ctrl = null;
  if (!keepView) state.an.derivePrev = null;
  // a fit mode without pending preview would hide the analysis panel – leave it
  if (state.mode?.kind === 'fit' && !state.preview) { state.mode = null; clearBrush(); clearAuxHover(); viewer.controls.enabled = true; viewer.showCursor(null, 1); }
  const r = await AN_SOURCES[kind]().catch((e) => { toast(tt('Analysis failed: {0}', e.message)); return null; });
  if (!r) return;
  state.an.kind = kind; state.an.res = r; state.an.on = true; pe.cmp = false;
  if (kind === 'axis' && r.axes?.length && !keepView) sideView(viewer, r.axes);
  renderAll();
}
function analyzeOff() { state.an.on = false; state.an.res = null; state.an.ctrl = null; state.an.derivePrev = null; viewer.setModelOpacity(1); renderAll(); }
/** Form tolerance t of a single analysed feature (Form control), else null. */
function anTol(r: AnResult): number | null {
  if (r.feats?.length !== 1) return null;
  const ac = state.an.ctrl != null ? state.controls.find((c) => c.id === state.an.ctrl) : undefined; if (ac) return ac.tolUp > 0 ? ac.tolUp : null;
  const c = state.controls.find((c) => c.kind === 'Form' && c.featureIds[0] === r.feats![0].id && c.tolUp > 0);
  return c ? c.tolUp : null;
}
/** Color scale (centre c, half range h). Default “zone”: centred on the mid of the form zone (ISO 1101 minimum zone),
 *  half range = zone width / 2, or t/2 if a form tolerance t exists (flatness 4 → ±2 around the zone mid). */
function anRange(r: AnResult): { c: number; h: number } {
  const a = state.an;
  let mx = -Infinity, mn = Infinity; for (const v of r.dev) { if (v > mx) mx = v; if (v < mn) mn = v; }
  if (!isFinite(mx)) return { c: 0, h: 1e-3 };
  let c = 0, h: number;
  if (a.center === 'zone') { c = (mx + mn) / 2; const t = anTol(r); h = t != null ? t / 2 : (mx - mn) / 2; }
  else { c = a.center === 'custom' ? a.c0 : 0; const q = Array.from(r.dev, (v) => Math.abs(v - c)).sort((x, y) => x - y); h = q.length ? q[Math.min(q.length - 1, Math.floor(0.99 * q.length))] : 1e-3; }
  if (a.scale > 0) h = a.scale;
  return { c, h: Math.max(1e-4, h) };
}
/** Form exaggeration of the median line (bend around its own axis). 0 = automatic: largest bend ≈ 25 % of the radius. */
function axisExag(r: AnResult) {
  if (state.an.axExag > 0) return state.an.axExag;
  const z = Math.max(1e-6, ...r.axes!.map((x) => x.straightness / 2)), R = Math.min(...r.axes!.map((x) => x.radius));
  return Math.max(1, Math.round((0.25 * R) / z));
}
const offsetLabel = (x: AxisAnalysis) => x.mode === 'position' ? `Δ ${fmt(x.offsetLen, 4)} mm${state.an.axLoc > 1 ? ` (${tt('shown ×{0}', state.an.axLoc)})` : ''}` : '';
function paintAnalysis(): boolean {
  const a = state.an, r = a.res;
  if (!a.on || !r || !viewer.colors) return false;
  if (r.axes) {
    viewer.setModelOpacity(a.axHide ? 0 : a.trans ? 0.35 : 1);
    let el = document.getElementById('dev-legend'); if (!el) { el = document.createElement('div'); el.id = 'dev-legend'; viewer.el.appendChild(el); }
    const fx = axisExag(r), lx = Math.max(1, a.axLoc);
    el.innerHTML = `<b>${r.label}</b>` + r.axes.map((x) => `<small><b>${x.label}</b><br>${tt('tilt')} ${fmt(x.tiltDeg, 4)}° · ${x.missing ? `<span class="st missing" title="${tt('Enter the TED in the panel below (or ⋯ → Use actual as nominal) to get the zone and OK/NOK')}">${tt('zone')}: ${tt('Nominal missing')}</span>` : `${tt('zone')} ${x.planeN ? `⟷ ${tt('(two planes)')}` : 'Ø'} ${fmt(x.zone, 4)}${x.tol != null ? ` / t ${fmt(x.tol, 3)} ${x.zone <= x.tol ? '✔' : '✘'}` : ''}`}${x.mode === 'position' ? `<br>${tt('location offset')} Δ ${fmt(x.offsetLen, 4)} mm` : ''}<br>${tt('median line: {0} sections · straightness Ø {1} (minimum zone)', x.centers.length, fmt(x.straightness, 4))}</small>`).join('')
      + `<small>${tt('Median line at its true location; its bend is shown ×{0}.', fx)} ${lx > 1 ? `<b style="color:#1565c0">${tt('Location offset and zones shown ×{0} (not true scale).', lx)}</b>` : tt('Location and zones: true scale.')}</small>`
      + r.axes.slice(0, 1).map((x) => { const cs = axisColorScale(x), REF = { nominal: tt('distance from the nominal axis'), zone: tt('distance from the zone axis'), planes: tt('distance from the zone mid-plane'), form: tt('distance from the minimum-zone axis') };
        return `<small title="${tt('Median-line points and segments are coloured by their deviation: green = on the reference, red = at the zone boundary (t/2) or beyond')}">${tt('Colour')}: ${REF[cs.ref]}<div class="bar half"></div><div class="ticks"><span>0</span><span>${fmt(cs.h / 2, 4)}</span><span>≥ ${fmt(cs.h, 4)}${x.tol != null ? ' (t/2)' : ''}</span></div></small>`; }).join('')
      + `<small><span style="color:#555">━</span> ${tt('nominal axis')} · <span style="color:#2e9e3e">━</span><span style="color:#c62828">●</span> ${tt('median line (coloured)')} · <span style="color:#e57373">┅</span> ${tt('its axis')} · <span style="color:#1565c0">➝</span> ${tt('offset')} · <span style="color:#22aa44">▮</span> ${tt('tolerance')} · <span style="color:#ff8c1a">▮</span> ${tt('required zone')} · <span style="color:#8e44ad">◎</span> ${tt('envelope (min. zone)')}</small>`;
    return true;
  }
  if (r.idx.length && r.idx[r.idx.length - 1] >= viewer.colors.length / 3) { a.on = false; a.res = null; return false; }
  const { c, h } = anRange(r);
  viewer.paintScalar(r.idx, r.dev, h, a.steps, c);
  viewer.setModelOpacity(a.trans ? 0.5 : 1);
  let mx = -Infinity, mn = Infinity, s2 = 0; for (const v of r.dev) { if (v > mx) mx = v; if (v < mn) mn = v; s2 += v * v; }
  let el = document.getElementById('dev-legend');
  if (!el) { el = document.createElement('div'); el.id = 'dev-legend'; viewer.el.appendChild(el); }
  const t = anTol(r), cls = a.steps > 0 ? tt('{0} classes of {1} mm', a.steps, fmt((2 * h) / a.steps, 4)) : tt('continuous');
  el.innerHTML = `<b>${r.label} [mm]</b><div class="bar${a.steps ? ' stepped' : ''}"></div><div class="ticks"><span>${sgn(c - h, 3)}</span><span>${sgn(c, 3)}</span><span>${sgn(c + h, 3)}</span></div>
    <small>${a.center === 'zone' ? (t != null ? tt('Centre = zone mid, ± t/2 (t = {0})', fmt(t, 3)) : tt('Centre = zone mid, ± zone/2')) : tt('Centre = {0}', sgn(c, 3))} · ${cls}</small>
    <small>${tt('max')} ${sgn(mx, 4)} · ${tt('min')} ${sgn(mn, 4)} · ${tt('zone')} ${fmt(mx - mn, 4)} · σ ${fmt(Math.sqrt(s2 / Math.max(1, r.dev.length)), 4)}</small>`;
  return true;
}
/** Active control in analysis mode: tolerance + TED editable live (recompute + redraw on change). */
function ctrlPanel(): { html: string; bind: (el: HTMLElement) => void } {
  const c = state.an.ctrl != null ? state.controls.find((x) => x.id === state.an.ctrl) : undefined; if (!c) return { html: '', bind: () => {} };
  const f = state.features.find((x) => x.id === c.featureIds[0]);
  const ds = (c.datumIds ?? []).map((i) => state.features.find((x) => x.id === i)).filter(Boolean) as FeatureView[];
  const r = evaluate(c, featMap(), ctx);
  const spec = f ? tedSpec(c, f, ds) : [];
  const st = r.flag === NOMINAL_MISSING ? `<span class="st missing">${tt('Nominal missing')}</span>` : r.measured != null ? `<b>${fmt(r.measured)}</b>${bonusText(r)} ${stHtml(r)}` : r.flag ? `<span class="st missing" title="${r.flag}">⚠ ${tt(r.flag)}</span>` : '';
  return {
    html: `<span class="an-ctrl" title="${tt('Active control – changes recompute the analysis immediately')}"><b>${ctrlTitle(c)}</b>
      <label>${isZoneControl(c.kind) ? tt('Tol') : tt('Tol+')} <input id="an-tol" inputmode="decimal" value="${c.tolUp}"></label><span data-teds></span><span data-dia></span> ${st}</span>`,
    bind: (el) => {
      const upd = () => { void analyzeControl(c.id, true); };
      const t = el.querySelector<HTMLInputElement>('#an-tol'); if (t) t.onchange = () => { const v = Number(t.value.replace(',', '.')); if (isFinite(v)) { c.tolUp = isZoneControl(c.kind) ? Math.abs(v) : v; upd(); } };
      const tz = el.querySelector('.an-ctrl [data-teds]'); if (tz) for (const t of spec) tz.appendChild(tedEl(c, t, upd, true));
      if (tz) { const all = tedConfirmAll(c, spec, upd); if (all) tz.appendChild(all); }
      const dz = el.querySelector('.an-ctrl [data-dia]'); if (dz && f && diaInfo(c, f).applies) dz.appendChild(diaButton(c, f, upd));
      if (dz && f && modApplies(c, f)) dz.appendChild(modButton(c, upd));
    } };
}
/** Parent feature for “Derive feature”: the analysed control's feature, or the single analysed feature. */
function deriveParent(): FeatureView | undefined {
  const a = state.an, C = a.ctrl != null ? state.controls.find((c) => c.id === a.ctrl) : undefined;
  const id = C?.featureIds[0] ?? (a.ids.length === 1 ? a.ids[0] : a.res?.axes ? state.sel.find((i) => state.features.some((f) => f.id === i && (f.type === 'Zylinder' || f.type === 'Kegel'))) : undefined);
  return state.features.find((f) => f.id === id && f.indices.length);
}
function deriveHtml(): string {
  const p = deriveParent(), dv = p ? derivesFor(p.type) : [];
  if (state.an.derivePrev) return `<span class="an-derive"><b>🔗 ${tt(DERIVES.find((d) => d.key === state.an.derivePrev!.key)!.label)}</b><button class="btn primary" data-dv="add" title="${tt('Create the previewed geometry as a feature in the tree; it is recomputed automatically when the parent feature changes')}">＋ ${tt('Add to tree')}</button><button class="btn" data-dv="x" title="${tt('Discard the preview')}">✕</button></span>`;
  return `<button class="btn" data-dv="menu" ${dv.length ? '' : 'disabled'} title="${tt('Derive feature from Analyze: preview dependent geometry (flatness zone planes, derived median line as Polyline, minimum-zone axis) and add it to the tree')}">🔗 ${tt('Derive')}</button>`;
}
function bindDerive(el: HTMLElement) {
  el.querySelectorAll<HTMLButtonElement>('[data-dv]').forEach((b) => (b.onclick = (e) => {
    const p = deriveParent(), a = state.an; if (!p) return;
    if (b.dataset.dv === 'x') { a.derivePrev = null; renderAll(); return; }
    if (b.dataset.dv === 'add') { addDerived(a.derivePrev!.key, p); a.derivePrev = null; renderAll(); return; }
    showMenu((e as MouseEvent).clientX, (e as MouseEvent).clientY, derivesFor(p.type).map((d) => [tt(d.label), () => {
      try { a.derivePrev = { key: d.key, parent: p.id, fit: runDerive(d.key, p, featPoints(p.id)) }; renderAll(); } catch (er: any) { toast(tt(er.message)); } }] as [string, () => void]));
  }));
}
/** Create a derived feature (method “Derived from Analyze”, chain icon, auto recompute). */
function addDerived(key: string, p: FeatureView) {
  const fit = runDerive(key, p, featPoints(p.id)), t = fit.type, n = (state.typeCount[t] = (state.typeCount[t] ?? 0) + 1);
  const f: FeatureView = { id: state.nextId++, name: `${typeName(t)} ${n}`, type: t, measured: fit, pointCount: 0, method: 'Abgeleitet', derived: { key, parent: p.id }, refs: [p.id],
    color: state.colorMode === 'uniform' ? state.uniformColor : PALETTE[state.features.length % PALETTE.length], indices: new Uint32Array(0), candidates: [], src: new Uint32Array(0), fp: defaultFp() } as FeatureView;
  state.features.push(f); deriveSrc.set(f, { m: p.measured, P: featPoints(p.id) });
  toast(`✔ ${tt('{0} created', f.name)} (🔗 ${tt('derived from {0}', p.name)})`);
}
function analysisSpec(): CtxSpec | null {
  const a = state.an; if (!a.on || !a.res) return null;
  const cp = ctrlPanel();
  if (a.res.axes) return { title: `◐ ${tt('Axis analysis')}`, cls: 'an',
    controls: `${cp.html}<label title="${tt('Form exaggeration: bend of the median line around its own axis (its location stays true). 0 = automatic')}">${tt('Form')} × <input id="an-ax" type="number" min="0" step="10" value="${a.axExag}"></label>
      <label title="${tt('Location exaggeration: scales the offset from the nominal axis and the zones. 1 = true scale (labelled when > 1)')}">${tt('Location')} × <input id="an-lx" type="number" min="1" step="10" value="${a.axLoc}"></label>
      <button data-a="trans" class="${a.trans ? 'on' : ''}" ${a.axHide ? 'disabled' : ''} title="${tt('Semi-transparent model')}">◌ ${tt('Transparent')}</button><button data-a="hide" class="${a.axHide ? 'on' : ''}" title="${tt('Hide the polygon model so that only the axis analysis (median line, nominal axis, zones) is visible')}">▢ ${tt('Hide mesh')}</button><button data-a="zones" class="${a.axZones ? 'on' : ''}" title="${tt('Show the tolerance zone (green, Ø t or two planes) and the required zone of the control (orange)')}">▭ ${tt('Zones')}</button><button data-a="env" class="${a.axEnv ? 'on' : ''}" title="${tt('Show the envelope: the minimum-zone cylinder (purple) that encloses the derived median line; its Ø is the straightness of the axis')}">◎ ${tt('Envelope')}</button><button data-a="help" title="${tt('Explain the analysis settings')}">?</button>${deriveHtml()}`,
    bind: (el) => { cp.bind(el); bindDerive(el); const i = el.querySelector<HTMLInputElement>('#an-ax')!; i.onchange = () => { const v = Number(i.value.replace(',', '.')); if (isFinite(v) && v >= 0) { a.axExag = v; renderAll(); } };
      const lx = el.querySelector<HTMLInputElement>('#an-lx')!; lx.onchange = () => { const v = Number(lx.value.replace(',', '.')); if (isFinite(v) && v >= 1) { a.axLoc = v; renderAll(); } };
      el.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) => (b.onclick = () => { if (b.dataset.a === 'help') showDocs('analyze'); else if (b.dataset.a === 'hide') { a.axHide = !a.axHide; renderAll(); } else if (b.dataset.a === 'zones') { a.axZones = !a.axZones; renderAll(); } else if (b.dataset.a === 'env') { a.axEnv = !a.axEnv; renderAll(); } else { a.trans = !a.trans; renderAll(); } })); },
    cancel: { run: analyzeOff, title: tt('Close analysis') } };
  return {
    title: `◐ ${tt('Analyze')}`, cls: 'an',
    controls: `${cp.html}<label title="${tt('Centre of the color scale. Zone mid (default, ISO 1101): green = middle of the form zone; 0 = fitted element; custom = your value')}">${tt('Centre')} <select id="an-cm"><option value="zone" ${a.center === 'zone' ? 'selected' : ''}>${tt('Zone mid')}</option><option value="zero" ${a.center === 'zero' ? 'selected' : ''}>0</option><option value="custom" ${a.center === 'custom' ? 'selected' : ''}>${tt('Custom')}</option></select></label>
      ${a.center === 'custom' ? `<input id="an-c0" type="number" step="0.001" value="${a.c0}" inputmode="decimal" title="${tt('Custom centre [mm]')}" style="width:70px">` : ''}
      <label title="${tt('Half range of the color scale ± [mm] around the centre. 0 = automatic: zone/2, or t/2 if a form tolerance exists')}">${tt('Range ±')} <input id="an-sc" type="number" min="0" step="0.01" value="${a.scale}" inputmode="decimal"></label>
      <label title="${tt('Color classes: number of discrete color bands over the full range (each band = range / classes). 0 = continuous gradient')}">${tt('Classes')} <input id="an-st" type="number" min="0" max="40" step="1" value="${a.steps}"></label>
      <button data-a="whisk" class="${a.whisk ? 'on' : ''}" ${a.res.dir ? '' : 'disabled'} title="${tt('Deviation arrows: one colored arrow per point along the surface normal, length = deviation × exaggeration')}">➚ ${tt('Arrows')}</button>
      <label title="${tt('Exaggeration: arrow length = deviation × this factor (deviations are often µm, invisible at 1×)')}">× <input id="an-ex" type="number" min="1" step="10" value="${a.exag}"></label>
      <button data-a="zones" class="${a.zones ? 'on' : ''}" ${a.kind === 'form' ? '' : 'disabled'} title="${tt('Show the bounding surfaces of the form zone (ISO 1101), e.g. two parallel planes for flatness, two coaxial cylinders for cylindricity')}">▤ ${tt('Zone')}</button>
      <button data-a="trans" class="${a.trans ? 'on' : ''}" title="${tt('Semi-transparent model under the color map')}">◌ ${tt('Transparent')}</button>
      <button data-a="help" title="${tt('Explain the analysis settings')}">?</button>${deriveHtml()}`,
    bind: (el) => {
      cp.bind(el); bindDerive(el);
      const num = (id: string, f: (v: number) => void, neg = false) => { const i = el.querySelector<HTMLInputElement>(id); if (!i) return; i.onchange = () => { const v = Number(i.value.replace(',', '.')); if (isFinite(v) && (neg || v >= 0)) { f(v); renderScene(); } }; };
      num('#an-sc', (v) => (a.scale = v)); num('#an-st', (v) => (a.steps = Math.round(v))); num('#an-ex', (v) => (a.exag = Math.max(1, v))); num('#an-c0', (v) => (a.c0 = v), true);
      const cm = el.querySelector<HTMLSelectElement>('#an-cm')!; cm.onchange = () => { a.center = cm.value as any; renderAll(); };
      el.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) => (b.onclick = () => {
        const k = b.dataset.a;
        if (k === 'help') { showDocs('analyze'); return; }
        if (k === 'whisk') { a.whisk = !a.whisk; if (a.whisk && a.res && a.res.dev.length > 1e6) toast(tt('{0} points – more than 1 million: arrows are thinned out to 4000 for display speed', a.res.dev.length.toLocaleString())); }
        else if (k === 'zones') a.zones = !a.zones; else a.trans = !a.trans; renderAll();
      }));
    },
    cancel: { run: analyzeOff, title: tt('Close analysis') },
  };
}
document.querySelectorAll<HTMLElement>('[data-an]').forEach((b) => (b.onclick = (e) => (b.dataset.an === 'axis' ? axisButton(e as MouseEvent) : analyze(b.dataset.an as AnKind))));
/** Axis analysis button: unambiguous – one axis control of the selected cylinder/cone → that one; several → pick; none → vs. fitted axis. */
function axisButton(e: MouseEvent) {
  const f = state.features.find((x) => state.sel.includes(x.id) && (x.type === 'Zylinder' || x.type === 'Kegel')) ?? state.features.find((x) => !state.hidden.has(x.id) && (x.type === 'Zylinder' || x.type === 'Kegel'));
  const cs = f ? state.controls.filter((c) => c.featureIds[0] === f.id && ctrlAnalysisKind(c) === 'axis') : [];
  if (cs.length === 1) { void analyzeControl(cs[0].id); return; }
  if (cs.length > 1) { showMenu(e.clientX, e.clientY, cs.map((c) => [ctrlTitle(c), () => void analyzeControl(c.id)] as [string, () => void])); return; }
  if (f) state.sel = [f.id]; void analyze('axis');
}
/** Analyze ribbon: control picker (all analysable controls). */
function renderAnPicker() {
  const sel = document.getElementById('an-ctrl') as HTMLSelectElement | null; if (!sel) return;
  const cs = state.controls.filter((c) => ctrlAnalysisKind(c));
  sel.innerHTML = cs.length ? cs.map((c) => `<option value="${c.id}" ${state.an.ctrl === c.id || state.selControl === c.id ? 'selected' : ''}>${ctrlAnalysisKind(c) === 'axis' ? '⌀ ' : '◐ '}${ctrlTitle(c)}</option>`).join('') : `<option value="">${tt('No analysable controls yet')}</option>`;
  ($('#btn-an-ctrl') as HTMLButtonElement).disabled = !cs.length;
}
const assocSel = $('#datum-assoc') as HTMLSelectElement;
assocSel.onchange = () => { state.opts.datumAssoc = assocSel.value as DatumAssoc; toast(assocSel.value === 'iso' ? tt('Datums: ISO 5459 contact simulation') : tt('Datums: least-squares (Gauss) fits')); renderAll(); };
$('#btn-datum-info').onclick = () => showDatumInfo();
const filtCb = $('#datum-filter') as HTMLInputElement; filtCb.onchange = () => { state.opts.datumFilter = filtCb.checked; renderAll(); };
/** Table: how each datum reference frame of the controls was simulated (method, shift/tilt vs. least squares). */
function showDatumInfo() {
  const fm = featMap(), seqs = new Map<string, Feature[]>();
  for (const c of state.controls) { const ds = (c.datumIds ?? []).map((i) => fm.get(i)).filter((d): d is Feature => !!d?.measured && !!d.datum); if (ds.length) seqs.set(ds.map((d) => d.id).join('|'), ds); }
  for (const f of state.features) if (f.datum && f.measured && ![...seqs.values()].some((s) => s[0].id === f.id)) seqs.set(String(f.id), [f]);
  const rows = [...seqs.values()].map((ds) => { const { info } = simulateDatums(ds, ctx); return ds.map((d, i) => `<tr><td>${i === 0 ? ds.map((x) => x.datum).join('|') : ''}</td><td><b>${d.datum}</b> ${['primary', 'secondary', 'tertiary'][i] ? tt(['primary', 'secondary', 'tertiary'][i]) : ''}</td><td>${d.name}</td><td>${tt(info[i].method)}</td><td>${fmt(info[i].shift, 4)}</td><td>${fmt(info[i].tilt, 4)}</td></tr>`).join(''); }).join('');
  const el = $('#help-view'); el.classList.remove('hidden');
  el.innerHTML = `<div class="rv-head"><b>ⓘ ${tt('Datum simulation')}</b> · ${state.opts.datumAssoc === 'lsq' ? tt('Least squares (Gauss)') : tt('ISO 5459 (contact)')}<span style="flex:1"></span><button class="btn" data-doc-link title="${tt('Explain the datum simulation')}">?</button><button class="btn" id="hv-close" title="${tt('Close')}">✕</button></div>
    <div class="rv-body"><table class="tbl"><thead><tr><th>${tt('DRF')}</th><th>${tt('Datum')}</th><th>${tt('Feature')}</th><th>${tt('Association')}</th><th title="${tt('Distance of the simulated datum from the least-squares fit (along the normal for planes, radial for axes)')}">${tt('Shift')} [mm]</th><th title="${tt('Angle between the simulated datum and the least-squares fit')}">${tt('Tilt')} [°]</th></tr></thead><tbody>${rows || `<tr><td colspan="6">${tt('No datums defined yet.')}</td></tr>`}</tbody></table></div>`;
  ($('#hv-close') as HTMLButtonElement).onclick = () => el.classList.add('hidden');
  (el.querySelector('[data-doc-link]') as HTMLButtonElement).onclick = () => showDocs('drf');
}
$('#btn-an-ctrl').onclick = () => { const v = ($('#an-ctrl') as HTMLSelectElement).value; if (v) void analyzeControl(+v); };
document.querySelector('#btn-an-off')?.addEventListener('click', analyzeOff);
document.querySelector('#btn-an-whisk')?.addEventListener('click', () => { state.an.whisk = !state.an.whisk; renderAll(); });
document.querySelector('#btn-an-trans')?.addEventListener('click', () => { state.an.trans = !state.an.trans; renderAll(); });
document.querySelector('#btn-an-set')?.addEventListener('click', () => { if (!state.an.on) analyze(state.an.kind); else document.querySelector<HTMLInputElement>('#an-sc')?.focus(); });

// ------------------------------------------------------------------ Auswahl, Prüfmerkmale
function selectFeature(id: number, additive = false) {
  if (state.mode?.kind === 'dist') { setDistanceSlot(id); return; }
  if (state.csEdit?.field) { csPick(id); return; }
  if (state.mode?.kind === 'con') { conPick(id); return; }
  if (additive) state.sel = state.sel.includes(id) ? state.sel.filter((x) => x !== id) : [...state.sel, id].slice(-2);
  else state.sel = [id];
  state.selModel = false; state.selControl = null; state.addFeat = id; state.csSel = null;
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
    if (other) { other.datum = old; toast(old ? tt('Datums swapped: {0} = {1}, {2} = {3}', f.name, letter, other.name, old) : tt('{0} moved from {1} to {2} – {1} has no datum any more', letter, other.name, f.name)); }
    else toast(old ? tt('Datum {0} → {1} renamed ({2})', old, letter, f.name) : tt('Datum {0} = {1}', letter, f.name));
    f.datum = letter;
  } else {
    f.datum = undefined;
    const n = dependents(f.id).length;
    toast(tt('Datum {0} removed', old ?? '') + (n ? tt(' – {0} control(s) marked as “datum removed”', n) : ''));
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
/** TED inputs (theoretically exact dimensions) of a datum control: empty until entered, required ones marked;
 *  'Use actual as nominal' only in the ⋯ menu. */
/** Ø toggle of axis orientation controls (zone shape): applies to perpendicularity/parallelism/angularity of a cylinder/cone axis. */
function diaInfo(c: Control, f?: FeatureView): { applies: boolean; on: boolean } {
  const D = state.features.find((x) => x.id === c.datumIds?.[0]);
  if (!f || !D || !['Rechtwinkligkeit', 'Parallelität', 'Neigung'].includes(c.kind) || (f.type !== 'Zylinder' && f.type !== 'Kegel')) return { applies: false, on: false };
  return { applies: true, on: c.dia ?? defaultDia(c.kind, D.type === 'Ebene') };
}
function diaButton(c: Control, f: FeatureView, after: () => void): HTMLButtonElement {
  const b = document.createElement('button'), on = diaInfo(c, f).on; b.className = 'btn dia-tg' + (on ? ' on' : ''); b.textContent = 'Ø';
  b.title = on ? tt('Ø in the feature control frame: cylindrical tolerance zone. Click for a zone between two parallel planes') : tt('No Ø: zone between two parallel planes (worst direction if the drawing gives none). Click for a cylindrical Ø zone');
  b.onclick = (e) => { e.stopPropagation(); c.dia = !on; after(); }; return b;
}
/** Datum reference frame input as slots: primary (placeholder) → secondary appears once filled → tertiary.
 *  Each slot lists the defined datums; datum features of size get a material modifier (Ⓜ/Ⓛ → datum shift). */
function datumSlots(c: Control, f: FeatureView, after: () => void): HTMLElement {
  const box = document.createElement('span'); box.className = 'dslots';
  const mx = DATUM_COUNT[c.kind as keyof typeof DATUM_COUNT]?.[1] ?? 1, ids = c.datumIds ?? [], NAMES = [tt('Primary'), tt('Secondary'), tt('Tertiary')];
  const commit = (n: number[], mods: ('M' | 'L' | null)[]) => { c.datumIds = n; c.datumMods = mods.some(Boolean) ? mods.slice(0, n.length) : undefined; after(); };
  for (let i = 0; i < mx && i <= ids.length; i++) {
    if (i > 0) box.append('|');
    const sel = document.createElement('select'); sel.className = 'dslot'; sel.dataset.slot = String(i);
    sel.title = tt('{0} datum (drawing order). Only datums defined in the tree are listed', NAMES[i]);
    const avail = datumFeatures().filter((d) => d.id !== f.id && !ids.slice(0, i).includes(d.id));
    sel.innerHTML = `<option value="">${NAMES[i]}…</option>` + avail.map((d) => `<option value="${d.id}" ${ids[i] === d.id ? 'selected' : ''}>${d.datum} · ${d.name}</option>`).join('');
    sel.onchange = () => { const v = sel.value ? +sel.value : null, n = ids.slice(0, i), mods = (c.datumMods ?? []).slice(0, i);
      if (v != null) { n.push(v); mods.push(null); for (const id of ids.slice(i + 1)) if (id !== v) { n.push(id); mods.push(null); } }
      if (!n.length) { toast(tt('A datum control needs at least a primary datum.')); after(); return; }
      commit(n, mods); };
    box.appendChild(sel);
    const d = ids[i] != null ? state.features.find((x) => x.id === ids[i]) : undefined;
    if (d && c.kind === 'Position' && (d.type === 'Zylinder' || d.type === 'Kreis')) {
      const m = document.createElement('select'); m.className = 'dmod'; m.title = tt('Material modifier of this datum: Ⓜ/Ⓛ lets the datum frame shift by the departure of the datum feature from its MMC/LMC size');
      const cur = c.datumMods?.[i] ?? ''; m.innerHTML = ['', 'M', 'L'].map((v) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${v ? MOD_SYM[v as 'M' | 'L'] : '–'}</option>`).join('');
      m.onchange = () => { const mods = ids.map((_, j) => c.datumMods?.[j] ?? null); mods[i] = (m.value || null) as any; commit(ids.slice(), mods); };
      box.appendChild(m);
    }
  }
  return box;
}
/** Status badge; an unconfirmed nominal keeps the verdict but marks it as provisional. */
function stHtml(r: { status: string; flag?: string }): string {
  if (r.flag === NOMINAL_UNCONFIRMED) return `<span class="st ${r.status} unconf" title="${tt('Computed with TED suggested from the actual part – confirm ✓ or enter the drawing values')}">${statusText(r.status as any)}?</span> <span class="flag unconf">${tt('Nominal unconfirmed')}</span>`;
  return `<span class="st ${r.status === '—' ? 'none' : r.status}">${statusText(r.status as any)}</span>`;
}
/** One TED input: confirmed value (normal), suggestion from the actual part (grey italic + ✓), optional or not applicable. */
function tedEl(c: Control, t: TedField, after: () => void, inline = false): HTMLElement {
  const wrap = document.createElement(inline ? 'label' : 'span'); wrap.className = 'ted-f ' + t.state;
  const conf = c.basic?.[t.k] != null && isFinite(c.basic[t.k]!), sug = !conf && t.state === 'req' && t.sug != null;
  if (inline) wrap.append(t.label + ' ');
  const i = document.createElement('input'); i.inputMode = 'decimal'; i.className = 'ted' + (sug ? ' sug' : '') + (t.state === 'req' && !conf && !sug ? ' req' : '');
  i.dataset.ted = String(t.k);
  i.value = conf ? String(c.basic![t.k]) : sug ? String(t.sug) : '';
  i.placeholder = t.state === 'free' ? tt('n/a') : t.state === 'opt' ? tt('optional') : tt('required');
  i.disabled = t.state === 'free';
  i.title = tt(t.why) + (sug ? ' · ' + tt('Suggested from the actual part (unconfirmed): tick ✓ to confirm, or type the drawing value') : '');
  const set = (v: number | null) => { const b = c.basic ?? []; while (b.length <= t.k) b.push(null); b[t.k] = v; c.basic = b; after(); };
  i.onchange = () => { const s2 = i.value.replace(',', '.').trim(), v = s2 === '' ? null : Number(s2); if (v != null && !isFinite(v)) return; set(v); };
  wrap.appendChild(i);
  if (sug) { const ok = document.createElement('button'); ok.className = 'btn ted-ok'; ok.textContent = '✓'; ok.dataset.cf = String(t.k); ok.title = tt('Confirm the suggested value {0} as TED from the drawing', String(t.sug)); ok.onclick = (e) => { e.stopPropagation(); set(t.sug); }; wrap.appendChild(ok); }
  return wrap;
}
function tedConfirmAll(c: Control, spec: TedField[], after: () => void): HTMLButtonElement | null {
  const open = spec.filter((t) => t.state === 'req' && t.sug != null && (c.basic?.[t.k] == null)); if (open.length < 2) return null;
  const b = document.createElement('button'); b.className = 'btn ted-ok all'; b.textContent = '✓ ' + tt('all'); b.title = tt('Confirm all suggested TED values (only if they match the drawing)');
  b.onclick = (e) => { e.stopPropagation(); const bb = c.basic ?? []; while (bb.length < 7) bb.push(null); for (const t of open) bb[t.k] = t.sug; c.basic = bb; after(); }; return b;
}
function tedInputs(c: Control, f: FeatureView, lab: (t: string, el: HTMLElement) => void) {
  const ds = (c.datumIds ?? []).map((i) => state.features.find((x) => x.id === i));
  const spec = tedSpec(c, f, ds);
  for (const t of spec) lab(t.label, tedEl(c, t, () => renderAll()));
  const all = tedConfirmAll(c, spec, () => renderAll()); if (all) lab('', all);
}
/** Ⓜ/Ⓛ applies to the position of a feature of size (cylinder, circle, bolt-circle pattern). */
const modApplies = (c: Control, f?: FeatureView) => !!f && c.kind === 'Position' && (f.type === 'Zylinder' || f.type === 'Kreis');
function modButton(c: Control, after: () => void): HTMLButtonElement {
  const b = document.createElement('button'); b.className = 'btn mod-tg' + (c.mod ? ' on' : ''); b.textContent = c.mod ? MOD_SYM[c.mod] : 'Ⓜ/Ⓛ';
  b.title = tt('Material modifier on the tolerance: none → Ⓜ maximum material (bonus as the hole grows / shaft shrinks) → Ⓛ least material. Needs a Diameter control with nominal and tolerances on the feature');
  b.onclick = (e) => { e.stopPropagation(); c.mod = c.mod == null ? 'M' : c.mod === 'M' ? 'L' : undefined; after(); }; return b;
}
function czButton(c: Control, after: () => void): HTMLButtonElement {
  const on = c.cz !== false, b = document.createElement('button'); b.className = 'btn cz-tg' + (on ? ' on' : ''); b.textContent = on ? 'CZ' : 'SZ';
  b.title = on ? tt('Common zone (CZ): all holes of the pattern are checked together, the pattern may only move as one. Click for separate zones') : tt('Separate zones (SZ): each hole is checked on its own. Click for a common zone (CZ)');
  b.onclick = (e) => { e.stopPropagation(); c.cz = !on; after(); }; return b;
}
/** Text after the value in the frame: Ⓜ/Ⓛ and CZ. */
const frameMods = (c: Control, f?: FeatureView) => `${c.mod ? MOD_SYM[c.mod] : ''}${f && isPattern(f) && c.cz !== false ? ' CZ' : ''}`;
const bonusText = (r: { bonus?: number }) => (r.bonus ? ` <small class="bonus" title="${tt('Bonus tolerance from Ⓜ/Ⓛ (added to the tolerance)')}">+${fmt(r.bonus, 4)}</small>` : '');

function addControl(kind: ControlKind, id: number) {
  const t = defaultTolerance(kind);
  const c: Control = { id: state.nextCtrl++, kind, featureIds: [id], nominal: t.nominal, tolUp: t.up, tolLo: t.lo };
  if (isDatumControl(kind)) { c.datumIds = defaultDatums(kind, id); if (kind === 'Neigung') c.basic = [null]; else if (kind === 'Position' || kind === 'Profil (Bezug)') c.basic = [null, null, null]; } // TED never prefilled: user enters drawing values
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
  if (!state.features.length) { toast('No features for a report.'); return; }
  const r = buildReport(state.nextReport++, state.features, state.controls, state.data?.name ?? '', new Date(), ctx);
  state.reports.push(r); state.openReport = r.id;
  renderAll();
  toast(tt('✔ {0} created ({1} features, {2} controls)', r.name, r.features.length, r.controls.length));
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
    // cascade: everything computed from the deleted features (provenance: constructions, distances, chains)
    for (const id of dependentsOf(state.features, s)) s.add(id);
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
  if (state.csEdit && (e.key === 'Escape' || e.key === 'Enter')) { e.key === 'Escape' ? csCancel() : csOk(); return; }
  if (e.key === 'Delete' && state.csSel) { csDelete(state.csSel); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !pe.tool && !state.mode && cv.undo.length) { e.preventDefault(); curveUndo(); return; }
  if (e.key === 'Escape' && state.curveSel != null) { if (cv.edit) { cv.edit = null; renderDialog(); } else curveSelect(null); return; }
  if (e.key === 'Delete' && state.curveSel != null && !pe.tool) { curveDelete(); return; }
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
  const x = document.createElement('button'); x.className = 'panel-close'; x.textContent = '✕'; x.title = tt('Close');
  x.onclick = () => togglePanel(p, false); t.prepend(x);
}

// ------------------------------------------------------------------ Darstellung
function renderAll() { if (document.getElementById('cs-ind')) renderCsIndicator(); renderModeBar(); renderRibbon(); renderTree(); renderDialog(); renderTable(); renderScene(); renderHint(); renderReport(); scheduleAutosave(); }

function renderRibbon() {
  document.querySelectorAll<HTMLButtonElement>('[data-ftype]').forEach((b) => b.classList.toggle('on',
    (state.mode?.kind === 'fit' && state.mode.type === b.dataset.ftype) || (state.mode?.kind === 'dist' && b.dataset.ftype === 'Abstand')));
  document.querySelectorAll<HTMLButtonElement>('[data-con]').forEach((b) => b.classList.toggle('on', state.mode?.kind === 'con' && (b.dataset.con === state.mode.out || b.dataset.con === state.mode.key) && !(b.dataset.con === 'Kreis' && state.mode.key === 'bc-pattern')));
  $('#btn-toggle-prims').classList.toggle('on', state.showPrims);
  $('#btn-toggle-trim').classList.toggle('on', state.trimGeo);
  $('#btn-toggle-pts').classList.toggle('on', state.colorPts);
  $('#btn-toggle-labels').classList.toggle('on', state.showLabels);
}

function renderHint() {
  if (!state.data) return hint('');
  if (state.csEdit) return hint(state.csEdit.field ? tt('Coordinate system: pick the feature for “{0}” in the 3D view or the tree.', csFieldName(state.csEdit.field)) : tt('Coordinate system: check the triad, then ✓ create or ✕ cancel.'));
  const m = state.mode;
  if (!m) return hint('');
  if (m.kind === 'con') { const c = conByKey(m.key)!, s = slotFor(c, m.slot); return hint(s ? tt('Construction: pick “{0}” in the 3D view or the tree.', tt(s.label)) : tt('Construction: check the preview, then ✓ create.')); }
  if (m.kind === 'anchor') return hint(tt('Anchor: click point {0} of {1} on the mesh.', Math.min(m.pts.length + 1, ANCHOR_N[m.out]!), ANCHOR_N[m.out]!));
  if (m.kind === 'dist') return hint(m.slot === 0 ? tt('Distance: pick the first feature in the 3D view or the tree.') : tt('Distance: pick the second feature in the 3D view or the tree.'));
  if (state.preview && state.opts.multi && state.preview.fit.type === 'Ebene') return hint(tt('Add region: click further faces of the plane (Shift+click also works), then ✓ create.'));
  if (state.preview) return hint(tt('Preview – check the values, then ✓ create or ✕ discard.'));
  if (m.method === 'Klick') return hint(tt('{0}: click/tap on the surface (mouse wheel = analysis area).', m.type === 'auto' ? tt('Auto detection') : typeName(m.type)));
  hint('');
}

function eyeBtn(visible: boolean, onToggle: () => void, label = false) {
  const b = document.createElement('button'); b.className = (label ? 'eye lab-eye' : 'eye') + (visible ? '' : ' off');
  b.title = label ? (visible ? tt('Hide annotation') : tt('Show annotation')) : visible ? tt('Hide') : tt('Show');
  b.innerHTML = label ? '🏷' : visible ? ICON.eye : ICON.eyeOff;
  b.onclick = (e) => { e.stopPropagation(); onToggle(); };
  return b;
}
// Baumgruppen: zusammenklappbar (Zustand in localStorage); jede Zeile mit ▾ klappt die tieferen Folgezeilen ein.
const TREE_KEY = 'mw-tree-closed';
const treeClosed = new Set<string>((() => { try { return JSON.parse(localStorage.getItem(TREE_KEY) ?? '[]'); } catch { return []; } })());
function toggleTreeGroup(k: string) { treeClosed.has(k) ? treeClosed.delete(k) : treeClosed.add(k); try { localStorage.setItem(TREE_KEY, JSON.stringify([...treeClosed])); } catch { /* */ } renderTree(); }
const lvl = (el: HTMLElement) => { const m = el.className.match(/indent(\d)/); return m ? +m[1] : 0; };
function applyTreeGroups(t: HTMLElement) {
  let hideBelow = Infinity;
  for (const el of [...t.children] as HTMLElement[]) {
    const L = lvl(el);
    if (L <= hideBelow) hideBelow = Infinity;
    if (hideBelow !== Infinity) { el.style.display = 'none'; continue; }
    const tw = el.querySelector<HTMLElement>('.tw'); const k = el.dataset.gk;
    if (!tw || !k || tw.textContent !== '▾') continue;
    const next = el.nextElementSibling as HTMLElement | null; if (!next || lvl(next) <= L) { tw.textContent = ''; continue; }
    const closed = treeClosed.has(k); tw.textContent = '▾'; tw.classList.add('twb'); tw.style.transform = closed ? 'rotate(-90deg)' : '';
    tw.title = closed ? tt('Expand') : tt('Collapse');
    tw.onclick = (e) => { e.stopPropagation(); toggleTreeGroup(k); };
    if (closed) hideBelow = L;
  }
}
function renderTree() {
  const q = ($('#search') as HTMLInputElement).value.trim().toLowerCase();
  const t = $('#tree'); t.innerHTML = '';
  const node = (html: string, cls: string, onClick?: (e: MouseEvent) => void, sel = false, fid?: number, eye?: HTMLElement) => {
    const d = document.createElement('div'); d.className = `node ${cls}${sel ? ' sel' : ''}`; d.innerHTML = html;
    if (eye) d.prepend(eye);
    if (fid != null) { d.dataset.fid = String(fid); d.dataset.gk = 'f' + fid; }
    else if (/indent[01]/.test(cls) || cls === '') d.dataset.gk = 'g:' + (d.textContent ?? '').replace(/\(.*$/, '').trim();
    if (onClick) d.onclick = onClick; t.appendChild(d); return d;
  };
  const feats = state.features;
  node(`<span class="tw">▾</span>${ICON.folder}<b>${tt('Objects')}</b>`, '');
  node(`<span class="tw">▾</span>${ICON.data}${tt('Data')}`, 'indent1', undefined, false, undefined, state.data ? eyeBtn(state.modelVisible, () => { state.modelVisible = !state.modelVisible; renderAll(); }) : undefined);
  if (state.data) {
    const mn = node(`<span class="tw"></span>${ICON.mesh}${state.data.name} <span class="sub">(${tt('polygon model')})</span>`, 'indent2 model-node', () => selectModel(), state.selModel, undefined,
      eyeBtn(state.modelVisible, () => { state.modelVisible = !state.modelVisible; renderTree(); renderScene(); }));
    mn.ondblclick = () => centerOn(null); attachContext(mn, null);
  }
  const anyVis = feats.some((f) => !state.hidden.has(f.id));
  node(`<span class="tw">▾</span>${ICON.folder}${tt('Features')} (${feats.length})`, 'indent1', undefined, false, undefined, feats.length ? eyeBtn(anyVis, () => {
    if (anyVis) feats.forEach((f) => state.hidden.add(f.id)); else state.hidden.clear(); renderAll(); }) : undefined);
  const distSlots = state.mode?.kind === 'dist' ? [state.mode.a, state.mode.b] : [];
  for (const f of feats) {
    if (q && !f.name.toLowerCase().includes(q) && !typeName(f.type).toLowerCase().includes(q)) continue;
    const ico = f.type === 'Abstand' ? ICON['Abstand 3D'] : ICON[f.type];
    const tag = distSlots.includes(f.id) ? ` <span class="sub">[${distSlots.indexOf(f.id) === 0 ? 'A' : 'B'}]</span>` : '';
    const sel = state.sel.includes(f.id), vis = !state.hidden.has(f.id), lab = !state.hiddenLabels.has(f.id);
    const fnode = node(`<span class="tw">▾</span><span style="color:${hex(f.color)}">${ico}</span>${f.name}${f.datum ? `<span class="dflag sm" title="${tt('Datum {0}', f.datum)}">${f.datum}</span>` : ''}${f.refs?.length ? ` <span class="chain" title="${tt('Constructed from')}: ${f.refs.map(nameOf).join(', ')}">🔗</span>` : ''}${f.cons?.error || f.derived?.error ? ` <span class="sub" title="${f.cons?.error ?? f.derived?.error}">⚠</span>` : ''}${tag}`,
      'indent2' + (vis ? '' : ' hidden-feat'), (e) => selectFeature(f.id, e.ctrlKey || e.metaKey || e.shiftKey), sel, f.id,
      eyeBtn(vis, () => { vis ? state.hidden.add(f.id) : state.hidden.delete(f.id); renderTree(); renderScene(); }));
    fnode.appendChild(eyeBtn(lab, () => { lab ? state.hiddenLabels.add(f.id) : state.hiddenLabels.delete(f.id); renderTree(); renderScene(); }, true));
    fnode.ondblclick = () => centerOn(f.id);
    attachContext(fnode, f.id);
    if (f.measured) node(`<span class="tw"></span>${ICON.ist}${tt('Actual')}${f.type === 'Abstand' ? ` <span class="sub">${fmt(distValue(f.measured, f.dim?.comp ?? '3D'), 3)} mm</span>` : ''}`, 'indent3', () => selectFeature(f.id));
    if (f.aux) node(`<span class="tw"></span>${ICON.aux}${tt('Aux. plane')} <span class="sub">${f.aux.refId ? '(' + nameOf(f.aux.refId) + ')' : ''}</span>`, 'indent3 aux-node', () => selectFeature(f.id));
    if (f.nominal) node(`<span class="tw"></span>${ICON.soll}${tt('Nominal')}`, 'indent3', () => selectFeature(f.id));
  }
  if (state.curves.length) {
    const cv = state.curves.some((c) => c.visible);
    node(`<span class="tw">▾</span>${ICON.folder}${tt('Curve network')} (${state.curves.length})${state.layout ? ` <span class="sub">${state.layout.regions.length} ${tt('patches')} · ${state.layout.foursided} ${tt('4-sided')} · ${state.layout.tJunctions} T</span>` : ''}`, 'indent1', undefined, false, undefined,
      eyeBtn(cv, () => { state.curves.forEach((c) => (c.visible = !cv)); renderTree(); renderScene(); scheduleAutosave(); }));
    for (const c of state.curves) {
      if (q && !c.name.toLowerCase().includes(q)) continue;
      const cn = node(`<span class="tw"></span><span style="color:${hex(CURVE_COLOR[c.kind])}">〰</span>${c.name} <span class="sub">${CURVE_KIND_EN[c.kind]} · ${c.length.toFixed(1)} mm</span>`,
        'indent2 curve-node' + (c.visible ? '' : ' hidden-feat'), () => { state.curveSel = state.curveSel === c.id ? null : c.id; renderTree(); renderScene(); renderDialog(); }, state.curveSel === c.id, undefined,
        eyeBtn(c.visible, () => { c.visible = !c.visible; renderTree(); renderScene(); scheduleAutosave(); }));
      cn.dataset.cid = String(c.id);
    }
  }
  csTree(node);
  cadTree(node, q);
  if (state.reports.length) {
    node(`<span class="tw">▾</span>${ICON.folder}${tt('Reports')} (${state.reports.length})`, 'indent1');
    for (const r of state.reports) node(`<span class="tw"></span>${ICON.report}${r.name} <span class="sub">${r.created}</span>`, 'indent2 report-node',
      () => { state.openReport = r.id; renderReport(); renderTree(); if (isPhone()) togglePanel('tree', false); }, state.openReport === r.id);
  }
  applyTreeGroups(t);
}
const CURVE_KIND_EN: Record<string, string> = { Kante: 'edge', Tangente: 'tangent', Übergang: 'transition', Benutzer: 'user', Vorschlag: 'seam' };
function selectModel() { if (state.mode?.kind === 'dist') return; state.sel = []; state.selModel = true; state.selControl = null; state.curveSel = null; renderAll(); }
function clearSelection() { if (!state.sel.length && !state.selModel && state.curveSel == null && state.csSel == null) return; state.sel = []; state.selModel = false; state.csSel = null; state.selControl = null; state.curveSel = null; renderAll(); }
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
  if (!full && m.nurbs) { const nb = m.nurbs; return [[tt('Std. dev. σ'), fmt(nb.std)], [tt('Surface profile'), fmt(m.form)], ['Max. +', sgn(m.maxPos)], ['Max. −', sgn(m.maxNeg)],
    [tt('Patch'), `${patchKind(nb.kind)}, ${nb.surface.nu}×${nb.surface.nv}, ${tt('degree')} ${nb.surface.degU}`]]; }
  const rows: [string, string][] = [];
  if (full) rows.push([tt('Points'), String(pointCount)]);
  rows.push([tt('Std. dev. (RMS)'), fmt(m.rms)], [FORM_NAME[m.type], fmt(m.form)], ['Max. +', sgn(m.maxPos)], ['Max. −', sgn(m.maxNeg)]);
  if (m.outliers) rows.push([tt('Outliers removed'), String(m.outliers)]);
  if (m.type === 'Torus') rows.push([tt('Center circle Ø 2R'), fmt(m.diameter)], [tt('Center circle R'), fmt(m.radius)], [tt('Tube Ø 2r'), fmt(2 * Math.abs(m.minorRadius ?? 0))], [tt('Tube r'), fmt(Math.abs(m.minorRadius ?? 0))]);
  else if (m.diameter != null && m.type !== 'Langloch') rows.push([tt('Diameter'), fmt(m.diameter)]);
  if (m.type === 'Langloch') rows.push([tt('Length'), fmt(m.length)], [tt('Width'), fmt(m.width)]);
  if (m.type === 'Kegel') rows.push([tt('Cone angle [°]'), fmt(2 * m.halfAngle! * DEG, 3)]);
  if (m.nurbs) { const nb = m.nurbs; rows.splice(full ? 1 : 0, 0, [tt('Std. dev. σ'), fmt(nb.std)]);
    rows.push([tt('Patch'), nb.kind === 'vierseitig' ? tt('four-sided (4 boundary curves)') : tt('trimmed (1 boundary curve)')], [tt('Control points'), `${nb.surface.nu} × ${nb.surface.nv}`], [tt('Degree'), `${nb.surface.degU} / ${nb.surface.degV}`], [tt('Smoothing λ'), String(nb.params.smooth)]); }
  if (full && m.type === 'Freiformfläche') return rows;
  if (full) {
    const fr = activeFrame(), C = fr ? csLocal(fr, m.center) : m.center, N = fr ? csDir(fr, m.normal) : m.normal;
    if (fr) rows.push([tt('Coordinate system'), activeCsName()]);
    rows.push(['X', fmt(C[0])], ['Y', fmt(C[1])], ['Z', fmt(C[2])], ['I', fmt(N[0], 6)], ['J', fmt(N[1], 6)], ['K', fmt(N[2], 6)]);
    if (m.type === 'Zylinder' || m.type === 'Kegel') rows.push([tt('Height'), fmt(m.length)]);
    if (m.type === 'Langloch') rows.push([tt('Direction'), m.direction!.map((v) => v.toFixed(4)).join(' ')]);
    if (m.type === 'Kegel') rows.push(['Spitze', m.apex!.map((v) => v.toFixed(3)).join(' ')]);
  }
  return rows;
}
const kv = (rows: [string, string][]) => `<div class="kv">${rows.map(([k, v]) => `<div>${k}</div><div>${v}</div>`).join('')}</div>`;

/** Zweifarbige Vorschau: Kennwerte von Merkmal (orange) und Hilfsebene (blau). */
function auxStats(p: Preview): string {
  const m = p.fit, pl = p.aux!.plane;
  const size: [string, string][] = m.type === 'Langloch' ? [[tt('Length'), fmt(m.length)], [tt('Width'), fmt(m.width)]] : m.type === 'Torus' ? [['Ø 2R', fmt(m.diameter)], [tt('Tube Ø'), fmt(2 * Math.abs(m.minorRadius ?? 0))]] : m.type === 'Linie' ? [[tt('Length'), fmt(m.length)]] : [[tt('Diameter'), fmt(m.diameter)]];
  return `<div class="aux-stats"><div class="as-col"><div class="as-h"><i style="background:${hex(PREVIEW_COLOR)}"></i>${m.type} (Wand)</div>
    ${kv([[tt('Points'), String(p.indices.length)], ['RMS', fmt(m.rms)], [FORM_NAME[m.type], fmt(m.form)], ...size])}</div>
    <div class="as-col"><div class="as-h"><i style="background:${hex(AUX_COLOR)}"></i>Hilfsebene</div>
    ${kv([[tt('Points'), p.aux!.refId ? '(' + nameOf(p.aux!.refId) + ')' : String(p.aux!.indices.length)], ['RMS', fmt(pl.rms)], [tt('Flatness'), fmt(pl.form)], [tt('Normal'), pl.normal.map((v) => v.toFixed(3)).join(' ')]])}</div></div>`;
}
/** Extensible dialog system: the first provider whose when() is true renders the dialog area.
 *  Active tools come first, then the selected object (tree or 3D pick); nothing selected → hint. */
interface DialogProvider { id: string; when: () => boolean; render: (d: HTMLElement) => boolean | void; }
const DIALOGS: DialogProvider[] = [
  { id: 'cad', when: () => cadActive(), render: (d) => cadDialog(d) },
  { id: 'curve-draw', when: () => pe.tool === 'curve', render: (d) => renderCurveDialog(d) },
  { id: 'curve-opts', when: () => pe.tool === 'curveopts', render: (d) => renderCurveOpts(d) },
  { id: 'mesh-tool', when: () => !!pe.tool, render: (d) => renderPolyDialog(d) },
  { id: 'csys-edit', when: () => !!state.csEdit, render: (d) => renderCsEdit(d) },
  { id: 'construct-mode', when: () => state.mode?.kind === 'con', render: (d) => renderConDialog(d) },
  { id: 'anchor-mode', when: () => state.mode?.kind === 'anchor', render: (d) => renderAnchorDialog(d) },
  { id: 'distance-mode', when: () => state.mode?.kind === 'dist', render: (d) => renderDistDialog(d) },
  { id: 'fit-mode', when: () => state.mode?.kind === 'fit', render: (d) => renderFitDialog(d) },
  { id: 'curve', when: () => curveById(state.curveSel) != null, render: (d) => renderCurveSel(d, curveById(state.curveSel)!) },
  { id: 'csys', when: () => state.csSel != null && (state.csSel === 0 || state.csys.some((c) => c.id === state.csSel)), render: (d) => renderCsDialog(d) },
  { id: 'feature', when: () => state.features.some((x) => x.id === state.sel[0]), render: (d) => renderFeatureDialog(d, state.features.find((x) => x.id === state.sel[0])!) },
  { id: 'model', when: () => state.selModel && !!state.data, render: (d) => renderModelDialog(d) },
  { id: 'empty', when: () => true, render: (d) => { d.innerHTML = `<div class="dlg-empty">${state.data ? tt('Select an object in the tree or 3D view to show details') : tt('Import a polygon model (STL, PLY, OBJ) or point cloud (XYZ), or load a sample.')}</div>`; } },
];
/** Register a dialog for a new object type (inserted before the generic ones). */
export function registerDialog(p: DialogProvider, before = 'model') { const i = DIALOGS.findIndex((x) => x.id === before); DIALOGS.splice(i < 0 ? DIALOGS.length - 1 : i, 0, p); }
function renderDialog() {
  const d = $('#dialog'); d.innerHTML = '';
  for (const p of DIALOGS) if (p.when() && p.render(d) !== false) { d.dataset.dlg = p.id; return; }
}
function renderModelDialog(d: HTMLElement) {
  d.innerHTML = `<h3>${ICON.mesh} ${tt('Polygon model')}</h3>${kv([[tt('Name'), state.data!.name], [tt('Points'), state.data!.vertexCount.toLocaleString('en-US')], [tt('Triangles'), state.data!.triCount.toLocaleString('en-US')], [tt('Edits'), pe.edits.length ? pe.edits.join(' → ') : tt('original')]])}
    <h4>${tt('Display')}</h4><div class="row chk"><label><input type="checkbox" id="md-vis" ${state.modelVisible ? 'checked' : ''}> ${tt('Visible')}</label></div>
    <p class="note">${tt('Start ribbon › Features: choose a type (or Auto), click on the mesh, check the preview in the Action Bar and confirm with ✓.')}</p>
    <div><button class="btn" id="md-center">⌖ ${tt('Center')}</button><button class="btn" id="md-dev">◑ ${tt('Deviation to original')}</button></div>`;
  d.querySelector<HTMLInputElement>('#md-vis')!.onchange = (e) => { state.modelVisible = (e.target as HTMLInputElement).checked; renderTree(); renderScene(); };
  d.querySelector('#md-center')!.addEventListener('click', () => centerOn(null));
  d.querySelector('#md-dev')!.addEventListener('click', () => analyze('mesh'));
}
function renderDistDialog(d: HTMLElement) {
  const m = state.mode as DistMode; const p = state.preview;
  d.innerHTML = `<h3>${ICON['Abstand 3D']} ${tt('Distance')}</h3>${methodSeg('Abstand', 'mesh')}
    <p class="note">${tt('Pick two features in the 3D view or in the tree. Choose 3D, X, Y or Z in the Action Bar, drag the annotation to place the dimension, then confirm with ✓.')}</p>
    ${kv([[tt('Feature A'), nameOf(m.a)], [tt('Feature B'), nameOf(m.b)]])}
    ${p ? `<h4>${tt('Result (actual)')}</h4>${kv(fitRows(p.fit, 0))}` : ''}
    <p class="note">${tt('Rule: center to center; if a plane is involved, the center of the other feature is projected perpendicularly onto the plane (point–plane distance). X/Y/Z are the absolute components.')}</p>`;
}
function renderFitDialog(d: HTMLElement) {
  const m = state.mode as FitMode; const p = state.preview;
  d.innerHTML = `<h3>${ICON[m.type] ?? ''} ${tt('Create feature')}: ${m.type === 'auto' ? tt('Auto detection') : typeName(m.type)}</h3>${methodSeg(m.type, 'mesh')}
    <p class="note">${tt('Method, type, brush/area radius and ✓ ✕ are in the Action Bar (bottom of the 3D view). Here: settings and details.')}</p>
    ${m.method === 'Klick' ? `<h4>${tt('Region growing')}</h4>
    <div class="row"><label>${tt('Max. normal angle [°]')}</label><input id="d-ang" value="${state.opts.maxAngleDeg}" inputmode="decimal"></div>
    <div class="row"><label>${tt('Area radius [mm] (0 = ∞)')}</label><input id="d-rad" value="${state.opts.radius}" inputmode="decimal"></div>
    ${usesAuxType(m.type) ? `<h4>${ICON.aux} ${tt('Auxiliary plane (projection plane)')}</h4>
    <div class="row"><select id="d-aux"><option value="auto" ${state.opts.aux === 'auto' ? 'selected' : ''}>${tt('Automatic – full adjacent planar face')}</option><option value="ring" ${state.opts.aux === 'ring' ? 'selected' : ''}>${tt('Local ring around the contour')}</option>
      ${state.features.filter((f) => f.type === 'Ebene').map((f) => `<option value="${f.id}" ${state.opts.aux === f.id ? 'selected' : ''}>${tt('Existing plane')}: ${f.name}</option>`).join('')}
      <option value="none" ${state.opts.aux === 'none' ? 'selected' : ''}>${tt('None (3D fit)')}</option></select></div>
    ${state.opts.aux === 'ring' ? `<div class="row"><label>${tt('Ring gap [mm]')}</label><input id="d-rg" value="${state.opts.ring.gap}" inputmode="decimal"></div><div class="row"><label>${tt('Ring width [mm]')}</label><input id="d-rw" value="${state.opts.ring.width}" inputmode="decimal"></div><p class="note">${tt('Only the plane points in a ring (circle), stadium band (slot) or band along the edge (line) are used: starting at the gap outside the edge, with the given width. Useful when the face is not flat far away from the hole.')}</p>` : ''}
    <p class="note">${m.type === 'Linie' ? tt('Click on the edge between two faces. The line is the intersection edge fitted inside the auxiliary plane; choose which adjacent face is the auxiliary plane in the Action Bar.') : tt('Click near the transition face/wall (or on the wall): the wall points are projected into the plane and the feature is fitted in the plane. The center lies in the plane, orientation = plane normal.')}</p>` : ''}`
    : `<h4>${tt('Brush')}</h4><p class="note">${tt('Paint: stroke over the mesh. Erase: Erase button or hold Shift. Undo: Ctrl+Z. Esc clears the selection, a second Esc returns to Click & grow.')}</p>`}
    ${p ? `<h4>${tt('Preview')}: ${typeName(p.fit.type)}</h4>${p.aux ? auxStats(p) : ''}${kv(fitRows(p.fit, p.indices.length))}
      ${p.candidates.length ? `<h4>${tt('Detection (RMS per type)')}</h4>${kv(p.candidates.map((c) => [typeName(c.type), fmt(c.rms)] as [string, string]))}` : ''}`
    : `<p class="note">${tt('A click first creates a preview (points + geometry + values). Only ✓ creates the feature.')}</p>`}`;
  const bind = (id: string, key: 'maxAngleDeg' | 'radius' | 'brush') => { const el = d.querySelector<HTMLInputElement>(id); if (el) el.onchange = () => { const x = Number(el.value.replace(',', '.')); if (isFinite(x)) { state.opts[key] = x; renderModeBar(); } }; };
  bind('#d-ang', 'maxAngleDeg'); bind('#d-rad', 'radius');
  for (const [id, k] of [['#d-rg', 'gap'], ['#d-rw', 'width']] as const) { const el = d.querySelector<HTMLInputElement>(id); if (el) el.onchange = () => { const x = Number(el.value.replace(',', '.')); if (isFinite(x) && x >= 0) state.opts.ring[k] = k === 'width' ? Math.max(0.2, x) : x; }; } bindMethodSeg(d, m.type);
  d.querySelector<HTMLSelectElement>('#d-aux')?.addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value; state.opts.aux = v === 'auto' || v === 'none' || v === 'ring' ? v : +v;
    if (state.preview?.hit) refitPreview(state.preview.fit.type); else renderAll();
  });
}
function renderFeatureDialog(d: HTMLElement, f: FeatureView) {
  const ico = f.type === 'Abstand' ? ICON['Abstand 3D'] : ICON[f.type];
  const dk = datumKind(f.type);
  d.innerHTML = `<h3><span style="color:${hex(f.color)}">${ico}</span> ${f.name}${f.refs?.length ? ' <span class="chain" title="' + tt('Depends on other features') + '">🔗</span>' : ''}</h3>
    <div class="row"><label>${tt('Name')}</label><input id="d-name" value="${f.name}"></div>
    <div class="row"><label>${tt('Color')}</label><input type="color" id="d-color" value="${hex(f.color)}"><span class="note">${state.colorMode === 'uniform' ? tt('(uniform color mode – see View › Options)') : ''}</span></div>
    <div class="row chk"><label><input type="checkbox" id="d-vis" ${state.hidden.has(f.id) ? '' : 'checked'}> ${tt('Geometry visible')}</label><label><input type="checkbox" id="d-lab" ${state.hiddenLabels.has(f.id) ? '' : 'checked'}> ${tt('Annotation visible')}</label></div>
    ${f.refs && !f.cons ? `<div class="note">${tt('References')}: ${nameOf(f.refs[0])} → ${nameOf(f.refs[1])}</div>` : ''}${conDefinitionHTML(f)}${provenanceHTML(f)}${reexHTML(f)}
    <h4>${tt('Actual')}</h4>${kv([[tt('Type'), typeName(f.type)], [tt('Method'), methodName(f.method)], ...(f.cons ? conRows(f.measured!) : fitRows(f.measured!, f.pointCount))])}
    ${f.aux ? `<h4>${ICON.aux} ${tt('Auxiliary plane')}</h4>${kv([[tt('Source'), auxSourceText(f.aux)], [tt('Points'), f.aux.refId ? '—' : String(f.aux.pointCount)], [tt('RMS'), fmt(f.aux.plane.rms)], [tt('Flatness'), fmt(f.aux.plane.form)],
      [tt('Point'), f.aux.plane.center.map((v) => v.toFixed(3)).join(' ')], [tt('Normal'), f.aux.plane.normal.map((v) => v.toFixed(5)).join(' ')]])}` : ''}
    ${f.type !== 'Abstand' && !f.cons ? fitParamsHTML(f) : ''}
    ${dk ? `<h4><span class="dflag sm">${f.datum ?? '?'}</span> ${tt('Datum (ISO 5459)')}</h4>
      <div class="row" id="dt-box"><select id="dt-letter">${DATUM_LETTERS.slice(0, 10).map((l) => { const o = state.features.find((g) => g.datum === l && g.id !== f.id);
        return `<option value="${l}" ${(f.datum ?? nextFreeLetter()) === l ? 'selected' : ''}>${l}${o ? ` (${tt('swap with {0}', o.name)})` : ''}</option>`; }).join('')}</select>
        <button class="btn primary" id="dt-apply">${f.datum ? tt('Rename') : tt('Assign datum')}</button></div>
      ${f.datum ? `<div class="row"><button class="btn" id="dt-remove">${tt('Remove datum {0}', f.datum)}</button><span class="note">${tt('{0} control(s) use {1}', dependents(f.id).length, f.datum)}</span></div>` : ''}
      <p class="note">${dk === 'plane' ? tt('Plane as datum: defines a direction (normal) and location.') : dk === 'axis' ? tt('Axis as datum (hole/shaft): defines axis direction and location.') : tt('Center point as datum.')}
        <button class="linkbtn" id="dt-training">🎓 ${tt('Training mode: datums')}</button></p>` : ''}
    <div><button class="btn" id="d-center">⌖ ${tt('Center')}</button><button class="btn" id="d-addctrl">＋ ${tt('Control …')}</button><button class="btn" id="d-an">◐ ${tt('Analyze deviation')}</button><button class="btn" id="d-del">${tt('Delete feature')}</button></div>`;
  d.querySelector('#dt-apply')?.addEventListener('click', () => setDatum(f, ($('#dt-letter') as HTMLSelectElement).value));
  d.querySelector('#dt-remove')?.addEventListener('click', () => setDatum(f, null));
  d.querySelector('#dt-training')?.addEventListener('click', () => startTraining());
  d.querySelector('#d-center')?.addEventListener('click', () => centerOn(f.id));
  d.querySelector('#d-an')?.addEventListener('click', () => { state.sel = [f.id]; analyze('form'); });
  ($('#d-name') as HTMLInputElement).onchange = (e) => { f.name = (e.target as HTMLInputElement).value; renderAll(); };
  ($('#d-color') as HTMLInputElement).oninput = (e) => { f.color = parseInt((e.target as HTMLInputElement).value.slice(1), 16); f.colorSet = true; renderTree(); renderScene(); scheduleAutosave(); };
  ($('#d-vis') as HTMLInputElement).onchange = (e) => { (e.target as HTMLInputElement).checked ? state.hidden.delete(f.id) : state.hidden.add(f.id); renderTree(); renderScene(); };
  ($('#d-lab') as HTMLInputElement).onchange = (e) => { (e.target as HTMLInputElement).checked ? state.hiddenLabels.delete(f.id) : state.hiddenLabels.add(f.id); renderTree(); renderScene(); };
  ($('#d-del') as HTMLButtonElement).onclick = () => { state.selControl = null; deleteSelected(); };
  ($('#d-addctrl') as HTMLButtonElement).onclick = () => { state.addFeat = f.id; state.ctab = 'katalog'; renderTable(); togglePanel('table', true); };
  if (f.cons) bindConDefinition(d, f); else bindFitParams(d, f);
  bindReex(d, f);
}
const auxSourceText = (a: AuxPlane) => (a.refId ? nameOf(a.refId) : tt('automatic (adjacent face)'));

function nurbsParamsHTML(f: FeatureView) {
  const fp = (f.fp ??= defaultFp()); const grow = !!f.hit && f.method === 'Klick'; const nb = f.measured!.nurbs!; const P = nb.params;
  return `<h4>⚙ ${tt('Freeform parameters')} <span class="note">(${tt('change ⇒ automatic refit')})</span></h4><div id="fp-box">
    <div class="row"><label>${tt('Geometry type')}</label><select id="d-retype">${FIT_TYPES.map((t) => `<option value="${t}" ${t === f.type ? 'selected' : ''}>${typeName(t)}</option>`).join('')}</select></div>
    <div class="row"><label>${tt('Control points u')}</label><input id="nb-nu" value="${P.nu}" inputmode="numeric"></div>
    <div class="row"><label>${tt('Control points v')}</label><input id="nb-nv" value="${P.nv}" inputmode="numeric"></div>
    <div class="row"><label>${tt('Degree')}</label><select id="nb-deg">${[1, 2, 3, 4, 5].map((d) => `<option ${d === P.deg ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
    <div class="row"><label>${tt('Smoothing λ')}</label><input id="nb-sm" value="${P.smooth}" inputmode="decimal"></div>
    ${grow ? `<div class="row"><label>${tt('Region growing: max. angle [°]')}</label><input id="fp-ang" value="${fp.maxAngleDeg}" inputmode="decimal"></div>` : `<p class="note">${f.method === 'Pinsel' ? tt('Points from brush selection.') : tt('Points from project file.')}</p>`}
    <div class="row chk"><label><input type="checkbox" id="nb-dev" ${state.devMap ? 'checked' : ''}> ${tt('Deviation color map')}</label></div>
    <div class="row chk"><label><input type="checkbox" id="nb-net" ${state.ctrlNet ? 'checked' : ''}> ${tt('Show control net')}</label></div>
    <p class="note">${tt('Process: boundary loop of the selection → {0} → parametrisation → least-squares fit with smoothing → parameter correction. More control points = more accurate but wavier; λ smooths.', nb.kind === 'vierseitig' ? tt('4 corners, 4 boundary curves') : tt('trimmed patch (1 boundary curve)'))}</p>
    <div class="row"><button class="btn" id="nb-igs">⇩ IGES (128)</button><button class="btn" id="nb-stp">⇩ STEP</button><button class="btn" id="nb-json">⇩ JSON</button></div>
    </div>`;
}
function bindNurbsParams(d: HTMLElement, f: FeatureView) {
  const fp = f.fp!; const P = f.measured!.nurbs!.params; const q = <T extends HTMLElement>(s: string) => d.querySelector<T>(s);
  const num = (id: string, set: (x: number) => void, ok: (x: number) => boolean) => { const el = q<HTMLInputElement>(id); if (el) el.onchange = () => { const x = Number(el.value.replace(',', '.')); if (isFinite(x) && ok(x)) { set(x); refitFeature(f); } else toast(tt('Invalid value')); }; };
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
  return `<h4>⚙ ${tt('Fit parameters')} <span class="note">(${tt('change ⇒ automatic refit')})</span></h4><div id="fp-box">
    <div class="row"><label>${tt('Geometry type')}</label><select id="d-retype">${FIT_TYPES.map((t) => `<option value="${t}" ${t === f.type ? 'selected' : ''}>${typeName(t)}</option>`).join('')}</select></div>
    <div class="row"><label>${tt('Method')}</label><select id="fp-method"><option value="lsq" ${fp.k ? '' : 'selected'}>${tt('Gauss (least squares)')}</option><option value="rob" ${fp.k ? 'selected' : ''}>${tt('Gauss robust (remove outliers)')}</option></select></div>
    ${fp.k ? `<div class="row"><label>${tt('Outliers &gt; k·σ, k =')}</label><input id="fp-k" value="${fp.k}" inputmode="decimal"></div>` : ''}
    ${grow ? `<div class="row"><label>${tt('Region growing: max. angle [°]')}</label><input id="fp-ang" value="${fp.maxAngleDeg}" inputmode="decimal"></div>
      <div class="row"><label>${tt('Area radius [mm] (0 = ∞)')}</label><input id="fp-rad" value="${fp.radius}" inputmode="decimal"></div>` : `<p class="note">${f.method === 'Pinsel' ? tt('Points from brush selection – no region growing.') : tt('Points from project file – no region growing.')}</p>`}
    <div class="row chk"><label><input type="checkbox" id="fp-nf" ${fp.nf.on ? 'checked' : ''}> ${tt('Normal direction filter')}</label></div>
    ${fp.nf.on ? `<div class="row"><label>${tt('max. normal deviation [°]')}</label><input id="fp-nfa" value="${fp.nf.angleDeg}" inputmode="decimal"></div>
      <div class="row"><label>${tt('discard at most [%]')}</label><input id="fp-nfp" value="${fp.nf.maxPct}" inputmode="decimal"></div>` : ''}
    <p class="note">${tt('Normal filter: points whose measured surface normal deviates from the fitted element by more than the angle (edges, chamfers, adjacent faces) are discarded – worst first, at most the percentage.')}${m.nfRemoved ? ` <b>${tt('Currently {0} points discarded.', m.nfRemoved)}</b>` : ''}</p>
    ${(f.type === 'Kreis' || f.type === 'Langloch' || f.type === 'Linie') && grow ? `<div class="row"><label>${tt('Auxiliary plane')}</label><select id="fp-aux"><option value="auto" ${fp.aux === 'auto' ? 'selected' : ''}>${tt('Automatic')}</option><option value="ring" ${fp.aux === 'ring' ? 'selected' : ''}>${tt('Local ring')}</option>
      ${planes.map((g) => `<option value="${g.id}" ${fp.aux === g.id ? 'selected' : ''}>${g.name}</option>`).join('')}<option value="none" ${fp.aux === 'none' ? 'selected' : ''}>${tt('None (3D fit)')}</option></select></div>
      ${fp.aux === 'ring' ? `<div class="row"><label>${tt('Ring gap / width [mm]')}</label><input id="fp-rg" value="${fp.ring?.gap ?? state.opts.ring.gap}" inputmode="decimal" style="width:4em"><input id="fp-rw" value="${fp.ring?.width ?? state.opts.ring.width}" inputmode="decimal" style="width:4em"></div>` : ''}` : ''}
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
  num('#fp-rg', (x) => ((fp.ring ??= { ...state.opts.ring }).gap = x)); num('#fp-rw', (x) => ((fp.ring ??= { ...state.opts.ring }).width = Math.max(0.2, x)));
  num('#fp-nfa', (x) => (fp.nf.angleDeg = Math.min(89, x))); num('#fp-nfp', (x) => (fp.nf.maxPct = Math.min(90, x)));
  q<HTMLSelectElement>('#fp-aux')?.addEventListener('change', (e) => { const v = (e.target as HTMLSelectElement).value; fp.aux = v === 'auto' || v === 'none' || v === 'ring' ? v : +v; refitFeature(f); });
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
  // ---------- Control Properties: catalog (ISO 1101 checklist) of the feature selected in the tree / 3D view; empty otherwise
  const cat = $('#catalog'); cat.innerHTML = '';
  const f = state.features.find((x) => x.id === state.sel[0]);
  if (f) state.addFeat = f.id;
  const head = document.createElement('div'); head.className = 'cat-head';
  head.innerHTML = f ? `<b>${f.name}</b> <span class="note">${tt('Tick = control (shown in the annotation)')}</span>` : '';
  cat.appendChild(head);
  if (!f) { cat.insertAdjacentHTML('beforeend', `<div class="dlg-empty">${tt('Select a feature in the tree or 3D view to edit its controls')}</div>`); }
  else for (const g of controlCatalog(f.type)) {
    const gd = document.createElement('div'); gd.className = 'cat-group'; gd.innerHTML = `<div class="cat-gt">${g.group}</div>`;
    for (const it of g.items) {
      const c = state.controls.find((k) => k.kind === it.kind && k.featureIds[0] === f.id);
      const row = document.createElement('div'); row.className = 'cat-item' + (c ? ' on' : ''); row.dataset.kind = it.kind;
      const r = c ? evaluate(c, fm, ctx) : null;
      const ist = r ? r.measured : isDatumControl(it.kind) ? null : evaluate({ id: 0, kind: it.kind, featureIds: [f.id], nominal: null, tolUp: 0, tolLo: 0 }, fm, ctx).measured;
      const needD = isDatumControl(it.kind) && !c && !datumFeatures().some((d) => d.id !== f.id);
      row.innerHTML = `<label><input type="checkbox" ${c ? 'checked' : ''} ${needD ? 'disabled' : ''}><span class="sym">${it.symbol}</span><span class="cl" title="${it.note ?? ''}">${it.label}</span></label>
        <span class="ist">${needD ? `<small>${tt('Assign datum')}</small>` : fmt(ist)}</span>`;
      row.querySelector('input')!.onchange = (e) => toggleControl(it.kind, f.id, (e.target as HTMLInputElement).checked);
      if (c && r && isDatumControl(c.kind)) {
        const ed = document.createElement('span'); ed.className = 'cat-ed datum-ed';
        const lab = (t: string, el: HTMLElement) => { const s = document.createElement('span'); s.className = 'ce'; s.innerHTML = `<small>${t}</small>`; s.appendChild(el); ed.appendChild(s); };
        lab(c.kind === 'Position' || c.kind === 'Koaxialität' || c.kind === 'Konzentrizität' ? 'Tol Ø' : 'Tol', numInput(c.tolUp, (x) => (c.tolUp = Math.abs(x ?? 0))));
        lab(tt('Datums'), datumSlots(c, f, () => renderAll()));
        tedInputs(c, f, lab);
        if (diaInfo(c, f).applies) lab(tt('Zone'), diaButton(c, f, () => renderAll()));
        if (modApplies(c, f)) lab(tt('Material'), modButton(c, () => renderAll()));
        if (c.kind === 'Position' && isPattern(f)) lab(tt('Pattern'), czButton(c, () => renderAll()));
        ed.insertAdjacentHTML('beforeend', `<span class="frame">${it.symbol} ${c.kind === 'Position' && datumKind(f.type) !== 'plane' ? (f.type === 'Kugel' || f.type === 'Punkt' || f.type === 'Torus' ? 'SØ' : 'Ø') : diaInfo(c, f).on ? 'Ø' : ''}${fmt(c.tolUp, 3)}${frameMods(c, f)}${c.datumIds?.length ? ' | ' + datumText(c, fm) : ''}</span>
          <span class="dev ${r.status}">${r.measured == null ? '' : fmt(r.measured)}${bonusText(r)}</span>${r.flag === NOMINAL_UNCONFIRMED ? stHtml(r) : `<span class="st ${r.flag === NOMINAL_MISSING ? 'missing' : r.status === '—' ? 'none' : r.status}">${r.flag ? '⚠' : r.status}</span>${r.flag ? `<span class="flag${r.flag === NOMINAL_MISSING ? ' missing' : ''}">⚠ ${tt(r.flag)}</span>` : ''}`}`);
        if (r.detail) ed.title = r.detail;
        row.appendChild(ed);
      } else if (c && r) {
        const ed = document.createElement('span'); ed.className = 'cat-ed';
        const lab = (t: string, el: HTMLElement) => { const s = document.createElement('span'); s.className = 'ce'; s.innerHTML = `<small>${t}</small>`; s.appendChild(el); ed.appendChild(s); };
        if (isZoneControl(c.kind)) lab(tt('Tol (0..t)'), numInput(c.tolUp, (x) => (c.tolUp = Math.abs(x ?? 0))));
        else {
          lab(tt('Nominal'), numInput(c.nominal, (x) => (c.nominal = x)));
          lab(tt('Tol+'), numInput(c.tolUp, (x) => (c.tolUp = x ?? 0)));
          lab(tt('Tol−'), numInput(c.tolLo, (x) => (c.tolLo = x == null ? 0 : -Math.abs(x))));
        }
        ed.insertAdjacentHTML('beforeend', `<span class="dev ${r.status}">${r.deviation == null || isZoneControl(c.kind) ? '' : sgn(r.deviation)}</span><span class="st ${r.status === '—' ? 'none' : r.status}">${statusText(r.status)}</span>`);
        row.appendChild(ed);
      }
      gd.appendChild(row);
    }
    cat.appendChild(gd);
  }
  if (f && !datumFeatures().some((d) => d.id !== f.id) && f.type !== 'Abstand') cat.insertAdjacentHTML('beforeend',
    `<p class="note" style="padding:2px 8px 8px">${tt('Tolerances with datum (∥ ⟂ ∠ ⌖ ◎ ⌯ ↗) become available as soon as another feature has a datum (A, B, C …) – Dialog › Datum.')}</p>`);

  // ---------- Liste aller Prüfmerkmale
  $('#ctab-n').textContent = String(state.controls.length);
  const tb = $('#ctrl-table tbody'); tb.innerHTML = '';
  let io = 0, nio = 0;
  const flt = $<HTMLInputElement>('#cl-filter'); if (flt) { flt.checked = state.ctrlFilter; flt.onchange = () => { state.ctrlFilter = flt.checked; renderTable(); }; }
  const shown = state.ctrlFilter ? state.controls.filter((c) => c.featureIds.some((id) => state.sel.includes(id))) : state.controls;
  for (const c of state.controls) { const r = evaluate(c, fm, ctx); if (r.status === 'IO') io++; if (r.status === 'NIO') nio++; }
  if (!shown.length) tb.innerHTML = `<tr><td colspan="9" class="note">${state.controls.length ? tt('No controls for the features selected in the tree.') : tt('No controls yet. Tick controls in Control Properties.')}</td></tr>`;
  for (const c of shown) {
    const r = evaluate(c, fm, ctx);
    const fc = fm.get(c.featureIds[0]);
    const tr = document.createElement('tr');
    if (state.selControl === c.id) tr.className = 'sel';
    const td = (html: string | HTMLElement, cls = '') => { const e = document.createElement('td'); e.className = cls; if (typeof html === 'string') e.innerHTML = html; else e.appendChild(html); tr.appendChild(e); return e; };
    td(fc?.name ?? '?');
    td(`<span class="sym">${CTRL_SYMBOL(c, fc)}</span> ${controlLabel(c, fc)}${c.datumIds?.length ? ` <span class="frame">${datumText(c, fm)}</span>` : ''}${r.flag && r.flag !== NOMINAL_UNCONFIRMED ? ` <span class="flag${r.flag === NOMINAL_MISSING ? ' missing' : ''}">⚠ ${tt(r.flag)}</span>` : ''}`);
    const zone = isZoneControl(c.kind);
    td(zone ? '<span class="note">—</span>' : numInput(c.nominal, (x) => (c.nominal = x)), 'num');
    td(fmt(r.measured), 'num');
    td(zone ? '' : fmt(r.deviation), `num dev ${r.status}`);
    td(numInput(c.tolUp, (x) => (c.tolUp = zone ? Math.abs(x ?? 0) : x ?? 0)), 'num');
    td(zone ? '<span class="note" title="' + tt('Form/orientation tolerance zone 0..t') + '">0</span>' : numInput(c.tolLo, (x) => (c.tolLo = x == null ? 0 : -Math.abs(x))), 'num');
    td(r.flag === NOMINAL_MISSING ? `<span class="st missing" title="${tt('Enter the theoretically exact dimensions (TED) from the drawing in the control catalog')}">${tt('Nominal missing')}</span>` : stHtml(r));
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.title = tt('Delete');
    x.onclick = (e) => { e.stopPropagation(); state.controls = state.controls.filter((k) => k.id !== c.id); renderAll(); };
    const ak = ctrlAnalysisKind(c), an = document.createElement('button'); an.className = 'x an-row'; an.textContent = '◐'; an.disabled = !ak;
    an.title = ak === 'axis' ? tt('Analyze this control (axis view)') : ak === 'form' ? tt('Analyze this control (colour map)') : tt('No analysis view for dimensions');
    an.onclick = (e) => { e.stopPropagation(); void analyzeControl(c.id); };
    const cell = td(an); cell.appendChild(x);
    tr.oncontextmenu = (e) => { e.preventDefault(); showMenu(e.clientX, e.clientY, [[`◐ ${tt('Analyze')}`, ak ? () => void analyzeControl(c.id) : null], [`⌖ ${tt('Center')}`, () => centerOn(c.featureIds[0])], null, [`✕ ${tt('Delete')}`, () => { state.controls = state.controls.filter((k) => k.id !== c.id); renderAll(); }]]); };
    tr.onclick = (e) => { if ((e.target as HTMLElement).tagName === 'INPUT') return; state.sel = [...c.featureIds]; state.selControl = c.id; state.addFeat = c.featureIds[0]; renderTree(); renderDialog(); renderScene(); renderTable(); };
    tb.appendChild(tr);
  }
  renderAnPicker(); const as0 = document.getElementById('datum-assoc') as HTMLSelectElement | null; if (as0) as0.value = state.opts.datumAssoc ?? 'iso'; const fc0 = document.getElementById('datum-filter') as HTMLInputElement | null; if (fc0) { fc0.checked = state.opts.datumFilter !== false; fc0.disabled = state.opts.datumAssoc === 'lsq'; }
  $('#mb-sum').textContent = state.controls.length ? `${io}/${nio}` : '';
  $('#summary').innerHTML = state.controls.length ? `${state.controls.length} · <span style="color:var(--io)">${io} OK</span> · <span style="color:var(--nio)">${nio} NOK</span>` : '';
}

/** 3D-Label: Kopf = Merkmalsname, Körper = gewählte Prüfmerkmale (Ist/Soll/Abw., IO/NIO-Farbe). */
function labelHTML(f: FeatureView, fm: Map<number, Feature>): string {
  const cs = state.controls.filter((c) => c.featureIds[0] === f.id);
  const rows = cs.map((c) => {
    const r = evaluate(c, fm, ctx), z = isZoneControl(c.kind);
    return `<tr class="${r.status === '—' ? '' : r.status}"><td>${CTRL_SYMBOL(c, f)} ${controlLabel(c, f)}${c.datumIds?.length ? ` |${datumText(c, fm)}|` : ''}${r.flag ? ' ⚠' : ''}</td><td>${fmt(r.measured, 3)}</td>`
      + `<td>${z ? '≤ ' + fmt(c.tolUp, 3) : c.nominal == null ? '—' : fmt(c.nominal, 3)}</td><td>${z || r.deviation == null ? '' : sgn(r.deviation, 3)}</td></tr>`;
  }).join('');
  const m = f.measured!, extra: string[] = [];
  if (f.type !== 'Abstand') { if (state.annot.pts) extra.push(`${f.pointCount} ${tt('pts')}`); if (state.annot.std) extra.push(`σ ${fmt(m.nurbs?.std ?? m.rms, 4)}`); }
  return `<div class="lh"><i></i>${f.name}${f.datum ? `<span class="dflag">${f.datum}</span>` : ''}</div>${extra.length ? `<div class="lx">${extra.join(' · ')}</div>` : ''}`
    + `${cs.length ? `<table><tr class="lt"><th></th><th>${tt('Act.')}</th><th>${tt('Nom./Tol')}</th><th>${tt('Dev.')}</th></tr>${rows}</table>` : ''}`;
}

/** Farbskala symmetrisch: ±max(3σ, |max|) begrenzt auf 3σ, mind. 1 µm. */
function devRange(dev: Float32Array) { let s = 0; for (const d of dev) s += d * d; return Math.max(1e-3, 3 * Math.sqrt(s / Math.max(1, dev.length))); }
function renderDevLegend(dev: Float32Array | null) {
  let el = document.getElementById('dev-legend');
  if (!dev) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'dev-legend'; viewer.el.appendChild(el); }
  const r = devRange(dev);
  el.innerHTML = `<b>${tt('Deviation [mm]')}</b><div class="bar"></div><div class="ticks"><span>${sgn(-r, 3)}</span><span>0</span><span>${sgn(r, 3)}</span></div>`;
}
function renderScene() {
  if (!state.data) return;
  if (viewer.model) viewer.model.visible = state.modelVisible;
  const vis = (f: FeatureView) => !state.hidden.has(f.id);
  viewer.resetColors();
  const peOn = paintPolyCompare() || paintLayout() || paintAnalysis();
  if (!state.an.on) viewer.setModelOpacity(1);
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
  if (state.an.on) { /* Legende aus paintAnalysis */ }
  viewer.commitColors();
  viewer.clearPrims();
  renderCurves();
  if (state.an.on && state.an.whisk && state.an.res?.pos && state.an.res.dir) { const g = anRange(state.an.res); viewer.addArrows(state.an.res.pos, state.an.res.dir, state.an.res.dev, state.an.exag, g.h, g.c); }
  { const R = reexPreview((id) => state.features.some((x) => x.id === id)); if (R) viewer.addRegion(R); }
  if (state.an.on && state.an.res?.axes) for (const x of state.an.res.axes) viewer.addAxisAnalysis(x, axisExag(state.an.res), Math.max(1, state.an.axLoc), offsetLabel(x), { zones: state.an.axZones, env: state.an.axEnv });
  if (state.an.on && state.an.zones && state.an.res?.feats) for (const z of state.an.res.feats) { const f = state.features.find((x) => x.id === z.id); if (f?.measured) viewer.addZone(f.measured, z.lo, z.hi); }
  if (state.an.on && state.an.derivePrev) viewer.addPrimitive(state.an.derivePrev.fit, 0xd81b60, true);
  if (state.mode?.kind === 'anchor') for (const [i, q] of state.mode.pts.entries()) viewer.addPrimitive({ type: 'Punkt', center: q, normal: state.mode.nrm[i] } as FitResult, 0xff8c1a, true);
  if (state.showPrims) for (const f of state.features) {
    if (!vis(f)) continue;
    const sel = state.sel.includes(f.id);
    if (f.type === 'Winkel') viewer.addAngle(f.measured!, f.color, sel);
    else if (f.type === 'Abstand') viewer.addDistance(f.measured!.p1!, f.measured!.p2!, f.color, sel, f.dim ? dimGeometry(f.measured!, f.dim.comp, state.labelOffsets.get(f.id) ?? null) : undefined);
    else if (f.measured!.nurbs) viewer.addFreeform(f.measured!.nurbs, f.color, sel, sel && state.ctrlNet);
    else if (state.trimGeo && CURVE_TRIM_TYPES.includes(f.type) && f.indices.length >= 2 && viewer.model) {
      const seg = curveTrimFor(f); if (seg) { viewer.addTrimmed(new Float32Array(0), seg, f.color, sel); viewer.addPrimitiveMarkers(f.measured!, f.color); } else viewer.addPrimitive(f.measured!, f.color, sel);
    }
    else if (state.trimGeo && TRIM_TYPES.includes(f.type) && f.indices.length >= 3 && viewer.model) {
      const t = trimFor(f); if (t && t.tri.length) { viewer.addTrimmed(t.tri, t.edges, f.color, sel); viewer.addPrimitiveMarkers(f.measured!, f.color); } else viewer.addPrimitive(f.measured!, f.color, sel);
    }
    else viewer.addPrimitive(f.measured!, f.color, sel);
  }
  if (p) {
    if (p.fit.type === 'Winkel') viewer.addAngle(p.fit, PREVIEW_COLOR, true);
    else if (p.fit.type === 'Abstand' && state.mode?.kind === 'dist') viewer.addDistance(p.fit.p1!, p.fit.p2!, PREVIEW_COLOR, true, dimGeometry(p.fit, (state.mode as DistMode).comp, state.labelOffsets.get(-1) ?? null));
    else if (p.fit.nurbs) viewer.addFreeform(p.fit.nurbs, PREVIEW_COLOR, true, state.ctrlNet);
    else viewer.addPrimitive(p.fit, PREVIEW_COLOR, true);
    if (p.aux) viewer.addPrimitive({ ...p.aux.plane, center: p.fit.center }, AUX_COLOR, false);
  }
  renderCsTriads();
  // Labels
  const fm = featMap();
  const specs: LabelSpec[] = state.showLabels ? state.features.filter((f) => vis(f) && !state.hiddenLabels.has(f.id)).map((f) => {
    const m = f.measured!;
    const anchor = (f.type === 'Abstand' ? m.p1!.map((v, i) => (v + m.p2![i]) / 2) : m.center) as V3;
    return { id: f.id, anchor, html: labelHTML(f, fm), color: hex(f.color), offset: state.labelOffsets.get(f.id) ?? null, selected: state.sel.includes(f.id) };
  }) : [];
  if (p && p.fit.type === 'Abstand' && state.mode?.kind === 'dist') {
    const m = p.fit, comp = state.mode.comp;
    specs.push({ id: -1, anchor: m.p1!.map((v, i) => (v + m.p2![i]) / 2) as V3, color: hex(PREVIEW_COLOR), offset: state.labelOffsets.get(-1) ?? null, selected: true,
      html: `<div class="lh"><i></i>${tt('Distance')} ${comp}</div><table><tr><td>↔ ${comp}</td><td>${fmt(distValue(m, comp), 3)}</td></tr></table>` });
  }
  viewer.labels.set(specs);
}
viewer.labels.onMoved = (id, off) => { state.labelOffsets.set(id, off); const f = id < 0 ? null : state.features.find((x) => x.id === id);
  if (id < 0 || f?.dim) renderScene(); else scheduleAutosave(); };
viewer.labels.onSelect = (id) => { if (id >= 0) selectFeature(id); };

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
/** Blickrichtung zum Zentrieren: Kamera auf der Vorderseite (+Normale), Blick entlang −Normale. Achsen ohne Vorzeichen
 *  (Zylinder, Kegel, Linie, Torus): Seite, die der aktuellen Ansicht am nächsten liegt. Abstand: senkrecht zur Maßlinie. */
function viewDir(f: FeatureView): [number, number, number] | undefined {
  const m = f.measured!; let n = (f.aux?.plane.normal ?? m.normal) as [number, number, number];
  if (f.type === 'Abstand' || f.type === 'Punkt' || f.type === 'Kugel' || f.type === 'Freiformfläche') return undefined;
  if (['Zylinder', 'Kegel', 'Linie', 'Torus'].includes(f.type) && !f.aux) {
    const c = viewer.getCamera(); const v = [c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]];
    if (n[0] * v[0] + n[1] * v[1] + n[2] * v[2] < 0) n = [-n[0], -n[1], -n[2]];
    if (f.type === 'Linie') { // Linie: Blick senkrecht zur Linie
      const d = m.direction!; const k = v[0] * d[0] + v[1] * d[1] + v[2] * d[2]; const w = [v[0] - k * d[0], v[1] - k * d[1], v[2] - k * d[2]];
      return Math.hypot(...w) > 1e-6 ? (w as [number, number, number]) : undefined; }
  }
  return n;
}
function centerOn(id?: number | null) {
  const fid = id === undefined ? state.sel[0] ?? null : id;
  const f = state.features.find((x) => x.id === fid);
  if (!f) { viewer.view('fit'); status(tt('Model centered.')); return; }
  viewer.focus(f.measured!.center as [number, number, number], featureRadius(f), viewDir(f));
  status(tt('{0} centered (view along −normal).', f.name));
}
{
  const b = document.createElement('button'); b.id = 'btn-center'; b.title = tt('Center: align view to the selection (or model)');
  b.innerHTML = `<span>⌖</span> ${tt('Center')}`; b.onclick = () => centerOn();
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  viewer.el.appendChild(b);
}
// ------------------------------------------------------------------ Ansichts-Menü (Zahnrad über dem Navigationswürfel) + Menüband „Ansicht"

function toggleWire() { const on = !viewer.wire; viewer.setWireframe(on); syncViewToggles(); }
function toggleCurves() { showCurves = !showCurves; setCadEdges(showCurves); renderScene(); syncViewToggles(); }
function syncViewToggles() {
  for (const el of document.querySelectorAll('[data-vt="wire"]')) el.classList.toggle('on', !!viewer.wire);
  for (const el of document.querySelectorAll('[data-vt="curves"]')) el.classList.toggle('on', showCurves && cadEdgesOn);
  $('#btn-toggle-wire').classList.toggle('on', !!viewer.wire);
  for (const el of document.querySelectorAll('[data-vt="prims"]')) el.classList.toggle('on', state.showPrims);
  for (const el of document.querySelectorAll('[data-vt="labels"]')) el.classList.toggle('on', state.showLabels);
}
{
  const g = document.createElement('div'); g.id = 'view-gear';
  g.innerHTML = `<button class="vg-btn" title="${tt('View')}" aria-label="${tt('View menu')}">⚙</button><div class="vg-menu">
    <button data-vg="center">⌖ ${tt('Center')}</button><button data-vg="iso">◩ ISO</button><button data-vg="fit">⤢ ${tt('Fit all')}</button>
    <button data-vg="prims" data-vt="prims">◎ ${tt('Geometries')}</button><button data-vg="labels" data-vt="labels">🏷 ${tt('Annotations')}</button>
    <button data-vg="wire" data-vt="wire">▦ ${tt('Mesh edges')}</button><button data-vg="curves" data-vt="curves" class="on">〰 ${tt('Curves/CAD edges')}</button>
    <button data-vg="opts">⚙ ${tt('Options …')}</button></div>`;
  g.addEventListener('pointerdown', (e) => e.stopPropagation());
  g.querySelector<HTMLButtonElement>('.vg-btn')!.onclick = () => g.classList.toggle('open');
  g.querySelectorAll<HTMLButtonElement>('[data-vg]').forEach((b) => (b.onclick = () => { const a = b.dataset.vg;
    if (a === 'center') centerOn(); else if (a === 'iso') viewer.view('iso'); else if (a === 'fit') { viewer.view('fit'); status(tt('Fitted to view.')); }
    else if (a === 'wire') toggleWire(); else if (a === 'prims') $('#btn-toggle-prims').click(); else if (a === 'labels') $('#btn-toggle-labels').click(); else if (a === 'opts') openOptions(); else toggleCurves();
    g.classList.remove('open'); }));
  window.addEventListener('pointerdown', (e) => { if (!g.contains(e.target as Node)) g.classList.remove('open'); });
  viewer.el.appendChild(g);
  const info = document.createElement('div'); info.id = 'bbox-info'; info.className = 'hidden'; viewer.el.appendChild(info);
  info.addEventListener('pointerdown', (e) => { e.stopPropagation(); info.classList.toggle('open'); });
}
/** Unten rechts nur die Einheit; Abmessungen der Bounding-Box beim Überfahren (Tippen auf Telefonen). */
function showBBoxInfo(b: { min: number[]; max: number[] } | null) {
  const el = $('#bbox-info'); if (!b) { el.classList.add('hidden'); return; }
  const d = [0, 1, 2].map((k) => b.max[k] - b.min[k]); el.classList.remove('hidden');
  el.innerHTML = `<b>mm</b><span class="bb-d"> · ${d.map((x) => x.toFixed(1)).join(' × ')}</span>`; el.title = tt('Unit mm · overall bounding box X × Y × Z: {0}', d.map((x) => x.toFixed(2)).join(' × '));
}
/** Optionen: Farbmodus (einheitlich / fortlaufende Palette), Annotation-Inhalt. */
function openOptions() {
  document.getElementById('opts-dlg')?.remove();
  const el = document.createElement('div'); el.id = 'opts-dlg';
  el.innerHTML = `<div class="od-box"><h3>${tt('Options')}</h3>
    <h4>${tt('Feature colors')}</h4>
    <div class="row"><label><input type="radio" name="od-cm" value="sequential" ${state.colorMode === 'sequential' ? 'checked' : ''}> ${tt('Sequential (palette, one color per feature)')}</label></div>
    <div class="row"><label><input type="radio" name="od-cm" value="uniform" ${state.colorMode === 'uniform' ? 'checked' : ''}> ${tt('Uniform')}</label> <input type="color" id="od-uc" value="${hex(state.uniformColor)}"></div>
    <p class="note">${tt('Colors picked per feature (Properties) always take precedence.')}</p>
    <h4>${tt('Annotation')}</h4>
    <div class="row"><label><input type="checkbox" id="od-pts" ${state.annot.pts ? 'checked' : ''}> ${tt('Show point count')}</label></div>
    <div class="row"><label><input type="checkbox" id="od-std" ${state.annot.std ? 'checked' : ''}> ${tt('Show standard deviation σ')}</label></div>
    <div class="row"><button class="btn primary" data-ok>${tt('Close')}</button></div></div>`;
  const apply = () => { applyColorMode(); renderAll(); saveViewPrefs(); };
  el.querySelectorAll<HTMLInputElement>('input[name=od-cm]').forEach((r) => (r.onchange = () => { state.colorMode = r.value as any; apply(); }));
  el.querySelector<HTMLInputElement>('#od-uc')!.oninput = (e) => { state.uniformColor = parseInt((e.target as HTMLInputElement).value.slice(1), 16); apply(); };
  el.querySelector<HTMLInputElement>('#od-pts')!.onchange = (e) => { state.annot.pts = (e.target as HTMLInputElement).checked; apply(); };
  el.querySelector<HTMLInputElement>('#od-std')!.onchange = (e) => { state.annot.std = (e.target as HTMLInputElement).checked; apply(); };
  el.querySelector<HTMLButtonElement>('[data-ok]')!.onclick = () => el.remove();
  el.addEventListener('pointerdown', (e) => { if (e.target === el) el.remove(); });
  document.body.appendChild(el);
}
/** Farbmodus anwenden: einheitlich bzw. Palette in Erzeugungsreihenfolge; individuell gewählte Farben bleiben. */
function applyColorMode() {
  state.features.forEach((f, i) => { if (!f.colorSet) f.color = state.colorMode === 'uniform' ? state.uniformColor : PALETTE[i % PALETTE.length]; });
}
const PREF_KEY = 'mw-view-prefs';
function saveViewPrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify({ colorMode: state.colorMode, uniformColor: state.uniformColor, annot: state.annot })); } catch { /* */ } }
try { const pr = JSON.parse(localStorage.getItem(PREF_KEY) ?? 'null'); if (pr) { state.colorMode = pr.colorMode ?? state.colorMode; state.uniformColor = pr.uniformColor ?? state.uniformColor; state.annot = { ...state.annot, ...pr.annot }; } } catch { /* */ }
$('#btn-options').onclick = () => openOptions();
$('#btn-whatsnew').onclick = () => showWhatsNew();
$('#btn-toggle-trim').onclick = () => { state.trimGeo = !state.trimGeo; renderAll(); };
$('#ver-box').textContent = versionText();
setTimeout(() => maybeShowWhatsNew(), 1500);

// ------------------------------------------------------------------ Kontextmenü (Rechtsklick / langes Tippen)
const ctxMenu = document.createElement('div'); ctxMenu.id = 'ctx-menu'; ctxMenu.className = 'hidden'; document.body.appendChild(ctxMenu);
/** Generic popup menu at screen position (null = separator, label with null action = disabled). */
function showMenu(x: number, y: number, items: ([string, (() => void) | null] | null)[]) {
  ctxMenu.className = 'ctx-menu';
  ctxMenu.innerHTML = items.map((it, i) => (it ? `<button data-i="${i}" ${it[1] ? '' : 'disabled'}>${it[0]}</button>` : '<hr>')).join('');
  ctxMenu.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => { ctxMenu.classList.add('hidden'); items[+b.dataset.i!]![1]?.(); }));
  const w = ctxMenu.offsetWidth, h = ctxMenu.offsetHeight;
  ctxMenu.style.left = Math.max(4, Math.min(x, innerWidth - w - 4)) + 'px'; ctxMenu.style.top = Math.max(4, Math.min(y, innerHeight - h - 4)) + 'px';
}
function openContext(x: number, y: number, fid: number | null) {
  const f = state.features.find((g) => g.id === fid);
  const items: ([string, () => void] | null)[] = [];
  if (f) {
    state.sel = [f.id]; state.selModel = false; state.addFeat = f.id; renderAll();
    items.push([`ⓘ ${tt('Properties')}`, () => { setPaneOpen('dialog', true); togglePanel('dialog', true); setTimeout(() => $<HTMLInputElement>('#d-name')?.focus(), 30); }]);
    items.push([`🎨 ${tt('Color …')}`, () => { setPaneOpen('dialog', true); togglePanel('dialog', true); setTimeout(() => $<HTMLInputElement>('#d-color')?.click(), 30); }]);
    items.push([`⌖ ${tt('Center')}`, () => centerOn(fid)]);
    for (const it of analyzeItems(f)) items.push(it as [string, () => void]);
    if (!f.cons && REEX_TYPES.includes(f.type)) items.push([`🔁 ${tt('Re-extract …')}`, () => { setPaneOpen('dialog', true); togglePanel('dialog', true); renderDialog(); setTimeout(() => { const el = document.querySelector<HTMLDetailsElement>('details.reex'); if (el) { el.open = true; el.scrollIntoView({ block: 'nearest' }); } }, 50); }]);
    items.push(null);
    items.push([state.hidden.has(f.id) ? `👁 ${tt('Show geometry')}` : `👁 ${tt('Hide geometry')}`, () => { state.hidden.has(f.id) ? state.hidden.delete(f.id) : state.hidden.add(f.id); renderAll(); }]);
    items.push([state.hiddenLabels.has(f.id) ? `🏷 ${tt('Show annotation')}` : `🏷 ${tt('Hide annotation')}`, () => { state.hiddenLabels.has(f.id) ? state.hiddenLabels.delete(f.id) : state.hiddenLabels.add(f.id); renderAll(); }]);
    if (datumKind(f.type)) {
      items.push(null);
      items.push([f.datum ? tt('Rename datum {0} …', f.datum) : tt('Assign datum …'), () => { togglePanel('dialog', true); setTimeout(() => ($('#dt-letter') as HTMLSelectElement)?.focus(), 50); }]);
      if (!f.datum) items.push([tt('Set as datum {0}', nextFreeLetter()), () => setDatum(f, nextFreeLetter())]);
      else items.push([tt('Remove datum {0}', f.datum), () => setDatum(f, null)]);
    }
    items.push(null);
    items.push([tt('Controls (catalog)'), () => { state.ctab = 'katalog'; setPaneOpen('table', true); togglePanel('table', true); renderTable(); }]);
    items.push([`✕ ${tt('Delete')}`, () => { state.selControl = null; deleteSelected(); }]);
  } else {
    selectModel();
    items.push([`ⓘ ${tt('Properties')}`, () => { setPaneOpen('dialog', true); togglePanel('dialog', true); }]);
    items.push([`⌖ ${tt('Center')}`, () => centerOn(null)]);
    items.push([`◐ ${tt('Deviation to original')}`, () => analyze('mesh')]);
  }
  ctxMenu.className = 'ctx-menu';
  ctxMenu.innerHTML = items.map((it, i) => (it ? `<button data-i="${i}">${it[0]}</button>` : '<hr>')).join('');
  ctxMenu.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => { ctxMenu.classList.add('hidden'); items[+b.dataset.i!]![1](); }));
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
      curves: state.curves, nextCurve: state.nextCurve, showLayout: state.showLayout,
      csys: state.csys, activeCs: state.activeCs, nextCs: state.nextCs, showCs: state.showCs,
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
  if (!state.data) { toast('No project to save.'); return; }
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
    state.csys = st.csys ?? []; state.activeCs = st.activeCs ?? null; state.nextCs = st.nextCs ?? state.csys.length + 1; state.showCs = st.showCs ?? true; state.csSel = null; state.csEdit = null;
    curvesReset(); state.curves = st.curves ?? []; state.nextCurve = st.nextCurve ?? state.curves.length + 1; state.showLayout = !!st.showLayout;
    if (state.curves.length) updateLayout();
    state.sel = []; state.mode = null; state.preview = null; state.openReport = null; ptsCache.clear();
    $('#projname').textContent = r.name; $('#stats').textContent = `${r.vertexCount.toLocaleString('en-US')} points · ${r.triCount.toLocaleString('en-US')} triangles`;
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
    toast(tt('✔ Project {0} loaded ({1} features, {2} controls)', name, state.features.length, state.controls.length));
  } catch (e: any) { toast(tt('Project could not be loaded: {0}', e.message)); }
}
async function storeMeshForAutosave(name: string) {
  if (!viewer.model) return;
  meshKey = name + ':' + Date.now();
  try { const m = meshArrays(); await idbSet('mesh', { key: meshKey, name, positions: m.positions, indices: m.indices }); } catch (e) { console.warn('Autosave (mesh) not possible', e); }
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
    } catch (e) { console.warn('Autosave failed', e); }
  }, 1500);
}
async function restoreLast() {
  const p = await idbGet('project'), m = await idbGet('mesh');
  if (!p || !m || p.meshKey !== m.key) { toast('No saved project found.'); return; }
  await applyProject(p.json, { positions: m.positions, indices: m.indices }, { offsets: p.idxOffsets, data: p.idxData });
  $('#restore-bar').classList.add('hidden');
  toast(`✔ Letztes Projekt wiederhergestellt (${p.features} Merkmale)`);
}
(async () => {
  try {
    const p = await idbGet('project');
    if (!p && !state.data && !new URLSearchParams(location.search).has('nodemo')) {
      // first start / no saved project: load the default demo model (formdemo)
      try { samples ??= await (await fetch('./samples/index.json')).json(); const d = samples!.find((s) => s.default); if (d && !state.data) await loadSample(d); } catch { /* offline */ }
    }
    if (p && !state.data) {
      const bar = $('#restore-bar');
      bar.innerHTML = `<span>${tt('Last project from {0} ({1}, {2} features)', new Date(p.savedAt).toLocaleString(), p.json.mesh.name, p.features)}</span>
        <button class="btn primary" id="rb-restore">${tt('Restore last project')}</button><button class="btn" id="rb-discard">${tt('Discard')}</button>`;
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
function showDocs(sec?: string) {
  const el = $('#help-view'); el.classList.remove('hidden');
  el.innerHTML = `<div class="rv-head"><b>📖 ${tt('Documentation')}</b><span style="flex:1"></span><button class="btn" id="hv-close" title="${tt('Close')}">✕</button></div><div class="rv-body docs">${docsHtml()}</div>`;
  ($('#hv-close') as HTMLButtonElement).onclick = () => el.classList.add('hidden');
  el.querySelectorAll<HTMLAnchorElement>('[data-doc]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); el.querySelector('#doc-' + a.dataset.doc)?.scrollIntoView({ behavior: 'smooth' }); }));
  if (sec) setTimeout(() => el.querySelector('#doc-' + sec)?.scrollIntoView(), 50);
}
document.querySelectorAll<HTMLButtonElement>('#btn-docs, #btn-docs2').forEach((b) => (b.onclick = () => showDocs()));
$('#btn-help').onclick = () => {
  const el = $('#help-view'); el.classList.remove('hidden');
  el.innerHTML = `<div class="rv-head"><b>${tt('Help: datums and tolerances with datum')}</b><span style="flex:1"></span><button class="btn" id="hv-train">🎓 ${tt('Start training')}</button><button class="btn" id="hv-close">✕</button></div>
  <div class="rv-body">${HELP_HTML}</div>`;
  ($('#hv-close') as HTMLButtonElement).onclick = () => el.classList.add('hidden');
  ($('#hv-train') as HTMLButtonElement).onclick = () => { el.classList.add('hidden'); startTraining(); };
};
const HELP_HTML = `<h3>Navigation (mouse)</h3><ul><li>Drag with the <b>left button</b>: rotate · <b>middle button</b> (wheel pressed) or right button: pan · <b>mouse wheel</b>: zoom.</li>
<li>Brush tools and Click &amp; grow: the <b>mouse wheel changes the brush radius / analysis area</b> (shown live), <b>Ctrl+wheel</b> zooms.</li>
<li>Circle/slot/line by click with auxiliary plane: hover preview – <b style="color:#2f7de1">blue</b> auxiliary plane, <b style="color:#ff8c1a">orange</b> wall points.</li><li>Touch: one finger rotates, two fingers zoom/pan.</li>
<li>Every tool shows its controls and ↶ ↷ ✕ ✓ in the Action Bar (bottom of the 3D view). The Dialog shows the object selected in the tree or 3D view.</li></ul>
<h3>Assign a datum (ISO 5459)</h3><ol><li>Select a feature (plane, cylinder/hole, circle, cone, slot, torus, sphere, line).</li>
<li>Dialog › <b>Datum</b>: choose a letter › <b>Assign datum</b> – or right-click/long-press in the tree › “Set as datum …”.</li>
<li>Rename: choose another letter; if it is taken, the letters are <b>swapped</b>. Controls refer to the feature and follow.</li>
<li>Remove: controls using the datum are kept and flagged with ⚠ “datum removed” until a datum is assigned again.</li></ol>
<h3>Datum system A|B|C</h3><ul><li><b>Primary A</b> fixes the orientation: plane → Z = normal out of the material, origin on A; axis → Z = axis.</li>
<li><b>Secondary B</b>: plane → direction in A (perpendicular to B) and origin on B; axis/circle → origin on the axis of B.</li>
<li><b>Tertiary C</b> fixes the remaining rotation or the last origin coordinate. X/Y are named so that X is closest to the world X direction.</li></ul>
<h3>Tolerances</h3><ul><li>Form and orientation/location controls use a single tolerance zone <b>0 … t</b>; sizes (diameter, radius, distance, length …) use nominal + upper/lower deviation.</li>
<li><b>∥ Parallelism / ⟂ Perpendicularity / ∠ Angularity</b>: planes – distance of two planes in the nominal direction containing all points; axes – length × sin(angle error).</li>
<li><b>⌖ Position</b>: theoretically exact dimensions [X][Y][Z] in the datum system, entered by hand. Axes: cylindrical zone Ø = 2 × largest distance of the derived median line from the nominal axis (axis end points if no points); TED fields start empty and are required (“Nominal missing” until filled); sphere/torus/point: SØ; plane: 2 × largest point distance to the nominal plane.</li>
<li><b>◎ Coaxiality / concentricity</b>: Ø = 2 × distance of the axis (end points) or the center to the datum axis.</li>
<li><b>⌯ Symmetry</b>: 2 × distance of the median plane/center from the datum (slot: in width direction).</li>
<li><b>↗ Circular run-out</b>: radial distances of the points to the datum axis in measuring circles (sections); largest span. <b>⌰ Total run-out</b>: span over the whole surface.</li>
<li><b>⌓ Surface profile with datum</b>: conservative estimate 2 × (max. form deviation + location deviation of the center).</li></ul>
<p class="note">All values are computed from the measured (actual) geometries; without CAD there is no nominal model – nominal values are typed in.</p>`;

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
    title: tt('Assign datum {0}', letter), text: tt('{0} is selected. In the Dialog under <b>Datum</b> choose the letter <b>{1}</b> and tap <b>Assign datum</b>.', what, letter),
    target: () => document.querySelector('#dt-box'),
    enter: () => { const f = findF(pred); if (f) { state.sel = [f.id]; state.mode = null; renderAll(); } if (isPhone()) togglePanel('dialog', true); setTimeout(() => { const s = document.querySelector<HTMLSelectElement>('#dt-letter'); if (s && !findF(pred)?.datum) s.value = letter; }, 50); },
    check: () => findF(pred)?.datum === letter,
  };
}
function planeSteps(name: string, p: Vec3, dir: [number, number, number] | null, pred: (f: FeatureView) => boolean, nPred: (m: FitResult) => boolean, n: Vec3 = [0, 0, 1]): TourStep[] {
  return [
    { auto: () => ensurePreview('Ebene', p, n, pred), title: tt('Tap the {0}', name), text: tt('Mode <b>Plane</b> is active. Tap the marked spot (yellow ring) – the <b>{0}</b> of the part. An orange preview appears.', name),
      world: () => worldToScreen(p),
      enter: () => { if (isPhone()) togglePanel('dialog', false); tab('merkmale')(); if (state.mode?.kind !== 'fit' || state.mode.type !== 'Ebene') startFitMode('Ebene'); dir ? viewer.viewDir(dir) : viewer.view('iso'); },
      check: () => !!findF(pred) || pv(nPred)() },
    { auto: () => ensureFeature('Ebene', p, n, pred), title: tt('Create'), text: tt('Check the values (points, RMS, flatness) in the Action Bar and tap <b>✓</b>.'), target: () => document.querySelector('#cp-ok'), check: () => !!findF(pred) },
  ];
}
function startTraining() {
  if (tour) return;
  let lc0 = loadCount;
  const steps: TourStep[] = [
    { title: tt('Training: datums & position'), text: tt('In this guided exercise you set up the datum system <b>A|B|C</b> on the sample part (top, front, left side) and check the <b>position</b> of the Ø12 hole relative to A|B|C.<br>Every step is checked automatically. Press <b>Next</b> to start.') },
    { title: tt('Load sample part'), text: tt('In the <b>Home</b> ribbon tap <b>Load sample</b> – the training loads the standard sample part directly. (A running project is replaced – save it first if needed.)'),
      auto: ensureSample, target: () => document.querySelector('#btn-sample'), enter: () => { lc0 = loadCount; tab('start')(); if (isPhone()) document.body.classList.remove('show-tree', 'show-dialog', 'show-table'); },
      check: () => (loadCount > lc0 || state.features.length > 0) && !!state.data?.name.startsWith('beispielteil') },
    { auto: async () => tab('merkmale')(), title: tt('Start ribbon'), text: tt('Open the <b>Start</b> ribbon at the top (features, coordinate systems, mesh editing).'), target: () => document.querySelector('.tab[data-tab="merkmale"]'), check: () => !!document.querySelector('.tab.active[data-tab="merkmale"]') },
    { auto: async () => { await ensureSample(); tab('merkmale')(); startFitMode('Ebene'); }, title: tt('Feature type Plane'), text: tt('Choose <b>Plane</b>. Only a plane will be fitted.'), target: () => document.querySelector('[data-ftype="Ebene"]'), check: () => (state.mode?.kind === 'fit' && state.mode.type === 'Ebene') || !!findF(isTop) },
    ...planeSteps(tt('top face'), [70, 50, 20], null, isTop, (m) => m.type === 'Ebene' && m.normal[2] > 0.99),
    datumSteps('A', isTop, tt('The top face (primary datum: defines the orientation)')),
    ...planeSteps(tt('front face'), [50, 0, 10], null, isFront, (m) => m.type === 'Ebene' && Math.abs(m.normal[1]) > 0.99, [0, -1, 0]),
    datumSteps('B', isFront, tt('The front face (secondary datum: direction in A and origin in Y)')),
    ...planeSteps(tt('left face'), [0, 30, 10], [-1, -1.2, 0.9], isLeft, (m) => m.type === 'Ebene' && Math.abs(m.normal[0]) > 0.99, [-1, 0, 0]),
    datumSteps('C', isLeft, tt('The left face (tertiary datum: origin in X)')),
    { auto: async () => { await ensureSample(); tab('merkmale')(); startFitMode('Zylinder'); }, title: tt('Feature type Cylinder'), text: tt('In the Start ribbon choose the type <b>Cylinder</b>.'), target: () => document.querySelector('[data-ftype="Zylinder"]'),
      enter: () => { if (isPhone()) togglePanel('dialog', false); tab('merkmale')(); viewer.view('iso'); }, check: () => (state.mode?.kind === 'fit' && state.mode.type === 'Zylinder') || !!findF(isHole) },
    { auto: () => ensurePreview('Zylinder', TRAIN_FEATS.H[1], TRAIN_FEATS.H[2], isHole), title: tt('Tap the Ø12 hole'), text: tt('Tap the <b>wall of the hole</b> (yellow ring).'), world: () => worldToScreen([20, 26.04, 15]), enter: () => viewer.view('iso'),
      check: () => !!findF(isHole) || pv((m) => m.type === 'Zylinder' && Math.abs(m.diameter! - 12.08) < 0.3)() },
    { auto: () => ensureFeature('Zylinder', TRAIN_FEATS.H[1], TRAIN_FEATS.H[2], isHole), title: tt('Create'), text: tt('Tap <b>✓</b> in the Action Bar.'), target: () => document.querySelector('#cp-ok'), check: () => !!findF(isHole) },
    { auto: async () => { await ensureFeature('Zylinder', TRAIN_FEATS.H[1], TRAIN_FEATS.H[2], isHole); const f = findF(isHole)!; f.fp ??= defaultFp(); if (!f.fp.nf.on) { f.fp.nf.on = true; await refitFeature(f); } },
      title: tt('Normal direction filter'), text: tt('The selection often contains points of <b>edges and chamfers</b>. Their surface normal does not match the hole wall. The <b>normal direction filter</b> discards points whose normal deviates by more than the set <b>angle</b> – worst first, but at most the set <b>percentage</b>.<br>In the Dialog under <b>⚙ Fit parameters</b> tick <b>Normal direction filter</b>. The feature is refitted immediately; you can change angle and % afterwards.'),
      target: () => document.querySelector('#fp-nf')?.closest('.row') ?? null,
      enter: () => { const f = findF(isHole); if (f) { state.sel = [f.id]; state.mode = null; renderAll(); } if (isPhone()) togglePanel('dialog', true); },
      check: () => !!findF(isHole)?.fp?.nf.on },
    { auto: ensurePosition, title: tt('Position tolerance ⌖ A|B|C'), text: tt('In <b>Control Properties</b> under “With datum” tick <b>⌖ Position</b>. The datums A|B|C are filled in automatically.'),
      target: () => document.querySelector('#catalog .cat-item[data-kind="Position"]'),
      enter: () => { const f = findF(isHole); if (f) { state.sel = [f.id]; state.addFeat = f.id; state.ctab = 'katalog'; state.mode = null; renderAll(); } if (isPhone()) togglePanel('table', true); },
      check: () => { const f = findF(isHole); const fm = featMap(); return !!f && state.controls.some((c) => c.kind === 'Position' && c.featureIds[0] === f.id && datumText(c, fm) === 'A|B|C'); } },
    { auto: async () => { await ensurePosition(); const f = findF(isHole)!; const c = state.controls.find((k) => k.kind === 'Position' && k.featureIds[0] === f.id)!; c.basic = [20, 20, c.basic?.[2] ?? 0]; renderAll(); }, title: tt('Basic dimensions [X] [Y] and tolerance'), text: tt('Enter the theoretically exact dimensions <b>[X] = 20</b> and <b>[Y] = 20</b> (pre-filled, please check) and keep the tolerance <b>Ø 0.1</b>. Result: OK/NOK and an entry in the annotation.'),
      target: () => document.querySelector('#catalog .cat-item[data-kind="Position"] .cat-ed'),
      check: () => { const f = findF(isHole); const c = state.controls.find((k) => k.kind === 'Position' && k.featureIds[0] === f?.id); return !!c && Math.abs((c.basic?.[0] ?? 0) - 20) < 1e-6 && Math.abs((c.basic?.[1] ?? 0) - 20) < 1e-6; } },
    { title: tt('Done! 🎉'), text: tt('The hole is now toleranced with <b>⌖ Ø0.1 | A | B | C</b>. The datum flags appear in the tree and in the annotations. Datums can be renamed (letters swapped) or removed in the Dialog – dependent controls are then flagged.'),
      enter: () => { if (isPhone()) togglePanel('table', false); viewer.view('iso'); } },
  ];
  tour = new Tour(tt('Training: datums'), steps, () => { tour = null; (window as any).__app.tour = null; });
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
Object.assign((window as any).__app, { ensureFeature, addControl, TRAIN_FEATS, hitAt, previewByClick, startFitMode, commitPreview, nurbsAccuracy, renderAll, togglePanel, evaluate, ctx: () => ctx, startTraining, centerOn, setDatum, saveProject, openProjectFile, restoreLast, projectJSON, analyzeControl, evaluateControl: (id: number) => { const c = state.controls.find((x) => x.id === id); return c ? evaluate(c, featMap(), ctx) : null; } });
viewer.controls.addEventListener('end', () => scheduleAutosave());


// ------------------------------------------------------------------ Polygonbearbeitung

const TOL_MIN = 0.001, TOL_MAX = 1;
const tolToRange = (t: number) => Math.round(1000 * Math.log10(Math.max(TOL_MIN, Math.min(TOL_MAX, t)) / TOL_MIN) / 3);
const rangeToTol = (r: number) => +(TOL_MIN * 10 ** (3 * r / 1000)).toPrecision(2);

function peReset() { pe.undo = []; pe.edits = []; pe.dev = null; pe.devStats = null; pe.cmp = false; pe.origTris = 0; pe.live = ''; }
function curMesh() { const m = meshArrays(); return { positions: m.positions.slice(), indices: m.indices.slice() }; }

document.querySelectorAll<HTMLButtonElement>('[data-pe]').forEach((b) => (b.onclick = () => {
  if (!state.data) { toast('Please load a polygon model first.'); return; }
  if (!state.data.triCount) { toast('Mesh editing needs a triangle mesh (not a point cloud).'); return; }
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
function peExit() { if (pe.running) polyEngine.cancel(); pe.tool = null; peClearSel(); curveDraft = []; viewer.showCursor(null, 1); if (isPhone()) togglePanel('dialog', false); renderAll(); }

function renderPolyRibbon() {
  document.querySelectorAll<HTMLButtonElement>('[data-pe]').forEach((b) => b.classList.toggle('on', pe.tool === b.dataset.pe));
  $('#btn-curve-draw').classList.toggle('on', pe.tool === 'curve'); $('#btn-curve-layout').classList.toggle('on', state.showLayout);
  $('#btn-pe-cmp').classList.toggle('on', pe.cmp);
  ($('#btn-pe-undo') as HTMLButtonElement).disabled = !pe.undo.length;
  ($('#btn-pe-reset') as HTMLButtonElement).disabled = !pe.undo.length;
  const i = $('#pe-info'); if (i) i.textContent = pe.edits.length ? `${pe.edits.length} ${tt('edit(s)')} · ${state.data?.triCount.toLocaleString('en-US')} ${tt('triangles')}` : tt('Original');
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
  const run = pe.running ? `<button class="btn" id="pe-cancel">✕ ${tt('Abort')}</button>` : `<button class="btn primary" id="pe-run">▶ ${tt('Apply')}</button>`;
  let body = '';
  if (t === 'reduce') body = `<p class="note">${tt('Quadric edge collapse, curvature adaptive: removes triangles as long as the reduced mesh deviates at most by the tolerance from the original (both ways) and normals barely tilt – like the chord height when polygonising a circle. Flat areas are reduced strongly, radii and edges hardly.')}</p>
    ${tolRow('pe-tol', tt('Max. deviation'), pe.tol)}
    <div class="row"><label title="${tt('Curvature adaptive: new triangles may deviate at most this much from the original normals')}">${tt('Max. normal dev.')}</label><input type="number" id="pe-nd" value="${pe.normalDeg}" min="1" max="45" step="1"><span class="unit">°</span></div>
    <div class="row"><label title="${tt('Edges with a larger dihedral angle are kept as edges (corners fixed)')}">${tt('Edge angle')}</label><input type="number" id="pe-fd" value="${pe.featureDeg}" min="5" max="90" step="1"><span class="unit">°</span></div>
    <div class="row"><label title="${tt('Limits the triangle size (0 = none)')}">${tt('Max. edge length')}</label><input type="number" id="pe-me" value="${pe.maxEdge}" min="0" step="0.5"><span class="unit">mm</span></div>
    <div class="row"><label title="${tt('No triangles sharper than this angle (0 = none; useful up to ~15°)')}">${tt('Min. angle')}</label><input type="number" id="pe-ma" value="${pe.minAngle}" min="0" max="30" step="1"><span class="unit">°</span></div>
    <div class="row">${run}</div>`;
  else if (t === 'subdiv') body = `<p class="note">${tt('Splits every triangle into four (Loop). New points are smoothed but moved at most by the tolerance from the original surface.')}</p>
    ${tolRow('pe-tol', tt('Max. deviation'), pe.tol)}
    <div class="row"><label>${tt('Levels')}</label><select id="pe-lv">${[1, 2].map((x) => `<option ${x === pe.levels ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
    <div class="row"><label title="${tt('Limits the triangle size (0 = none)')}">${tt('Max. edge length')}</label><input type="number" id="pe-me" value="${pe.maxEdge}" min="0" step="0.5"><span class="unit">mm</span></div>
    <div class="row"><span class="note">${tt('Result')}: ≈ ${(tris * 4 ** pe.levels).toLocaleString('en-US')} ${tt('triangles')}${tris * 4 ** pe.levels > 3e6 ? tt(' – over 3 M, will be limited') : ''}</span></div><div class="row">${run}</div>`;
  else if (t === 'smooth') body = `<p class="note">${tt('Taubin smoothing (does not shrink). Noise is reduced; every point moves at most by the tolerance (0 = unlimited). Boundaries stay fixed.')}</p>
    <div class="row"><label>${tt('Strength λ')}</label><input type="number" id="pe-lam" value="${pe.lambda}" min="0.05" max="0.9" step="0.05"></div>
    <div class="row"><label>${tt('Iterations')}</label><input type="number" id="pe-it" value="${pe.iters}" min="1" max="100" step="1"></div>
    ${tolRow('pe-stol', tt('Max. displacement'), pe.smoothTol)}<div class="row">${run}</div>`;
  else body = `<p class="note">${tt('Mark a defect (scatter, weld spatter, dent) with the brush (Shift = erase), then <b>Remove &amp; fill</b>. The clean surface is fitted from the surrounding ring (plane, cylinder, sphere; two faces with a sharp edge or fillet; otherwise a quadric), the hole is triangulated with the same density and placed on that surface.')}</p>
    <div class="row"><b>${peCount}</b>&nbsp;${tt('points marked')}</div>
    <div class="row"><button class="btn primary" id="pe-go" ${peCount ? '' : 'disabled'}>✔ ${tt('Remove &amp; fill')}</button><button class="btn" id="pe-clear" ${peCount ? '' : 'disabled'}>${tt('Clear selection')}</button></div>
    <div class="row"><label>${tt('Brush radius')}</label><input type="number" id="pe-rad-n" value="${pe.radius}" min="0.1" step="0.1" inputmode="decimal"><span class="unit">mm</span></div>
    <div class="row pe-tol"><input type="range" id="pe-rad-r" min="0.2" max="${Math.max(1, +((state.data?.diag ?? 100) / 8).toFixed(1))}" step="0.1" value="${pe.radius}" aria-label="Brush radius"></div>`;
  d.innerHTML = `<h3>${PE_NAME[t]}</h3>${body}
    <div class="pe-live" id="pe-live">${pe.live || `${tt('Current')}: <b>${tris.toLocaleString('en-US')}</b> ${tt('triangles')}`}</div>
    <h4>${tt('Comparison')}</h4>
    <div class="row"><button class="btn ${pe.cmp ? 'on' : ''}" id="pe-cmp">◐ ${pe.cmp ? tt('Color comparison to original: on') : tt('Color comparison to original: off')}</button></div>
    ${pe.cmp && pe.devStats ? `<div class="row"><span class="note">${tt('Deviation to original')}: +${pe.devStats.maxPos.toFixed(4)} / ${pe.devStats.maxNeg.toFixed(4)} mm</span></div>
      <div class="row"><label>${tt('Color scale ±')}</label><input type="number" id="pe-scale" value="${pe.scale || ''}" placeholder="auto ${peScale().toFixed(3)}" min="0" step="0.001" inputmode="decimal"><span class="unit">mm</span></div>` : ''}
    <div class="row"><button class="btn" id="pe-undo" ${pe.undo.length ? '' : 'disabled'}>↶ ${tt('Undo')}</button><button class="btn" id="pe-reset" ${pe.undo.length ? '' : 'disabled'}>⟲ ${tt('Original')}</button><button class="btn" id="pe-exit">${tt('Close')}</button></div>
    ${pe.edits.length ? `<p class="note">${tt('History')}: ${pe.edits.join(' → ')}</p>` : ''}
    <p class="note">${tt('Features are kept; their points are transferred to the edited mesh. Refit actual values in the properties if needed.')}</p>`;
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
  d.querySelector<HTMLInputElement>('#pe-me')?.addEventListener('change', (e) => { const v = +(e.target as HTMLInputElement).value; if (v >= 0) pe.maxEdge = v; });
  d.querySelector<HTMLInputElement>('#pe-ma')?.addEventListener('change', (e) => { const v = +(e.target as HTMLInputElement).value; if (v >= 0) pe.minAngle = v; });
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
  const req: any = t === 'reduce' ? { op: 'decimate', tol: pe.tol, normalDeg: pe.normalDeg, featureDeg: pe.featureDeg, maxEdge: pe.maxEdge || undefined, minAngle: pe.minAngle || undefined } : t === 'subdiv' ? { op: 'subdivide', tol: pe.tol, levels: pe.levels, maxEdge: pe.maxEdge || undefined }
    : { op: 'smooth', iterations: pe.iters, lambda: pe.lambda, tol: pe.smoothTol };
  req.mesh = curMesh();
  pe.running = true; setLive(`${tt('Running …')} <b>${before.toLocaleString('en-US')}</b> ${tt('triangles')}`); renderDialog(); status(tt('{0} running …', PE_NAME[t]));
  try {
    progressBegin(PE_NAME[t]);
    const r = await polyEngine.run<any>(req, (p: any) => { progressUpdate(p.info ?? {}); setLive(t === 'smooth' ? `Iteration ${p.done} / ${pe.iters}` :
      `${tt('Running …')} <b>${p.tris.toLocaleString('en-US')}</b> ${tt('triangles')} (${(100 * p.tris / before).toFixed(1)} %)`); }).finally(progressEnd);
    pe.running = false;
    const label = t === 'reduce' ? `${tt('Reduction')} ${pe.tol} mm` : t === 'subdiv' ? `${tt('Subdivision')} ×${pe.levels} (${pe.tol} mm)` : `${tt('Smoothing')} ${pe.iters}×λ${pe.lambda}${pe.smoothTol ? ` ≤${pe.smoothTol} mm` : ''}`;
    await applyEditedMesh(r.positions, r.indices, label);
    const after = state.data!.triCount;
    setLive(`${before.toLocaleString('de-DE')} → <b>${after.toLocaleString('de-DE')}</b> Dreiecke (${(100 * after / before).toFixed(1)} %) in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    toast(`✔ ${label}: ${before.toLocaleString('de-DE')} → ${after.toLocaleString('de-DE')} Dreiecke`);
  } catch (e: any) {
    pe.running = false;
    setLive(e.message === 'abgebrochen' ? tt('Aborted – mesh unchanged.') : tt('Error: {0}', e.message));
    status(e.message === 'abgebrochen' ? tt('{0} aborted.', PE_NAME[t]) : tt('Error: {0}', e.message));
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
    renderScene(); renderModeBar(); setLive(tt('Selected: <b>{0}</b> points – “Remove &amp; fill”', peCount));
  } finally { pePaintBusy = false; }
}
function peClearSel() { peMask = null; peCount = 0; peStroke.length = 0; }
function peUndoStroke() {
  const st = peStroke.pop(); if (!st || !peMask) return;
  for (let i = st.length - 1; i >= 0; i--) { const v = Math.abs(st[i]) - 1, was = st[i] > 0 ? 0 : 1; if (peMask[v] !== was) { peMask[v] = was; peCount += was ? 1 : -1; } }
  renderScene(); renderModeBar();
}
async function peErase() {
  if (pe.running || !state.data || !peMask || !peCount) { toast('Mark the defect with the brush first.'); return; }
  const sel = new Uint32Array(peCount); let k = 0; peMask.forEach((v, i) => { if (v) sel[k++] = i; });
  pe.running = true; setLive(tt('Removing selection, fitting surroundings, filling hole …'));
  try {
    const r = await busy(polyEngine.run<any>({ op: 'erase', mesh: curMesh(), sel }));
    pe.running = false;
    if (!r.loops) { setLive(r.skipped ? tt('Selection touches an open boundary – not filled.') : tt('Nothing removed.')); return; }
    peClearSel();
    await applyEditedMesh(r.positions, r.indices, `Radierer (${r.surfaces.join(', ')})`);
    setLive(tt('Hole closed: {0} triangles removed, {1} new points · replacement surface: <b>{2}</b>', r.removed, r.added, r.surfaces.map((x: string) => typeName(x)).join(', ')) + (r.skipped ? tt(' · {0} open boundaries skipped', r.skipped) : ''));
  } catch (e: any) { pe.running = false; setLive(tt('Error: {0}', e.message)); }
  renderDialog(); renderModeBar();
}

/** Neues Netz übernehmen: Rückgängig-Stapel, Worker-Netz + Merkmalspunkte umrechnen, Anzeige ohne Kamerasprung, ggf. Farbvergleich neu. */
async function applyEditedMesh(positions: Float32Array, indices: Uint32Array, label: string | null, pushUndo = true) {
  if (pushUndo) { pe.undo.push({ ...curMesh(), label: label ?? '' }); if (pe.undo.length > 8) pe.undo.shift(); }
  if (!pe.origTris) pe.origTris = state.data!.triCount;
  const lists: (Uint32Array | null)[] = [];
  for (const f of state.features) lists.push(f.indices ?? null, f.auxIndices ?? null, f.src ?? null);
  const r = await busy(engine.call<any>({ op: 'setMesh', positions: positions.slice(), indices: indices.slice(), remap: lists,
    chains: state.curves.map((c) => c.chain), kinds: state.curves.map((c) => c.kind) }));
  if (r.curves) { state.curves.forEach((c, i) => Object.assign(c, r.curves[i], { kind: c.kind })); }
  state.features.forEach((f, i) => {
    const [a, b, c] = [r.remap[3 * i], r.remap[3 * i + 1], r.remap[3 * i + 2]];
    if (a) f.indices = a; f.auxIndices = b ?? undefined; f.src = c ?? undefined;
    if (f.dev && f.dev.length !== f.indices.length) f.dev = undefined;
  });
  ptsCache.clear();
  viewer.setModel(positions, indices, r.normals, true);
  if (label) pe.edits.push(label); else pe.edits.pop();
  state.data!.vertexCount = r.vertexCount; state.data!.triCount = r.triCount;
  $('#stats').textContent = `${r.vertexCount.toLocaleString('en-US')} points · ${r.triCount.toLocaleString('en-US')} triangles`;
  state.preview = null; clearBrush();
  pe.dev = null; pe.devStats = null;
  if (pe.cmp) await peCompute();
  if (state.curves.length) await updateLayout();
  storeMeshForAutosave(state.data!.name);
  renderAll();
}
async function peCompute() {
  const c = await busy(engine.call<any>({ op: 'compare' }));
  pe.dev = c.dev; pe.devStats = { maxPos: c.maxPos, maxNeg: c.maxNeg };
}
async function peToggleCompare() {
  if (!state.data) return;
  pe.cmp = !pe.cmp; if (pe.cmp) state.showLayout = false;
  if (pe.cmp && !pe.dev) await peCompute();
  renderAll();
  if (pe.cmp && pe.devStats) status(tt('Color comparison to original: max. +{0} / {1} mm', pe.devStats.maxPos.toFixed(4), pe.devStats.maxNeg.toFixed(4)));
}
async function peUndo() {
  const u = pe.undo.pop(); if (!u) { toast('Nothing to undo.'); return; }
  await applyEditedMesh(u.positions, u.indices, null, false); toast(tt('Edit undone.'));
}
async function peResetOriginal() {
  if (!pe.undo.length) return;
  const o = await busy(engine.call<any>({ op: 'getOriginal' }));
  pe.undo = []; await applyEditedMesh(o.positions, o.indices, null, false); pe.edits = []; pe.origTris = 0; renderAll();
  toast(tt('Original polygon model restored.'));
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
  el.innerHTML = `<b>${tt('Deviation to original [mm]')}</b><div class="bar"></div><div class="ticks"><span>${sgn(-r, 3)}</span><span>0</span><span>${sgn(r, 3)}</span></div>`;
  return true;
}


// ------------------------------------------------------------------ Kurvennetz (Modeler-artig)
const CURVE_COLOR: Record<CurveView['kind'], number> = { Kante: 0xd81b60, Tangente: 0x1e88e5, Übergang: 0x8e24aa, Benutzer: 0x2e7d32, Vorschlag: 0xff6f00 };
const CURVE_NAME: Record<CurveView['kind'], string> = { Kante: 'Edge', Tangente: 'Tangent', Übergang: 'Transition', Benutzer: 'Curve', Vorschlag: 'Seam' };
/** Erkennungs-/Aufräumoptionen (Dialog „Optionen"). */
const curveOpts = { sharpDeg: 30, flatKappa: 0.055, binRatio: 1.6, minLen: 0, gap: 0, dangling: 0, mergeDeg: 30, turnDeg: 55, autoCorners: true };
const CURVE_OPT_DEF: [keyof typeof curveOpts, string, number, number, number, string][] = [
  ['sharpDeg', 'Edge angle', 5, 80, 1, '°'], ['flatKappa', 'Curvature “flat” below', 0.005, 0.3, 0.005, '1/mm'], ['binRatio', 'Radius jump (ratio)', 1.1, 4, 0.05, '×'],
  ['minLen', 'Minimum length (0 = auto)', 0, 50, 0.5, 'mm'], ['gap', 'Close gaps up to (0 = auto)', 0, 20, 0.5, 'mm'], ['dangling', 'Trim loose ends up to (0 = auto)', 0, 50, 0.5, 'mm'],
  ['mergeDeg', 'Join aligned pieces up to', 0, 60, 1, '°'], ['turnDeg', 'Corner at direction change from', 20, 120, 1, '°']];
/** Bearbeitung der gewählten Kurve: Undo-Stapel, Unter-Modus, Ziehen. */
const cv = { undo: [] as string[], edit: null as null | 'insert' | 'delpt' | 'split' | 'join', hover: null as number | null, drag: null as null | { id: number; i: number; moved: boolean }, ctrlSel: null as number | null, raf: 0 };
Object.assign((window as any).__app, { cv: () => cv, curveOpts, curveUndo, acceptSuggestions });
function curveSnapshot() { cv.undo.push(JSON.stringify({ curves: state.curves, next: state.nextCurve, sel: state.curveSel })); if (cv.undo.length > 50) cv.undo.shift(); }
async function curveUndo() {
  const s = cv.undo.pop(); if (!s) { toast('Nothing to undo.'); return; }
  const o = JSON.parse(s); state.curves = o.curves; state.nextCurve = o.next; state.curveSel = o.sel; cv.edit = null; cv.ctrlSel = null;
  await updateLayout(); renderAll(); status(tt('Curve edit undone.'));
}
function curveById(id: number | null) { return state.curves.find((c) => c.id === id) ?? null; }
function sampleCtrl(ctrl: number[][], closed: boolean): number[][] {
  const P = closed ? [...ctrl, ctrl[0]] : ctrl; const out: number[][] = [];
  for (let k = 0; k <= 120; k++) out.push(evalBSpline(P as any, k / 120) as any);
  return out;
}
/** Neue Form aus Kontrollpunkten im Worker berechnen (auf Netz einrasten, Kantenkette neu bestimmen). */
async function curveApplyCtrl(c: CurveView, ctrl: number[][]) {
  const r = await engine.call<any>({ op: 'curveFromCtrl', ctrl: ctrl as any, kind: c.kind, closed: c.closed });
  Object.assign(c, r.curve, { kind: c.kind });
}
function curveSelect(id: number | null) { state.curveSel = id; cv.ctrlSel = null; cv.edit = null; if (id != null) { state.sel = []; } renderTree(); renderScene(); renderDialog(); renderModeBar();
  if (id != null) document.querySelector(`[data-cid="${id}"]`)?.scrollIntoView({ block: 'nearest' }); }
/** Klick auf eine Kurve im 3D-Bild: wählen bzw. aktuellen Bearbeitungsschritt ausführen. Rückgabe true = verbraucht. */
async function curveClick(x: number, y: number): Promise<boolean> {
  if (!state.curves.length || pe.tool) return false;
  const h = viewer.pickCurve(x, y); const c = curveById(state.curveSel);
  if (c && cv.edit === 'delpt' && h?.ctrl != null) {
    if (c.ctrl.length <= (c.closed ? 3 : 2)) { toast('Too few control points.'); return true; }
    curveSnapshot(); const ctrl = c.ctrl.filter((_, i) => i !== h.ctrl); await busy(curveApplyCtrl(c, ctrl)); cv.ctrlSel = null; await updateLayout(); renderAll(); return true;
  }
  if (h?.ctrl != null) { cv.ctrlSel = h.ctrl; renderScene(); renderDialog(); return true; }
  if (!h || h.curveId == null) { if (cv.edit) { toast('Please tap on a curve.'); return true; } return false; }
  if (c && cv.edit === 'insert' && h.curveId === c.id) {
    // Position im Kontrollpolygon über den nächstgelegenen Kurvenparameter bestimmen
    const S = sampleCtrl(c.ctrl, c.closed); let bk = 0, bd = Infinity;
    S.forEach((q, k) => { const d = (q[0] - h.point[0]) ** 2 + (q[1] - h.point[1]) ** 2 + (q[2] - h.point[2]) ** 2; if (d < bd) { bd = d; bk = k; } });
    const n = c.ctrl.length + (c.closed ? 1 : 0); const at = Math.min(c.ctrl.length, Math.max(1, Math.round((bk / 120) * (n - 1) + 0.5)));
    curveSnapshot(); const ctrl = [...c.ctrl.slice(0, at), h.point, ...c.ctrl.slice(at)]; await busy(curveApplyCtrl(c, ctrl)); cv.ctrlSel = at; cv.edit = null; await updateLayout(); renderAll(); return true;
  }
  if (c && cv.edit === 'split' && h.curveId === c.id) {
    const r = await busy(engine.call<any>({ op: 'curveSplit', curve: { chain: c.chain, kind: c.kind }, p: h.point as any }));
    if (!r.curves) { toast('Cannot split here (too close to the end).'); return true; }
    curveSnapshot(); const i = state.curves.indexOf(c);
    const b = { id: state.nextCurve, name: `${CURVE_NAME[c.kind]} ${state.nextCurve++}`, visible: true, ...r.curves[1] };
    Object.assign(c, r.curves[0], { kind: c.kind, closed: false }); b.kind = c.kind; state.curves.splice(i + 1, 0, b);
    cv.edit = null; await updateLayout(); toast(`✔ ${c.name} geteilt → ${c.name}, ${b.name}`); renderAll(); return true;
  }
  if (c && cv.edit === 'join' && h.curveId !== c.id) {
    const o = curveById(h.curveId)!; curveSnapshot();
    const r = await busy(engine.call<any>({ op: 'curveJoin', a: { chain: c.chain, kind: c.kind }, b: { chain: o.chain } }));
    Object.assign(c, r.curve, { kind: c.kind }); state.curves = state.curves.filter((x) => x !== o);
    cv.edit = null; await updateLayout(); toast(tt('✔ {0} joined with {1} ({2} mm)', o.name, c.name, c.length.toFixed(1))); renderAll(); return true;
  }
  curveSelect(state.curveSel === h.curveId && !cv.edit ? null : h.curveId); return true;
}
function curveHover(x: number, y: number) {
  if (!state.curves.length || pe.tool || cv.drag) return;
  const h = viewer.pickCurve(x, y); const id = h?.curveId ?? null;
  canvas.style.cursor = h?.ctrl != null ? 'grab' : id != null ? 'pointer' : '';
  if (id !== cv.hover) { cv.hover = id; renderScene(); }
}
/** Kontrollpunkt ziehen: Zeiger auf das Netz projizieren, Kurve lokal neu auswerten; beim Loslassen exakt im Worker. */
function curveDragStart(x: number, y: number): boolean {
  const c = curveById(state.curveSel); if (!c || pe.tool || cv.edit) return false;
  const h = viewer.pickCurve(x, y); if (h?.ctrl == null) return false;
  curveSnapshot(); cv.drag = { id: c.id, i: h.ctrl, moved: false }; cv.ctrlSel = h.ctrl; viewer.controls.enabled = false; return true;
}
function curveDragMove(x: number, y: number) {
  const c = curveById(cv.drag!.id); if (!c) return; const m = viewer.pick(x, y); if (!m) return;
  c.ctrl[cv.drag!.i] = m.point; cv.drag!.moved = true; c.pts = sampleCtrl(c.ctrl, c.closed);
  if (!cv.raf) cv.raf = requestAnimationFrame(() => { cv.raf = 0; renderScene(); });
}
async function curveDragEnd() {
  const d = cv.drag!; cv.drag = null; viewer.controls.enabled = true; const c = curveById(d.id);
  if (!c || !d.moved) { cv.undo.pop(); renderScene(); renderDialog(); return; }
  await busy(curveApplyCtrl(c, c.ctrl)); await updateLayout(); renderAll();
}
/** Naht-/Teilungsvorschläge als Benutzerkurven übernehmen. */
async function acceptSuggestions() {
  const L = state.layout; if (!L?.suggestions?.length) { toast('No suggestions available.'); return; }
  curveSnapshot(); const n0 = L.regions.filter((r) => r.sides === 4 && r.loops === 1).length;
  for (const s of L.suggestions) { const { reason, region, ...c } = s; state.curves.push({ ...c, kind: 'Vorschlag', id: state.nextCurve, name: `Naht ${state.nextCurve++}`, visible: true }); }
  await updateLayout(); toast(tt('✔ {0} suggestions applied – 4-sided: {1} → {2}', L.suggestions.length, n0, state.layout!.foursided)); renderAll();
}
let curveDraft: { v: number; p: number[] }[] = [];
function curvesReset() { cv.undo.length = 0; cv.edit = null; state.curves = []; state.nextCurve = 1; state.curveSel = null; state.layout = null; state.showLayout = false; curveDraft = []; }
function renderCurves() {
  for (const c of state.curves) if (c.visible && showCurves) viewer.addCurve(c.pts, CURVE_COLOR[c.kind], state.curveSel === c.id, c.id, cv.hover === c.id);
  const L = state.layout;
  if (L && state.curves.some((c) => c.visible)) {
    for (const n of L.nodes) viewer.addNode(n.p, n.degree === 3 ? 0xff8f00 : n.degree === 1 ? 0x9e9e9e : 0x212121, n.degree === 3 ? 1.1 : 0.8);
    if (state.showLayout) {
      for (const k of L.corners ?? []) if (k.kind !== 'Knoten') viewer.addNode(k.p, k.kind === 'Knick' ? 0xffffff : 0x00e5ff, 0.75);
      for (const s of L.suggestions ?? []) viewer.addCurve(s.pts, CURVE_COLOR.Vorschlag, false, undefined, false, true);
      const minF = L.regionOf.length / 300; L.regions.forEach((r) => { if (r.center && r.faces > minF) viewer.addLabel(r.center, r.loops > 1 ? `${r.sides}·${r.loops}` : String(r.sides), r.sides === 4 && r.loops === 1 ? '#b9f6ca' : '#ffccbc'); });
    }
  }
  const sc = curveById(state.curveSel);
  if (sc && sc.visible && !pe.tool) sc.ctrl.forEach((p, i) => viewer.addCtrl(p, i, cv.ctrlSel === i));
  for (const d of curveDraft) viewer.addNode(d.p, 0x2e7d32, 1.2);
}
/** Patch-Aufteilung einfärben: 4-seitige Patches grün/türkis, andere warm. */
function paintLayout(): boolean {
  const L = state.layout; if (!state.showLayout || !L || !viewer.model || !viewer.colors) return false;
  const idx = viewer.model.geometry.index!.array as Uint32Array; if (L.regionOf.length !== idx.length / 3) return false;
  const col = L.regions.map((r, i) => { const h = r.sides === 4 ? 0.28 + 0.18 * ((i * 0.618) % 1) : ((i * 0.618) % 1) * 0.16 + (r.sides === 0 ? 0.62 : 0.0); return hsl(h, r.sides === 4 ? 0.55 : 0.6, 0.62); });
  for (let t = 0; t < L.regionOf.length; t++) { const c = col[L.regionOf[t]]; for (let k = 0; k < 3; k++) viewer.colors.set(c, 3 * idx[3 * t + k]); }
  return true;
}
function hsl(h: number, s: number, l: number): number[] { const a = s * Math.min(l, 1 - l); const f = (n: number) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; }
async function updateLayout() {
  if (!state.curves.length) { state.layout = null; return; }
  state.layout = await engine.call<any>({ op: 'curveLayout', chains: state.curves.map((c) => c.chain), opts: { turnDeg: curveOpts.turnDeg, autoCorners: curveOpts.autoCorners } });
}
async function detectCurvesUI() {
  if (!state.data?.triCount) { toast('Please load a polygon model first.'); return; }
  const t0 = performance.now();
  const o: any = { ...curveOpts }; for (const k of ['minLen', 'gap', 'dangling'] as const) if (!o[k]) delete o[k];
  const r = await busy(engine.call<any>({ op: 'curvesDetect', opts: o, layout: { turnDeg: curveOpts.turnDeg, autoCorners: curveOpts.autoCorners } }), 'Kurvenerkennung');
  if (state.curves.length) curveSnapshot();
  state.curves = state.curves.filter((c) => c.kind === 'Benutzer' || c.kind === 'Vorschlag'); state.curveSel = null;
  for (const c of r.curves) state.curves.push({ id: state.nextCurve, name: `${CURVE_NAME[c.kind as CurveView['kind']]} ${state.nextCurve++}`, visible: true, ...c });
  await updateLayout();
  const L = state.layout!;
  toast(tt('✔ {0} curves detected ({1}) · {2} patches, {3} 4-sided, {4} T-junctions · {5} s', r.curves.length, (['Kante', 'Tangente', 'Übergang'] as const).map((k) => `${r.curves.filter((c: any) => c.kind === k).length} ${CURVE_NAME[k].toLowerCase()}`).join(', '), L.regions.length, L.foursided, L.tJunctions, ((performance.now() - t0) / 1000).toFixed(1)));
  renderAll();
}
function curveAddPoint(h: Hit) {
  const idx = viewer.model!.geometry.index!.array as Uint32Array, P = viewer.model!.geometry.getAttribute('position').array as Float32Array;
  let best = idx[3 * h.tri], bd = Infinity;
  for (let k = 0; k < 3; k++) { const v = idx[3 * h.tri + k]; const d = (P[3 * v] - h.point[0]) ** 2 + (P[3 * v + 1] - h.point[1]) ** 2 + (P[3 * v + 2] - h.point[2]) ** 2; if (d < bd) { bd = d; best = v; } }
  // Einrasten auf bestehende Kurvenknoten in der Nähe (T-Stoß)
  const snap = (state.data!.diag / 150) ** 2;
  for (const c of state.curves) for (const v of c.chain) { const d = (P[3 * v] - h.point[0]) ** 2 + (P[3 * v + 1] - h.point[1]) ** 2 + (P[3 * v + 2] - h.point[2]) ** 2; if (d < snap && d < bd) { bd = d; best = v; } }
  curveDraft.push({ v: best, p: [P[3 * best], P[3 * best + 1], P[3 * best + 2]] });
  renderScene(); renderDialog(); renderModeBar();
}
async function curveFinish() {
  if (curveDraft.length < 2) { toast('Place at least two points on the mesh.'); return; }
  try {
    const r = await busy(engine.call<any>({ op: 'curvePath', verts: curveDraft.map((d) => d.v) }));
    curveSnapshot(); state.curves.push({ id: state.nextCurve, name: `${tt('Curve')} ${state.nextCurve++}`, visible: true, ...r.curve });
    curveDraft = []; await updateLayout(); toast(tt('✔ Curve created ({0} mm) – patches: {1}, 4-sided: {2}', r.curve.length.toFixed(1), state.layout!.regions.length, state.layout!.foursided));
  } catch (e: any) { toast(tt('Error: {0}', e.message)); }
  renderAll();
}
async function curveDelete(id = state.curveSel) {
  if (id == null) { toast('Select a curve in the tree first.'); return; }
  curveSnapshot(); state.curves = state.curves.filter((c) => c.id !== id); state.curveSel = null; cv.edit = null;
  await updateLayout(); renderAll();
}
$('#btn-curve-detect').onclick = () => detectCurvesUI();
$('#btn-curve-draw').onclick = () => {
  if (!state.data?.triCount) { toast('Please load a polygon model first.'); return; }
  if (pe.tool === 'curve') { peExit(); return; }
  state.mode = null; state.preview = null; clearBrush(); pe.tool = 'curve'; curveDraft = []; renderAll();
};
$('#btn-curve-del').onclick = () => curveDelete();
$('#btn-curve-accept').onclick = () => acceptSuggestions();
$('#btn-curve-undo').onclick = () => curveUndo();
$('#btn-curve-opts').onclick = () => { if (pe.tool === 'curveopts') { peExit(); return; } state.mode = null; pe.tool = 'curveopts'; renderAll(); if (isPhone()) togglePanel('dialog', true); };
function renderCurveOpts(d: HTMLElement) {
  d.innerHTML = `<h3>${tt('Curve network – options')}</h3><p class="note">${tt('Detection (edges, tangents, radius transitions), clean-up of small/loose curve pieces and corners of the patch layout.')}</p>
    ${CURVE_OPT_DEF.map(([k, l, a, b, st, u]) => `<div class="row"><label style="flex:1">${tt(l)}</label><input type="number" data-co="${k}" min="${a}" max="${b}" step="${st}" value="${curveOpts[k]}" style="width:5.5em"> <span class="sub">${u}</span></div>`).join('')}
    <div class="row"><label><input type="checkbox" id="co-auto" ${curveOpts.autoCorners ? 'checked' : ''}> ${tt('Set corners on closed curves automatically')}</label></div>
    <div class="row"><button class="btn primary" id="co-run">⟳ ${tt('Detect again')}</button><button class="btn" id="co-lay">${tt('Layout only')}</button><button class="btn" id="co-exit">${tt('Close')}</button></div>`;
  d.querySelectorAll<HTMLInputElement>('[data-co]').forEach((i) => i.addEventListener('change', () => { const v = parseFloat(i.value); if (isFinite(v)) (curveOpts as any)[i.dataset.co!] = v; }));
  d.querySelector<HTMLInputElement>('#co-auto')!.addEventListener('change', (e) => { curveOpts.autoCorners = (e.target as HTMLInputElement).checked; });
  d.querySelector('#co-run')!.addEventListener('click', () => detectCurvesUI());
  d.querySelector('#co-lay')!.addEventListener('click', async () => { await busy(updateLayout()); renderAll(); });
  d.querySelector('#co-exit')!.addEventListener('click', () => peExit());
}
function renderCurveSel(d: HTMLElement, c: CurveView) {
  const E = (m: string, t: string, l: string) => `<button class="btn ${cv.edit === m ? 'on primary' : ''}" data-ce="${m}" title="${t}">${l}</button>`;
  const hint: Record<string, string> = { insert: 'Tap on the curve to insert a control point there.', delpt: 'Tap on a control point to remove it.', split: 'Tap on the curve where it should be split.', join: 'Tap on the second curve; the nearest ends are joined across the mesh.' };
  d.innerHTML = `<h3>〰 ${c.name}</h3>${kv([[tt('Type'), CURVE_NAME[c.kind]], [tt('Length'), c.length.toFixed(2) + ' mm'], [tt('Control points'), String(c.ctrl.length)], [tt('Degree'), '3 (B-spline)'], [tt('Closed'), c.closed ? tt('yes') : tt('no')]] as any)}
    <p class="note">${cv.edit ? tt(hint[cv.edit]) : tt('Drag control points (white) – they snap onto the mesh.')}</p>
    <div class="row">${E('insert', tt('Insert control point'), '+ ' + tt('Point'))}${E('delpt', tt('Delete control point'), '− ' + tt('Point'))}${E('split', tt('Split curve'), '✂ ' + tt('Split'))}${E('join', tt('Join with another curve'), '⛓ ' + tt('Join'))}</div>
    <div class="row"><button class="btn" id="cv-del">✕ ${tt('Delete')}</button><button class="btn" id="cv-und" ${cv.undo.length ? '' : 'disabled'}>↶ ${tt('Undo')}</button><button class="btn" id="cv-close">${tt('Done')}</button></div>`;
  d.querySelectorAll<HTMLButtonElement>('[data-ce]').forEach((b) => b.addEventListener('click', () => { cv.edit = cv.edit === b.dataset.ce ? null : (b.dataset.ce as any); renderDialog(); renderModeBar(); }));
  d.querySelector('#cv-del')!.addEventListener('click', () => curveDelete(c.id));
  d.querySelector('#cv-und')!.addEventListener('click', () => curveUndo());
  d.querySelector('#cv-close')!.addEventListener('click', () => curveSelect(null));
}
$('#btn-curve-layout').onclick = async () => { if (!state.curves.length) { toast('Detect or draw curves first.'); return; } state.showLayout = !state.showLayout; if (state.showLayout) pe.cmp = false; if (!state.layout) await updateLayout(); renderAll(); };
function renderCurveDialog(d: HTMLElement) {
  const L = state.layout;
  d.innerHTML = `<h3>${tt('Draw curve')}</h3><p class="note">${tt('Tap/click points on the mesh; they are connected along the shortest edge path, fitted as a cubic B-spline and placed on the mesh. Points near an existing curve snap to it (T-junction).')}</p>
    <div class="row"><b>${curveDraft.length}</b>&nbsp;${tt('points placed')}</div>
    <div class="row"><button class="btn primary" id="cv-ok" ${curveDraft.length > 1 ? '' : 'disabled'}>✔ ${tt('Create curve')}</button><button class="btn" id="cv-undo" ${curveDraft.length ? '' : 'disabled'}>↶ ${tt('Point')}</button><button class="btn" id="cv-exit">${tt('Close')}</button></div>
    ${L ? `<h4>${tt('Patch layout')}</h4><div class="row"><span class="note">${tt('{0} curves · {1} nodes · {2} T-junctions · {3} patches · <b>{4}</b> 4-sided', state.curves.length, L.nodes.length, L.tJunctions, L.regions.length, L.foursided)}</span></div>` : ''}`;
  d.querySelector('#cv-ok')?.addEventListener('click', () => curveFinish());
  d.querySelector('#cv-undo')?.addEventListener('click', () => { curveDraft.pop(); renderAll(); });
  d.querySelector('#cv-exit')?.addEventListener('click', () => peExit());
}
/** Test-Hilfe: Projekt speichern und sofort wieder öffnen (Persistenz-Prüfung). */
(window as any).__app.roundtrip = async () => { const bin = writeProject(projectJSON(), meshArrays(), featureIndexBlob()); const p = readProject(bin); await applyProject(p.json, p.mesh, p.idx); return bin.length; };

initCad({ viewer, toast, status, renderTree, renderDialog, isPhone, togglePanel: (p, on) => togglePanel(p, on), eyeBtn, hasMesh: () => !!state.data });


// ------------------------------------------------------------------ Coordinate systems (3-2-1)
// Definitions reference features; the frame is recomputed from the current features on every use (dependency recompute).
// Only one system is active; all coordinate outputs (feature X/Y/Z/IJK, position, angle and distance components,
// annotations, report) are expressed in it. Data are never transformed.
type CsField = 'p' | 's' | 'X' | 'Y' | 'Z';
function csFieldName(k: CsField) { return k === 'p' ? tt('Primary') : k === 's' ? tt('Secondary') : tt('Origin {0}', k); }
function csById(id: number | null) { return id == null ? undefined : state.csys.find((c) => c.id === id); }
function csResult(cs: CSys) { return computeCSys(cs, featMap()); }
function activeFrame(): Frame | null {
  if (state.csEdit) { /* while editing outputs stay in the active system */ }
  const cs = csById(state.activeCs); if (!cs) return null;
  return csResult(cs).frame;
}
function activeCsName() { const cs = csById(state.activeCs); return cs ? cs.name : tt('Global (WCS)'); }
function csActivate(id: number | null) {
  state.activeCs = id; const cs = csById(id);
  const r = cs ? csResult(cs) : null;
  if (r?.error) toast(tt('{0}: {1} – global coordinates are used.', cs!.name, tt(r.error)));
  status(tt('Active coordinate system: {0}', activeCsName())); renderAll(); renderCsIndicator();
}
function csNew() {
  if (!state.data) { toast(tt('Import a model and create features first.')); return; }
  stopMode();
  const cs = newCSys(state.nextCs, tt('Coordinate System {0}', state.nextCs));
  // prefill: selected features (first = primary, second = secondary)
  const fm = featMap(); const sel = state.sel.map((i) => fm.get(i)!).filter(Boolean);
  if (sel[0] && usableAs(sel[0].type, 'primary')) cs.primary.fid = sel[0].id;
  if (sel[1] && usableAs(sel[1].type, 'secondary')) cs.secondary.fid = sel[1].id;
  suggestOrigin(cs, fm);
  state.csEdit = { draft: cs, orig: null, field: cs.primary.fid == null ? 'p' : cs.secondary.fid == null ? 's' : null, activate: true };
  state.sel = []; state.csSel = null; setPaneOpen('dialog', true); togglePanel('dialog', !isPhone());
  renderAll();
}
function csEditStart(id: number) {
  const cs = csById(id); if (!cs) return; stopMode();
  state.csEdit = { draft: JSON.parse(JSON.stringify(cs)), orig: cs, field: null, activate: state.activeCs === id };
  setPaneOpen('dialog', true); togglePanel('dialog', !isPhone()); renderAll();
}
function csPick(fid: number) {
  const e = state.csEdit!, f = state.features.find((x) => x.id === fid); if (!f || !e.field) return;
  const step = e.field === 'p' ? 'primary' : e.field === 's' ? 'secondary' : 'origin';
  if (!usableAs(f.type, step)) { toast(tt('{0} cannot be used as {1}.', typeName(f.type), csFieldName(e.field))); return; }
  const d = e.draft;
  if (e.field === 'p') d.primary.fid = fid; else if (e.field === 's') d.secondary.fid = fid; else d.origin[e.field] = { ...d.origin[e.field], fid, auto: undefined };
  if (e.field === 'p' || e.field === 's') suggestOrigin(d, featMap()); // auto-fill only after primary/secondary, never after an origin pick
  e.field = nextEmptyField(d, e.field); // any order: continue with the next empty step, wrapping around
  renderAll();
}
function csOk() {
  const e = state.csEdit; if (!e) return;
  const r = csResult(e.draft); if (r.error) { toast(tt(r.error)); return; }
  if (e.orig) Object.assign(e.orig, e.draft); else { state.csys.push(e.draft); state.nextCs++; }
  const id = e.draft.id; state.csEdit = null; state.csSel = id;
  if (e.activate) state.activeCs = id;
  status(tt('{0} saved ({1}/6 degrees of freedom locked).', e.draft.name, r.dof)); renderAll(); renderCsIndicator();
}
function csCancel() { state.csEdit = null; renderAll(); }
function csDelete(id: number) {
  const cs = csById(id); if (!cs) return;
  state.csys = state.csys.filter((c) => c.id !== id); if (state.activeCs === id) state.activeCs = null; if (state.csSel === id) state.csSel = null;
  status(tt('{0} deleted.', cs.name)); renderAll(); renderCsIndicator();
}
function csViewZ(id: number | null) {
  const cs = csById(id), fr = cs ? csResult(cs).frame : null; const z: [number, number, number] = fr ? (fr.R[2] as [number, number, number]) : [0, 0, 1];
  const o = (fr?.o ?? [0, 0, 0]) as [number, number, number];
  viewer.focus(o, Math.max(state.data?.diag ?? 100, 1) / 2, z);
}
function csSelect(id: number) { state.csSel = id; state.sel = []; state.selModel = false; state.curveSel = null; renderAll(); }

function featOptions(step: 'primary' | 'secondary' | 'origin', cur: number | null) {
  return `<option value="">—</option>` + state.features.filter((f) => f.type !== 'Abstand' && usableAs(f.type, step))
    .map((f) => `<option value="${f.id}" ${f.id === cur ? 'selected' : ''}>${f.name} (${typeName(f.type)})</option>`).join('');
}
const axisSel = (id: string, cur: Axis, flip: boolean) => `<select id="${id}" class="cs-ax">${(['X', 'Y', 'Z'] as Axis[]).flatMap((a) => [[a, false], [a, true]] as [Axis, boolean][])
  .map(([a, fl]) => `<option value="${fl ? '-' : '+'}${a}" ${a === cur && fl === flip ? 'selected' : ''}>${fl ? '−' : '+'}${a}</option>`).join('')}</select>`;
/** Translations a step's feature can lock (logical defaults): plane → along its own axis; axis (cylinder/cone/line) →
 *  the two axes ⟂ to it; circle/sphere/point → all three. */
function dofAllowed(cs: CSys, step: 'p' | 's'): Axis[] {
  const id = step === 'p' ? cs.primary.fid : cs.secondary.fid, f = state.features.find((x) => x.id === id); if (!f) return [];
  const ax = step === 'p' ? cs.primary.axis : cs.secondary.axis, others = (['X', 'Y', 'Z'] as Axis[]).filter((a) => a !== ax);
  if (f.type === 'Ebene') return [ax];
  if (['Zylinder', 'Kegel', 'Linie', 'Torus'].includes(f.type)) return step === 'p' ? others : others.filter((a) => a !== cs.primary.axis);
  return ['X', 'Y', 'Z'];
}
function dofSection(cs: CSys, step: 'p' | 's'): string {
  const id = step === 'p' ? cs.primary.fid : cs.secondary.fid; if (id == null) return '';
  const al = dofAllowed(cs, step), rot = step === 'p' ? tt('2 rotations (level)') : tt('1 rotation (about the primary axis)');
  return `<details class="cs-dofs"><summary>${tt('Constrained DOF')}</summary>
    <label><input type="checkbox" checked disabled> ${rot}</label>
    ${(['X', 'Y', 'Z'] as Axis[]).map((a) => `<label title="${al.includes(a) ? tt('Lock the {0} translation with this feature (sets origin {0})', a) : tt('This feature cannot define the {0} translation', a)}"><input type="checkbox" data-dof="${step}${a}" ${cs.origin[a].fid === id ? 'checked' : ''} ${al.includes(a) ? '' : 'disabled'}> ${tt('Translation {0}', a)}</label>`).join('')}
  </details>`;
}
function renderCsEdit(d: HTMLElement) {
  const e = state.csEdit!, cs = e.draft, r = csResult(cs);
  const pickBtn = (k: CsField) => `<button class="btn cs-pick ${e.field === k ? 'on' : ''}" data-pick="${k}" title="${tt('Pick in 3D view or tree')}">⌖</button>`;
  const row = (k: CsField, label: string, inner: string) => `<div class="cs-row ${e.field === k ? 'act' : ''}"><label>${label}</label>${inner}${pickBtn(k)}</div>`;
  d.innerHTML = `<h3>${ICON.csys} ${e.orig ? tt('Edit coordinate system') : tt('New coordinate system (3-2-1)')}</h3>
    <div class="row"><label>${tt('Name')}</label><input id="cs-name" value="${cs.name.replace(/"/g, '&quot;')}"></div>
    <div class="cs-dof ${r.error ? 'err' : r.dof === 6 ? 'ok' : ''}">${tt('DOF locked')} <b>${r.error ? '—' : r.dof}/6</b>${r.error ? ` · ⚠ ${tt(r.error)}` : ''}${r.warnings.map((w) => `<div class="note">⚠ ${tt(w)}</div>`).join('')}</div>
    <p class="note">${tt('Steps can be filled in any order (e.g. origin first); automatic origin entries follow the current primary/secondary.')}</p>
    <h4>1 · ${tt('Primary – orientation')}</h4>
    ${row('p', tt('Feature'), `<select id="cs-p">${featOptions('primary', cs.primary.fid)}</select>${axisSel('cs-pa', cs.primary.axis, cs.primary.flip)}`)}
    <p class="note">${tt('Plane: normal · cylinder, cone, line: axis. Locks 2 rotations.')}</p>${dofSection(cs, 'p')}
    <h4>2 · ${tt('Secondary – rotation')}</h4>
    ${row('s', tt('Feature'), `<select id="cs-s">${featOptions('secondary', cs.secondary.fid)}</select>${axisSel('cs-sa', cs.secondary.axis, cs.secondary.flip)}`)}
    <p class="note">${tt('Projected into the primary plane. Circle/sphere/point: direction from the origin feature to its center. Locks 1 rotation.')}</p>${dofSection(cs, 's')}
    <h4>3 · ${tt('Origin')}</h4>
    ${(['X', 'Y', 'Z'] as Axis[]).map((a) => row(a, a, `<select id="cs-o${a}">${featOptions('origin', cs.origin[a].fid)}</select><input id="cs-off${a}" class="cs-off" type="text" inputmode="decimal" value="${cs.origin[a].off}" title="${tt('Offset [mm]')}">${cs.origin[a].auto ? `<small class="cs-auto" title="${tt('Auto-filled – pick another feature or choose “—” to override')}">auto: ${tt(cs.origin[a].auto!)}</small>` : ''}`)).join('')}
    <p class="note">${tt('Each axis from one feature (+ offset in mm). Plane: along its normal · circle/cylinder: the two other axes. Entries marked “auto” were filled from steps 1–2 and can be overridden.')} <a href="#" id="cs-help">${tt('Why?')}</a></p>
    <div class="row"><label><input type="checkbox" id="cs-act" ${e.activate ? 'checked' : ''}> ${tt('Activate after creation')}</label></div>
    <div class="row"><button class="btn primary" id="cs-ok" ${r.error ? 'disabled' : ''}>✓ ${e.orig ? tt('Apply') : tt('Create')}</button><button class="btn" id="cs-cancel">✕ ${tt('Cancel')}</button></div>`;
  const q = <T extends HTMLElement>(sel: string) => d.querySelector<T>(sel)!;
  const fid = (v: string) => (v === '' ? null : Number(v));
  q<HTMLInputElement>('#cs-name').onchange = (ev) => { cs.name = (ev.target as HTMLInputElement).value.trim() || cs.name; renderModeBar(); renderScene(); };
  q<HTMLSelectElement>('#cs-p').onchange = (ev) => { cs.primary.fid = fid((ev.target as HTMLSelectElement).value); suggestOrigin(cs, featMap()); renderAll(); };
  q<HTMLSelectElement>('#cs-s').onchange = (ev) => { cs.secondary.fid = fid((ev.target as HTMLSelectElement).value); suggestOrigin(cs, featMap()); renderAll(); };
  const ax = (v: string): [Axis, boolean] => [v.slice(1) as Axis, v[0] === '-'];
  q<HTMLSelectElement>('#cs-pa').onchange = (ev) => { [cs.primary.axis, cs.primary.flip] = ax((ev.target as HTMLSelectElement).value); renderAll(); };
  q<HTMLSelectElement>('#cs-sa').onchange = (ev) => { [cs.secondary.axis, cs.secondary.flip] = ax((ev.target as HTMLSelectElement).value); renderAll(); };
  for (const a of ['X', 'Y', 'Z'] as Axis[]) {
    q<HTMLSelectElement>('#cs-o' + a).onchange = (ev) => { cs.origin[a].fid = fid((ev.target as HTMLSelectElement).value); cs.origin[a].auto = undefined; renderAll(); };
    q<HTMLInputElement>('#cs-off' + a).onchange = (ev) => { const v = Number((ev.target as HTMLInputElement).value.replace(',', '.')); if (isFinite(v)) cs.origin[a].off = v; renderAll(); };
  }
  d.querySelectorAll<HTMLInputElement>('[data-dof]').forEach((i) => (i.onchange = () => { const st = i.dataset.dof![0], ax = i.dataset.dof![1] as Axis, id = st === 'p' ? cs.primary.fid : cs.secondary.fid;
    cs.origin[ax] = i.checked ? { ...cs.origin[ax], fid: id, auto: undefined } : { ...cs.origin[ax], fid: null, auto: undefined }; renderAll(); }));
  d.querySelector('#cs-help')?.addEventListener('click', (ev) => { ev.preventDefault(); showDocs('csys'); });
  d.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => (b.onclick = () => { e.field = e.field === b.dataset.pick ? null : (b.dataset.pick as CsField); renderAll(); if (isPhone() && e.field) togglePanel('dialog', false); }));
  q<HTMLInputElement>('#cs-act').onchange = (ev) => { e.activate = (ev.target as HTMLInputElement).checked; };
  q('#cs-ok').onclick = () => csOk(); q('#cs-cancel').onclick = () => csCancel();
}
function csSpec(): CtxSpec {
  const e = state.csEdit!, r = csResult(e.draft);
  const chips = (['p', 's', 'X', 'Y', 'Z'] as CsField[]).map((k) => {
    const id = k === 'p' ? e.draft.primary.fid : k === 's' ? e.draft.secondary.fid : e.draft.origin[k].fid;
    return `<button data-csf="${k}" class="cp-chip ${e.field === k ? 'on' : ''}" title="${csFieldName(k)}">${k === 'p' ? '1' : k === 's' ? '2' : k}: ${id != null ? nameOf(id) : '…'}</button>`; }).join('');
  return {
    title: `${ICON.csys} ${e.draft.name}`,
    controls: chips,
    stats: `<span class="cp-kv"><small>${tt('DOF')}</small><b>${r.error ? '—' : r.dof}/6</b></span>${r.error ? `<span class="cp-hint">⚠ ${tt(r.error)}</span>` : e.field ? `<span class="cp-hint">${tt('Pick: {0}', csFieldName(e.field))}</span>` : ''}`,
    bind: (el) => el.querySelectorAll<HTMLButtonElement>('[data-csf]').forEach((b) => (b.onclick = () => { e.field = e.field === b.dataset.csf ? null : (b.dataset.csf as CsField); renderAll(); })),
    ok: { run: csOk, disabled: !!r.error, title: tt('Create coordinate system (Enter)') },
    cancel: { run: csCancel, title: tt('Cancel (Esc)') },
  };
}
function renderCsDialog(d: HTMLElement) {
  const id = state.csSel!, cs = csById(id), r = cs ? csResult(cs) : null, fr = cs ? r!.frame : null;
  const v3 = (v: number[]) => v.map((x) => x.toFixed(4)).join('  ');
  const def: [string, string][] = cs ? [
    [tt('Primary'), `${nameOf(cs.primary.fid)} → ${cs.primary.flip ? '−' : '+'}${cs.primary.axis}`],
    [tt('Secondary'), `${nameOf(cs.secondary.fid)} → ${cs.secondary.flip ? '−' : '+'}${cs.secondary.axis}`],
    ...(['X', 'Y', 'Z'] as Axis[]).map((a) => [tt('Origin {0}', a), `${nameOf(cs.origin[a].fid)}${cs.origin[a].off ? ` ${sgn(cs.origin[a].off, 3)} mm` : ''}`] as [string, string]),
    [tt('DOF locked'), r!.error ? '—' : `${r!.dof}/6`]] : [[tt('Definition'), tt('global machine/data coordinates')]];
  const geo: [string, string][] = fr ? [[tt('Origin'), v3(fr.o)], ['X', v3(fr.R[0])], ['Y', v3(fr.R[1])], ['Z', v3(fr.R[2])]] : cs ? [] : [[tt('Origin'), '0  0  0']];
  d.innerHTML = `<h3>${ICON.csys} ${cs ? cs.name : tt('Global (WCS)')} ${state.activeCs === (cs ? id : null) ? `<span class="sub">● ${tt('active')}</span>` : ''}</h3>
    ${cs ? `<div class="row"><label>${tt('Name')}</label><input id="csd-name" value="${cs.name.replace(/"/g, '&quot;')}"></div>` : ''}
    ${r?.error ? `<div class="cs-dof err">⚠ ${tt(r.error)}</div>` : ''}${r?.warnings.map((w) => `<div class="note">⚠ ${tt(w)}</div>`).join('') ?? ''}
    ${kv(def)}${geo.length ? `<h4>${tt('In global coordinates')}</h4>${kv(geo)}` : ''}
    <div class="row">${state.activeCs === (cs ? id : null) ? '' : `<button class="btn primary" id="csd-act">● ${tt('Activate')}</button>`}${cs ? `<button class="btn" id="csd-edit">✎ ${tt('Edit …')}</button>` : ''}
      <button class="btn" id="csd-view">⬇ ${tt('View along Z')}</button>${cs ? `<button class="btn warn" id="csd-del">✕ ${tt('Delete')}</button>` : ''}</div>`;
  d.querySelector<HTMLInputElement>('#csd-name')?.addEventListener('change', (ev) => { cs!.name = (ev.target as HTMLInputElement).value.trim() || cs!.name; renderAll(); renderCsIndicator(); });
  d.querySelector('#csd-act')?.addEventListener('click', () => csActivate(cs ? id : null));
  d.querySelector('#csd-edit')?.addEventListener('click', () => csEditStart(id));
  d.querySelector('#csd-view')?.addEventListener('click', () => csViewZ(cs ? id : null));
  d.querySelector('#csd-del')?.addEventListener('click', () => csDelete(id));
}
function csTree(node: (html: string, cls: string, onClick?: (e: MouseEvent) => void, sel?: boolean, fid?: number, eye?: HTMLElement) => HTMLElement) {
  if (!state.data) return;
  node(`<span class="tw">▾</span>${ICON.folder}${tt('Coordinate Systems')} (${state.csys.length + 1})`, 'indent1', undefined, false, undefined,
    eyeBtn(state.showCs, () => { state.showCs = !state.showCs; renderAll(); }));
  const item = (id: number, name: string, extra: string, cs?: CSys) => {
    const act = state.activeCs === (cs ? id : null);
    const n = node(`<span class="tw"></span><span class="cs-dot" title="${act ? tt('active') : tt('Activate')}">${act ? '●' : '○'}</span>${ICON.csys}${act ? `<b>${name}</b>` : name}${extra}`, 'indent2 cs-node', () => csSelect(id), state.csSel === id, undefined,
      cs ? eyeBtn(cs.visible, () => { cs.visible = !cs.visible; renderTree(); renderScene(); scheduleAutosave(); }) : undefined);
    n.dataset.csid = String(id); n.dataset.gk = 'cs' + id;
    n.querySelector<HTMLElement>('.cs-dot')!.onclick = (e) => { e.stopPropagation(); csActivate(cs ? id : null); };
    n.ondblclick = () => (cs ? csEditStart(id) : csActivate(null));
    n.oncontextmenu = (e) => { e.preventDefault(); openCsContext(e.clientX, e.clientY, id); };
    let t = 0; n.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; const x = e.clientX, y = e.clientY; t = window.setTimeout(() => openCsContext(x, y, id), 550); });
    n.addEventListener('pointerup', () => clearTimeout(t)); n.addEventListener('pointermove', () => clearTimeout(t));
  };
  item(0, tt('Global (WCS)'), '');
  for (const cs of state.csys) {
    const r = csResult(cs);
    item(cs.id, cs.name, ` <span class="sub">${r.error ? '⚠ ' + tt(r.error) : `🔗 ${r.dof}/6`}</span>`, cs);
  }
}
function openCsContext(x: number, y: number, id: number) {
  const cs = csById(id); csSelect(id);
  const items: ([string, () => void] | null)[] = [[`● ${tt('Activate')}`, () => csActivate(cs ? id : null)]];
  if (cs) items.push([`✎ ${tt('Edit …')}`, () => csEditStart(id)], [`ⓘ ${tt('Properties')}`, () => { setPaneOpen('dialog', true); togglePanel('dialog', true); }],
    [cs.visible ? `👁 ${tt('Hide triad')}` : `👁 ${tt('Show triad')}`, () => { cs.visible = !cs.visible; renderAll(); }],
    [`✎ ${tt('Rename …')}`, () => { setPaneOpen('dialog', true); togglePanel('dialog', true); setTimeout(() => $<HTMLInputElement>('#csd-name')?.select(), 30); }]);
  items.push([`⬇ ${tt('View along Z')}`, () => csViewZ(cs ? id : null)]);
  if (cs) items.push(null, [`✕ ${tt('Delete')}`, () => csDelete(id)]);
  ctxMenu.className = 'ctx-menu';
  ctxMenu.innerHTML = items.map((it, i) => (it ? `<button data-i="${i}">${it[0]}</button>` : '<hr>')).join('');
  ctxMenu.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => { ctxMenu.classList.add('hidden'); items[+b.dataset.i!]![1](); }));
  ctxMenu.style.left = Math.min(x, innerWidth - ctxMenu.offsetWidth - 4) + 'px'; ctxMenu.style.top = Math.min(y, innerHeight - ctxMenu.offsetHeight - 4) + 'px';
}
function renderCsTriads() {
  if (state.csEdit) { const r = csResult(state.csEdit.draft); if (r.frame) viewer.addTriad(r.frame.o, r.frame.R, state.csEdit.draft.name, true, true); }
  if (!state.showCs) return;
  for (const cs of state.csys) {
    if (!cs.visible || state.csEdit?.orig === cs) continue;
    const r = csResult(cs); if (r.frame) viewer.addTriad(r.frame.o, r.frame.R, cs.name, state.activeCs === cs.id);
  }
}
/** Lower-right indicator "CS: name" – click for a quick switch. */
function renderCsIndicator() {
  let el = document.getElementById('cs-ind');
  if (!el) {
    el = document.createElement('button'); el.id = 'cs-ind'; viewer.el.appendChild(el);
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.onclick = (e) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const items: [string, () => void][] = [[`${state.activeCs == null ? '● ' : '○ '}${tt('Global (WCS)')}`, () => csActivate(null)],
        ...state.csys.map((c) => [`${state.activeCs === c.id ? '● ' : '○ '}${c.name}`, () => csActivate(c.id)] as [string, () => void]), [`＋ ${tt('New 3-2-1 …')}`, () => csNew()]];
      ctxMenu.className = 'ctx-menu';
      ctxMenu.innerHTML = items.map((it, i) => `<button data-i="${i}">${it[0]}</button>`).join('');
      ctxMenu.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => { ctxMenu.classList.add('hidden'); items[+b.dataset.i!][1](); }));
      ctxMenu.style.left = Math.max(4, Math.min(r.right - ctxMenu.offsetWidth, innerWidth - ctxMenu.offsetWidth - 4)) + 'px'; ctxMenu.style.top = Math.max(4, r.top - ctxMenu.offsetHeight - 4) + 'px';
    };
  }
  const cs = csById(state.activeCs), err = cs ? csResult(cs).error : undefined;
  el.classList.toggle('hidden', !state.data); el.classList.toggle('local', !!cs);
  el.innerHTML = `${ICON.csys}<span>${tt('CS')}: <b>${activeCsName()}</b>${err ? ' ⚠' : ''}</span>`;
  el.title = err ? tt('{0}: {1} – global coordinates are used.', cs!.name, tt(err)) : tt('Active coordinate system – click to switch');
}
$('#ico-cs').innerHTML = ICON.csys;
$('#btn-cs-new').onclick = () => csNew();
$('#btn-cs-activate').onclick = () => { if (state.csSel != null) csActivate(state.csSel || null); else toast(tt('Select a coordinate system in the tree first.')); };
$('#btn-cs-global').onclick = () => csActivate(null);
$('#btn-cs-edit').onclick = () => { if (state.csSel) csEditStart(state.csSel); else toast(tt('Select a coordinate system in the tree first.')); };
$('#btn-cs-del').onclick = () => { if (state.csSel) csDelete(state.csSel); else toast(tt('Select a coordinate system in the tree first.')); };
$('#btn-cs-show').onclick = () => { state.showCs = !state.showCs; renderAll(); };
$('#btn-cs-view').onclick = () => csViewZ(state.activeCs);
renderCsIndicator();
Object.assign((window as any).__app, { csNew, csActivate, csOk, csEditStart, csResult });


// ------------------------------------------------------------------ Constructed features
// Method "Construction": the feature is computed from parent features (see core/construct.ts) and recomputed when a
// parent changes (recomputeDistances handles all derived features in dependency order). Chain icon 🔗 in the tree.
function startConstruct(out: GeomType, key?: string) {
  if (!state.data) { toast(tt('Import a model and create features first.')); return; }
  const list = constructionsFor(out); if (!list.length) { toast(tt('{0} cannot be constructed.', typeName(out))); return; }
  pe.tool = null; state.csEdit = null;
  const c = (key ? conByKey(key) : null) ?? (state.mode?.kind === 'con' && state.mode.out === out ? conByKey(state.mode.key)! : list[0]);
  state.mode = { kind: 'con', out, key: c.key, refs: [], slot: 0, params: Object.fromEntries((c.params ?? []).map((p) => [p.key, p.def])) };
  // prefill from the tree selection where the types fit
  for (const id of state.sel) { const f = state.features.find((x) => x.id === id); const s = slotFor(c, state.mode.refs.length); if (f && s && accepts(s, f.type)) state.mode.refs.push(id); }
  state.mode.slot = state.mode.refs.length; state.preview = null; clearBrush(); updateConPreview();
  setPaneOpen('dialog', true); togglePanel('dialog', !isPhone()); renderAll();
}
function setConstruction(key: string) {
  const m = state.mode as ConMode, c = conByKey(key)!; const keep = m.refs.filter((id, i) => { const f = state.features.find((x) => x.id === id), s = slotFor(c, i); return f && s && accepts(s, f.type); });
  state.mode = { ...m, key, refs: keep as number[], slot: keep.length, params: Object.fromEntries((c.params ?? []).map((p) => [p.key, m.params[p.key] ?? p.def])) };
  updateConPreview(); renderAll();
}
function conPick(id: number) {
  const m = state.mode as ConMode, c = conByKey(m.key)!, f = state.features.find((x) => x.id === id); if (!f) return;
  const s = slotFor(c, m.slot);
  if (!s) { status(tt('All inputs are set – ✓ to create, or remove one first.')); return; }
  if (!accepts(s, f.type)) { toast(tt('{0} cannot be used as “{1}”.', typeName(f.type), tt(s.label))); return; }
  if (m.refs.includes(id)) { toast(tt('{0} is already used.', f.name)); return; }
  m.refs[m.slot] = id; m.slot = m.refs.findIndex((r) => r == null); if (m.slot < 0) m.slot = m.refs.length;
  if (!slotFor(c, m.slot) && m.slot >= c.slots.length && !c.multi) m.slot = m.refs.length;
  updateConPreview();
  if (state.preview && isPhone()) togglePanel('dialog', false);
  renderAll();
}
let conError = '';
function updateConPreview() {
  const m = state.mode as ConMode; conError = '';
  const ps = m.refs.filter((x) => x != null).map((id) => state.features.find((f) => f.id === id)?.measured).filter(Boolean) as FitResult[];
  const c = conByKey(m.key)!, need = c.slots.length + (c.multi?.min ?? 0);
  if (ps.length < need) { state.preview = null; return; }
  try { state.preview = { fit: runConstruction(m.key, ps, m.params), indices: new Uint32Array(0), candidates: [], method: 'Konstruiert', refs: m.refs.filter((x) => x != null) as number[] }; }
  catch (e: any) { state.preview = null; conError = tt(e.message); }
}
function conStats(fit: FitResult): string {
  const rows: [string, string][] = [];
  if (fit.type === 'Winkel') rows.push([tt('Angle'), fmt(fit.angle, 4) + '°']);
  if (fit.pattern) rows.push([tt('Holes'), String(fit.pattern.n)], [tt('Pitch'), fmt(fit.pattern.pitch, 3) + '°'], [tt('Pitch deviation'), fmt(fit.pattern.pitchDev, 4) + '°']);
  if (fit.diameter != null && fit.type !== 'Winkel') rows.push(['Ø', fmt(fit.diameter, 4)]);
  if (fit.form) rows.push([FORM_NAME[fit.type] ?? tt('Form'), fmt(fit.form, 4)]);
  if (fit.type !== 'Winkel') { const fr = activeFrame(), C = fr ? csLocal(fr, fit.center) : fit.center; rows.push(['X Y Z', C.map((v) => fmt(v, 3)).join(' ')]); }
  return rows.map(([k, v]) => `<span class="cp-kv"><small>${k}</small><b>${v}</b></span>`).join('');
}
function conSpec(m: ConMode): CtxSpec {
  const c = conByKey(m.key)!, p = state.preview;
  const n = Math.max(c.slots.length + (c.multi?.min ?? 0), m.refs.length + (c.multi ? 1 : 0));
  const chips = Array.from({ length: n }, (_, i) => { const s = slotFor(c, i)!, id = m.refs[i];
    return `<button data-cslot="${i}" class="cp-chip ${m.slot === i ? 'on' : ''}" title="${tt(s.label)}">${i + 1}: ${id != null ? nameOf(id) : tt(s.label) + ' …'}</button>`; }).join('');
  const opts = constructionsFor(m.out).map((x) => `<option value="${x.key}" ${x.key === m.key ? 'selected' : ''}>${tt(x.label)}</option>`).join('');
  return {
    title: `🔗 ${tt('Construct')} ${typeName(m.out)}`,
    controls: `<select id="cp-con">${opts}</select>${chips}`,
    stats: p ? conStats(p.fit) : `<span class="cp-hint">${conError ? '⚠ ' + conError : tt('Pick: {0}', tt(slotFor(c, m.slot)?.label ?? ''))}</span>`,
    bind: (el) => {
      el.querySelector<HTMLSelectElement>('#cp-con')!.onchange = (e) => setConstruction((e.target as HTMLSelectElement).value);
      el.querySelectorAll<HTMLButtonElement>('[data-cslot]').forEach((b) => (b.onclick = () => { m.slot = Number(b.dataset.cslot); renderAll(); }));
    },
    ok: { run: commitPreview, disabled: !p, title: tt('Create feature (Enter)') },
    undo: { run: () => { if (m.refs.length) { m.refs.pop(); m.slot = m.refs.length; updateConPreview(); renderAll(); } }, disabled: !m.refs.length, title: tt('Remove last input') },
    cancel: { run: stopMode, title: tt('Exit (Esc)') },
  };
}
/** Method choice shown at the top of the create dialogs. */
/** Method choice shown at the top of the create dialogs: From polygon model | Construction | Anchor | From CAD reference (later). */
function methodSeg(out: GeomType | 'auto' | 'Abstand', cur: 'mesh' | 'con' | 'anchor') {
  const con = out !== 'auto' && out !== 'Abstand' && constructionsFor(out as GeomType).length > 0, mesh = out !== 'Winkel' && out !== 'Abstand' || out === 'Abstand', anc = ANCHOR_N[out as GeomType] != null;
  const meshLbl = out === 'Abstand' ? tt('Between features') : tt('From polygon model');
  return `<div class="row method-seg"><span class="cp-seg seg" role="radiogroup">`
    + `<button data-meth="mesh" class="${cur === 'mesh' ? 'on' : ''}" ${mesh ? '' : 'disabled'} title="${out === 'Abstand' ? tt('Distance between two existing features') : tt('Fit the feature to mesh points (click & grow or brush)')}">${meshLbl}</button>`
    + `<button data-meth="con" class="${cur === 'con' ? 'on' : ''}" ${con ? '' : 'disabled'} title="${tt('Construct from other features (intersection, axis, mid plane …)')}">🔗 ${tt('Construction')}</button>`
    + `<button data-meth="anchor" class="${cur === 'anchor' ? 'on' : ''}" ${anc ? '' : 'disabled'} title="${anc ? tt('Pick the minimum number of points on the mesh: {0}', ANCHOR_N[out as GeomType]!) : tt('Not available for this type')}">📍 ${tt('Anchor')}</button>`
    + `<button data-meth="cad" disabled title="${tt('From CAD reference – coming later')}">${tt('From CAD reference')}</button></span></div>`;
}
function bindMethodSeg(d: HTMLElement, out: GeomType | 'auto' | 'Abstand') {
  d.querySelectorAll<HTMLButtonElement>('[data-meth]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.meth;
    if (k === 'con') startConstruct(out as GeomType); else if (k === 'anchor') startAnchor(out as GeomType | 'Abstand');
    else if (out === 'Abstand') startDistanceMode(); else startFitMode(out === 'Winkel' ? 'auto' : out);
  }));
}
function startAnchor(out: GeomType | 'Abstand') {
  if (!state.data) { status('Please load a polygon model first.'); return; }
  pe.tool = null; state.mode = { kind: 'anchor', out, pts: [], nrm: [] }; state.preview = null; clearBrush(); renderAll();
  if (isPhone()) togglePanel('dialog', false);
}
function anchorPick(h: Hit) {
  const m = state.mode as AnchorMode, N = ANCHOR_N[m.out]!;
  if (m.pts.length >= N) { m.pts = []; m.nrm = []; }
  m.pts.push([...h.point] as Vec3); m.nrm.push([...h.normal] as Vec3); updateAnchorPreview(); renderAll();
}
let anchorError = '';
function updateAnchorPreview() {
  const m = state.mode as AnchorMode, N = ANCHOR_N[m.out]!; anchorError = ''; state.preview = null;
  if (m.pts.length < N || m.out === 'Abstand') return;
  try { const fit = anchorFit(m.out, m.pts, m.nrm); if (!fit || !fit.center.every(isFinite)) throw new Error('Points do not define the element – pick other points.');
    state.preview = { fit, indices: new Uint32Array(0), candidates: [], method: 'Anker' as any }; }
  catch (e: any) { anchorError = tt(e.message); }
}
function anchorCommit() {
  const m = state.mode as AnchorMode;
  if (m.out === 'Abstand') {
    if (m.pts.length < 2) return;
    const ids = m.pts.map((p, i) => { state.mode = { kind: 'anchor', out: 'Punkt', pts: [p], nrm: [m.nrm[i]] }; updateAnchorPreview(); commitPreview(); const nf = state.features[state.features.length - 1]; nf.anchor = { pts: [p], nrm: [m.nrm[i]] }; return nf.id; });
    state.mode = { kind: 'dist', a: ids[0], b: ids[1], slot: 1, comp: '3D' }; updateDistancePreview(); commitPreview();
    state.mode = { kind: 'anchor', out: 'Abstand', pts: [], nrm: [] }; renderAll(); return;
  }
  commitPreview(); const nf = state.features[state.features.length - 1]; if (nf?.method === 'Anker') nf.anchor = { pts: m.pts.map((q) => [...q] as Vec3), nrm: m.nrm.map((q) => [...q] as Vec3) };
  state.mode = { ...m, pts: [], nrm: [] }; renderAll();
}
function anchorSpec(): CtxSpec {
  const m = state.mode as AnchorMode, N = ANCHOR_N[m.out]!;
  return { title: `📍 ${tt('Anchor')}: ${m.out === 'Abstand' ? tt('Distance') : typeName(m.out)} · <b>${m.pts.length}/${N}</b> ${tt('pts')}`,
    stats: state.preview ? conStats(state.preview.fit) : anchorError ? `<span class="err">⚠ ${anchorError}</span>` : '',
    ok: { run: anchorCommit, disabled: m.out === 'Abstand' ? m.pts.length < 2 : !state.preview, title: tt('Create feature (Enter)') },
    undo: { run: () => { m.pts.pop(); m.nrm.pop(); updateAnchorPreview(); renderAll(); }, disabled: !m.pts.length, title: tt('Remove last point') },
    cancel: { run: stopMode, title: tt('Exit (Esc)') } };
}
function renderAnchorDialog(d: HTMLElement) {
  const m = state.mode as AnchorMode, N = ANCHOR_N[m.out]!, p = state.preview;
  d.innerHTML = `<h3>${ICON[m.out === 'Abstand' ? 'Abstand 3D' : m.out] ?? ''} ${tt('Create feature')}: ${m.out === 'Abstand' ? tt('Distance') : typeName(m.out)}</h3>${methodSeg(m.out, 'anchor')}
    <p class="note">${m.out === 'Abstand' ? tt('Click two points on the mesh; two anchor points and their distance are created.') : tt('Click {0} points on the mesh – the mathematical minimum for this element. The element passes exactly through them (no form deviation).', N)}</p>
    ${m.pts.map((q, i) => `<div class="cs-row"><label>${i + 1}</label><span style="flex:1">${q.map((v) => fmt(v, 3)).join(' ')}</span></div>`).join('')}
    ${anchorError ? `<div class="cs-dof err">⚠ ${anchorError}</div>` : ''}
    ${p ? `<h4>${tt('Preview')}</h4>${kv(conRows(p.fit))}` : ''}`;
  bindMethodSeg(d, m.out);
}
function renderConDialog(d: HTMLElement) {
  const m = state.mode as ConMode, c = conByKey(m.key)!, p = state.preview;
  const list = constructionsFor(m.out);
  const n = Math.max(c.slots.length + (c.multi?.min ?? 0), m.refs.length + (c.multi ? 1 : 0));
  d.innerHTML = `<h3>${ICON[m.out] ?? ''} ${tt('Create feature')}: ${typeName(m.out)}</h3>${methodSeg(m.out, 'con')}
    <h4>${tt('Construction')}</h4><div class="con-list">${list.map((x) => `<label class="con-item"><input type="radio" name="con-k" value="${x.key}" ${x.key === m.key ? 'checked' : ''}> ${tt(x.label)}</label>`).join('')}</div>
    <h4>${tt('Inputs')}</h4>${Array.from({ length: n }, (_, i) => { const s = slotFor(c, i)!, id = m.refs[i];
      return `<div class="cs-row ${m.slot === i ? 'act' : ''}"><label>${i + 1}</label><span style="flex:1">${id != null ? nameOf(id) : `<i>${tt(s.label)}</i>`}</span><button class="btn cs-pick ${m.slot === i ? 'on' : ''}" data-cslot="${i}" title="${tt('Pick in 3D view or tree')}">⌖</button>${id != null ? `<button class="btn" data-crm="${i}" title="${tt('Remove')}">✕</button>` : ''}</div>`; }).join('')}
    ${c.multi ? `<p class="note">${tt('At least {0} features; pick more to add them.', c.multi.min)}</p>` : ''}
    ${(c.params ?? []).map((q) => q.choices ? `<div class="row"><label>${tt(q.label)}</label><select data-cpar="${q.key}">${q.choices.map((ch, i) => `<option value="${i}" ${m.params[q.key] === i ? 'selected' : ''}>${tt(ch)}</option>`).join('')}</select></div>`
      : `<div class="row"><label>${tt(q.label)}${q.unit ? ` [${q.unit}]` : ''}</label><input data-cpar="${q.key}" value="${m.params[q.key]}" inputmode="decimal"></div>`).join('')}
    ${conError ? `<div class="cs-dof err">⚠ ${conError}</div>` : ''}
    ${p ? `<h4>${tt('Preview')}</h4>${kv(conRows(p.fit))}` : ''}
    <p class="note">${tt('A constructed feature has no own mesh points; it is recomputed automatically when a parent feature changes (chain icon 🔗 in the tree).')}</p>`;
  bindMethodSeg(d, m.out);
  d.querySelectorAll<HTMLInputElement>('[name="con-k"]').forEach((r) => (r.onchange = () => setConstruction(r.value)));
  d.querySelectorAll<HTMLButtonElement>('[data-cslot]').forEach((b) => (b.onclick = () => { m.slot = Number(b.dataset.cslot); renderAll(); if (isPhone()) togglePanel('dialog', false); }));
  d.querySelectorAll<HTMLButtonElement>('[data-crm]').forEach((b) => (b.onclick = () => { m.refs.splice(Number(b.dataset.crm), 1); m.slot = m.refs.length; updateConPreview(); renderAll(); }));
  d.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-cpar]').forEach((i) => (i.onchange = () => { const v = Number(i.value.replace(',', '.')); if (isFinite(v)) m.params[i.dataset.cpar!] = v; updateConPreview(); renderAll(); }));
}
function conRows(fit: FitResult): [string, string][] {
  const rows: [string, string][] = [];
  if (fit.type === 'Winkel') rows.push([tt('Angle [°]'), fmt(fit.angle, 4)]);
  if (fit.pattern) rows.push([tt('Holes'), String(fit.pattern.n)], [tt('Nominal pitch [°]'), fmt(fit.pattern.pitch, 3)], [tt('Pitch deviation [°]'), fmt(fit.pattern.pitchDev, 4)], [tt('Angles [°]'), fit.pattern.angles.map((a) => a.toFixed(2)).join(', ')]);
  if (fit.type !== 'Winkel') rows.push(...fitRows(fit, 0).filter(([k]) => k !== tt('Points') && k !== 'Max. +' && k !== 'Max. −' && k !== tt('Std. dev. (RMS)')));
  return rows;
}
/** Provenance (how the feature was created) – one structure for all methods (core/provenance). */
function provenanceHTML(f: FeatureView): string {
  const p = provenanceOf(f, { seed: f.hit?.point as Vec3 | undefined, params: f.fp as any });
  const rows: [string, string][] = [];
  if (p.kind === 'mesh') { rows.push([tt('Method'), methodName(p.method)], [tt('Points'), String(p.points)]);
    if (p.seed) rows.push([tt('Seed point'), p.seed.map((v) => fmt(v, 3)).join(' ')]);
    if (p.params) rows.push([tt('Max. angle'), fmt(p.params.maxAngleDeg ?? 0, 1) + '°'], [tt('Area r'), p.params.radius ? fmt(p.params.radius, 2) + ' mm' : tt('unlimited')]);
    if (p.aux) rows.push([tt('Auxiliary plane'), `${p.aux.source} (${p.aux.points} ${tt('pts')})`]); }
  else if (p.kind === 'derived') { const d = DERIVES.find((x) => x.key === p.key); rows.push([tt('Method'), `🔗 ${tt('Derived from Analyze')}`], [tt('Derivation'), d ? tt(d.label) : p.key], [tt('Parent'), nameOf(p.parents[0])]);
    if (p.error) rows.push([tt('Error'), `⚠ ${p.error}`]); rows.push([tt('Update'), tt('recomputed automatically when the parent changes')]); }
  else if (p.kind === 'anchor') { rows.push([tt('Method'), tt('Anchor')]); p.pts.forEach((q, i) => rows.push([`P${i + 1}`, q.map((v) => fmt(v, 3)).join(' ')])); }
  else return '';
  if (f.reex) rows.push([tt('Then: re-extraction'), tt('max. dist. {0} mm · {1}σ · {2}° · margin {3} mm → {4} pts ({5} before, {6} removed)', f.reex.maxDist, f.reex.sigma, f.reex.maxAngleDeg, f.reex.margin, f.reex.points, f.reex.before, f.reex.removed)]);
  return `<h4>${tt('Provenance')}</h4>${kv(rows)}`;
}
/** Feature dialog part for constructed features: definition, parameters (editable → recompute). */
function conDefinitionHTML(f: FeatureView): string {
  if (!f.cons) return '';
  const c = conByKey(f.cons.key);
  return `<h4>🔗 ${tt('Construction')}</h4>${kv([[tt('Method'), c ? tt(c.label) : f.cons.key], [tt('Parents'), f.cons.refs.map(nameOf).join(', ')]])}
    ${(c?.params ?? []).map((q) => `<div class="row"><label>${tt(q.label)}${q.unit ? ` [${q.unit}]` : ''}</label><input data-fpar="${q.key}" value="${f.cons!.params?.[q.key] ?? q.def}" inputmode="decimal"></div>`).join('')}
    ${f.cons.error ? `<div class="cs-dof err">⚠ ${f.cons.error}</div>` : ''}`;
}
function bindConDefinition(d: HTMLElement, f: FeatureView) {
  d.querySelectorAll<HTMLInputElement>('[data-fpar]').forEach((i) => (i.onchange = () => { const v = Number(i.value.replace(',', '.')); if (!isFinite(v)) return; (f.cons!.params ??= {})[i.dataset.fpar!] = v; recomputeDistances(); renderAll(); }));
}
{
  const g = document.querySelector('#ribbon [data-tab="merkmale"] #btn-distance')?.parentElement;
  // ONE feature list: construction-only types (angle, bolt circle) join the type buttons; other constructions via the dialog method buttons
  if (g) for (const o of CON_OUTS.filter((o) => o.out === 'Winkel' || o.key === 'bc-pattern')) {
    const b = document.createElement('button'); b.className = 'big'; b.dataset.con = o.key ?? o.out;
    b.innerHTML = `<span class="ico">${o.key === 'bc-pattern' ? '✲' : ICON[o.out] ?? ''}</span>${tt(o.label)}`; b.title = tt('Construct {0} from other features', tt(o.label));
    b.onclick = () => startConstruct(o.out, o.key); typeBtns.appendChild(b);
  }
}
Object.assign((window as any).__app, { startConstruct, conPick, CONSTRUCTIONS });
