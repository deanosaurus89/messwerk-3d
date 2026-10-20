import { registerPickTool, installPickMode } from './ui/pickmode';
import { gunzipSync } from 'fflate';
// MessWerk 3D – Benutzeroberfläche (Ribbon oben, Baumansicht links, 3D-Szene Mitte,
// Dialogbereich rechts, Prüfmerkmal-Liste unten; auf Telefonen als Overlays).
import { initCtxPanel, setCtx, CtxSpec } from './ctxpanel';
import { initLayout, setPaneOpen, paneOpen, initPanelsMenu, showAllPanes } from './layout';
import { docsHtml } from './docs';
import { provenanceOf, hardParentsOf, dependentsOf } from './core/provenance';
import { AxisAnalysis, analyzeAxis, axisNominal } from './core/axisan';
import { sideView } from './ui/axisview';
import { getDec, setDec, decFor, DEC_MIN, DEC_MAX } from './core/display';
import { TRIM_TYPES, trimmedSurface, analyticShell, CURVE_TRIM_TYPES, trimmedCurve } from './core/trim';
import { smoothedBoundary, loopSegments } from './core/boundary';
import { zoneLoops } from './core/auxzone';
import type { Island, IslandChoice } from './core/fillplane';
import { normReex, lateralOf } from './core/reextract';
import { freezeBoundary, type FrozenBoundary } from './core/frozen';
import { installNumFields, parseNum } from './ui/numfield';
import { asNode, migrateFeatures, nodeToJSON, FEATURE_MODEL } from './core/featuremodel';
import { REEX_TYPES, bindReex, clearReexPreview, initReexUI, reexHTML, reexPreview, reexPreviewPts, setSearchDistDefault } from './ui/reexui';
import { REEX_DEFAULT } from './core/reextract';
import { OverlayManager } from './ui/overlays';
import { initRibbonSections, installFitRibbon } from './ui/ribbonsec';
import { GENTOL_DEFAULT, GenTol, TolKind, generalTol, iso286 } from './core/tolerances';
import { FIT_CRITS, FitCrit, critSupported } from './core/chebyshev';
/** cache of trimmed geometry per feature (key: fit centre + point count) */
const trimCache = new Map<number, { key: string; tri: Float32Array; edges: Float32Array }>();
const curveCache = new Map<number, { key: string; seg: Float32Array | null }>();
/** covered arc / segment of a circle, slot or line (null = whole closed curve → normal display) */
function curveTrimFor(f: FeatureView) {
  const key = f.measured!.center.join(',') + '|' + f.measured!.radius + '|' + f.indices.length;
  const c = curveCache.get(f.id); if (c && c.key === key) return c.seg;
  const pts = featPoints(f.id); const seg = pts ? trimmedCurve(f.measured!, pts) : null; curveCache.set(f.id, { key, seg }); return seg;
}
const shellCache = new Map<number, { key: string } & ReturnType<typeof analyticShell>>();
function shellFor(f: FeatureView) {
  const key = f.measured!.center.join(',') + '|' + f.measured!.radius + '|' + f.indices.length;
  const c = shellCache.get(f.id); if (c && c.key === key) return c;
  const r = analyticShell(f.measured!, viewer.model!.geometry.getAttribute('position').array as Float32Array, f.indices);
  const e = { key, ...r }; shellCache.set(f.id, e); return e;
}
function trimFor(f: FeatureView) {
  const key = f.measured!.center.join(',') + '|' + f.measured!.radius + '|' + f.indices.length + '|' + smoothTol;
  const c = trimCache.get(f.id); if (c && c.key === key) return c;
  const g = viewer.model!.geometry; if (!g.index) return null;
  const pos = g.getAttribute('position').array as Float32Array, tris = g.index.array as ArrayLike<number>;
  const r = trimmedSurface(f.measured!, pos, tris, f.indices);
  // 0.31: boundary = smoothed contour of the selection on the fitted surface (no triangle zigzag)
  const e = { key, tri: r.tri, edges: loopSegments(boundaryLoops(f.measured!, pos, tris, f.indices)) }; trimCache.set(f.id, e); return e;
}
/** Boundary smoothing tolerance [mm] (display only): null = automatic (0.7 × mesh edge, ≤ 0.5 mm), 0 = off */
let smoothTol: number | null = (() => { const v = localStorage.getItem('mw3d-smooth'); return v == null || v === '' ? null : Number(v); })();
function setSmoothTol(v: number | null) { smoothTol = v; if (v == null) localStorage.removeItem('mw3d-smooth'); else localStorage.setItem('mw3d-smooth', String(v)); trimCache.clear(); pvLoops = null; }
/** smoothed boundary loops of a selection (tiny loops of isolated points dropped) */
function boundaryLoops(f: FitResult | null, pos: ArrayLike<number>, tris: ArrayLike<number>, verts: ArrayLike<number>) {
  return smoothedBoundary(f, pos, tris, verts, smoothTol).filter((L) => L.length >= 8);
}
/** preview boundary (cached per index set) */
let pvLoops: { ind: Uint32Array; key: string; loops: number[][][] } | null = null;
function previewLoops(p: { fit: FitResult; indices: Uint32Array }) {
  const g = viewer.model?.geometry; if (!g?.index) return [];
  const key = p.fit.center.join(',') + '|' + smoothTol;
  if (pvLoops && pvLoops.ind === p.indices && pvLoops.key === key) return pvLoops.loops;
  const loops = boundaryLoops(p.fit, g.getAttribute('position').array as Float32Array, g.index.array as ArrayLike<number>, p.indices);
  pvLoops = { ind: p.indices, key, loops }; return loops;
}
/** selected island in the Creation Panel (index into preview.islands), −1 = none */
let islSel = -1;
import { t as tt, typeName, kindName, methodName } from './i18n';
import { bindSwipeClose, bindEscClose, scrollWithin, pinLayout } from './ui/overlay';
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
import { initCad, cadOpen, cadTree, cadDialog, cadActive, setCadEdges, cadEdgesOn, setCadOpacity } from './cadui';
import { simulateDatums, DatumAssoc } from './core/datumsim';
import { DERIVES, derivesFor, runDerive } from './core/derive';
import { axisColorScale } from './core/axisan';
import { defaultDia } from './core/median';
import type { BonusInfo } from './core/datum';
import { DATUM_COUNT, DATUM_LETTERS, buildDRF, datumKind, dirLocal, isDatumControl, toLocal, NOMINAL_MISSING, NOMINAL_UNCONFIRMED, isPattern, tedSpec, resolveBasic, TedField } from './core/datum';
import { datumText, isZoneControl, MOD_SYM, ControlResult } from './core/features';
import { statusText } from './core/report';
import { idbDel, idbGet, idbSet, packIndices, readProject, unpackIndex, writeProject } from './project';
import { Tour, TourStep } from './training';
import { type Vec3, sub, scale, dot, norm, add, basis, cross, unit } from './core/linalg';
import type { LabelSpec } from './overlay';
import { ICON } from './icons';
import { CONSTRUCTIONS, CON_OUTS, Construction, accepts, conByKey, constructionsFor, recomputeOrder, runConstruction, slotFor } from './core/construct';
import { CSys, Axis, Frame, computeCSys, newCSys, toLocal as csLocal, dirLocal as csDir, usableAs, suggestOrigin, nextEmptyField, rotate90, smartAxis } from './core/csys';
import { NurbsParams, evalSurface, insideTrim, toIGES, toJSON, toSTEP } from './core/nurbs';

type FitMode = { kind: 'fit'; type: GeomType | 'auto'; method: 'Klick' | 'Pinsel' };
type DimComp = '3D' | 'X' | 'Y' | 'Z';
type DistMode = { kind: 'dist'; a: number | null; b: number | null; slot: 0 | 1; comp: DimComp };
type ConMode = { kind: 'con'; out: GeomType; key: string; refs: (number | null)[]; slot: number; params: Record<string, number> };
type AnchorMode = { kind: 'anchor'; out: GeomType | 'Abstand'; pts: Vec3[]; nrm: Vec3[] };
type Mode = FitMode | DistMode | ConMode | AnchorMode | null;
/** Anchor: mathematical minimum of picked points per feature type. */
const ANCHOR_N: Partial<Record<GeomType | 'Abstand', number>> = { Punkt: 1, Linie: 2, Ebene: 3, Kreis: 3, Kugel: 4, Zylinder: 5, Kegel: 6, Abstand: 2 };
interface FitParamsUI { /** fit criterion (default Gauss) */ crit?: FitCrit; /** Boundary from: 'geom' = zone around the fitted cylinder/cone/sphere/torus (not the grown triangles); zoneBand = its ± search distance */ zoneSrc?: 'points' | 'geom'; zoneBand?: number; fill?: { on: boolean; band: number; exRaised?: boolean; islands?: boolean; /** 0.31: per-island choices (not an island / refine) */ isl?: IslandChoice[] }; /** planes: boundary exclusion distance [mm] */ inset?: number; k: number; nf: { on: boolean; angleDeg: number; maxPct: number }; maxAngleDeg: number; radius: number; aux: 'auto' | 'ring' | 'none' | number; ring?: { gap: number; width: number }; }
interface FeatureView extends Feature { color: number; /** 0.33: frozen boundary (planes, set at ✓) */ frozen?: FrozenBoundary; /** 0.35: the frozen point set (creation selection) */ frozenIdx?: Uint32Array; colorSet?: boolean; dim?: { comp: DimComp }; indices: Uint32Array; candidates?: { type: string; rms: number }[]; auxIndices?: Uint32Array;
  src?: Uint32Array; hit?: Hit; fp?: FitParamsUI; dev?: Float32Array; }
interface PreviewAux { plane: FitResult; indices: Uint32Array; source: string; refId?: number; }
interface Preview { fit: FitResult; indices: Uint32Array; candidates: { type: string; rms: number }[]; method: 'Klick' | 'Pinsel' | 'Konstruiert'; refs?: number[];
  aux?: PreviewAux; hit?: Hit; dev?: Float32Array; /** multi-seed plane: index sets of the merged regions */ regions?: Uint32Array[]; /** zone from the fitted geometry (Boundary from: Fitted geometry) */ zone?: import("./core/reextract").SearchRegion; /** raw region-growing result (before extraction parameters) */ grown?: Uint32Array; /** All inside boundary: search distance used (auto = 3 × RMS) */ bandUsed?: number; /** region-grown points before 'capture all inside outer boundary' */ seed?: Uint32Array; filled?: number; /** All inside boundary: raised-feature points and the outer contour loops */ raised?: Uint32Array; contour?: number[][][]; /** All inside boundary: detected islands (0.31) */ islands?: Island[]; /** aux plane captured with All inside boundary */ auxFill?: boolean; }
type V3 = [number, number, number];
interface CurveView { id: number; name: string; kind: 'Kante' | 'Tangente' | 'Übergang' | 'Benutzer' | 'Vorschlag'; visible: boolean; chain: number[]; closed: boolean; ctrl: number[][]; pts: number[][]; length: number; }

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const engine = new Engine();
const viewer = new Viewer($('#scene'));
const canvas = viewer.renderer.domElement;
const PALETTE = [0xe6194b, 0x3cb44b, 0x4363d8, 0xf58231, 0x911eb4, 0x00a3a3, 0xf032e6, 0x9a6324, 0x2f4f4f, 0x808000, 0x000075, 0xaa6e28];
/** user preferences (localStorage, not the project): general tolerance tables (ISO 2768 / ISO 286) off by default = pre-0.24 behaviour */
const prefs = { tolTables: false };
setDec(2); // display default 2 decimal places (mm); the stored preference is applied below
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
  opts: { genTol: { ...GENTOL_DEFAULT } as GenTol, maxAngleDeg: 20, radius: 0, pick: Number(localStorage.getItem('mw3d-pick') ?? 0) || 0, brush: 3, aux: 'auto' as 'auto' | 'ring' | 'none' | number, lineSide: 0 as 0 | 1, ring: { gap: 0.5, width: 3 }, multi: false, /** Remove region (0.32): next tap removes a grown region from the selection */ sub: false, datumAssoc: 'iso' as DatumAssoc, datumFilter: true, newDatum: '' as string, fill: { on: true, band: null as number | null, exRaised: false, isl: [] as IslandChoice[], /** 0.33: islands added by a tap (disc of brush radius) */ man: [] as { c: Vec3; r: number }[] }, /** next tap adds an island */ addIsl: false,
    /** unified extraction parameters (Creation Panel = Re-extraction): islands, boundary exclusion distance, normal angle criterion, outlier removal */
    ex: { islands: true, inset: 0, angleOn: false, angleDeg: 30, outlierOn: false, outlierK: 3, // Phase 1 step 3: Create = raw fit of the selection; filters optional
       zoneSrc: 'geom' as 'points' | 'geom' } },
  an: { on: false, kind: 'form' as AnKind, ids: [] as number[], res: null as AnResult | null, whisk: false, exag: 50, axExag: 0, axLoc: 1, axHide: false, axEnv: true, axZones: true, otherLabels: false, axLab: { zone: true, env: true, nom: true, dev: true } as Record<'zone' | 'env' | 'nom' | 'dev', boolean>, derivePrev: null as { key: string; parent: number; fit: FitResult } | null, ctrl: null as number | null, trans: localStorage.getItem('mw3d-trans') === '1', scale: 0, steps: 0, center: 'zone' as 'zone' | 'zero' | 'custom', c0: 0, zones: false },
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
  showPrims: true, /** 0.32: one display – always the feature's boundary (the Geometry/Trimmed toggle is gone) */ trimGeo: true, /** “Used points” for all features (View ribbon) */ colorPts: false, /** 0.32: aux-plane points of all features (View ribbon) / per feature */ colorAux: false, usedAux: new Set<number>(), /** “Show used points” per feature (tree right-click) */ usedPts: new Set<number>(), devMap: true, ctrlNet: true,
  nurbs: { nu: 12, nv: 12, deg: 3, smooth: 1e-4 } as NurbsParams,
  nextId: 1, nextCtrl: 1, typeCount: {} as Record<string, number>,
  addFeat: null as number | null,
  curves: [] as CurveView[], nextCurve: 1, curveSel: null as number | null, showLayout: false,
  layout: null as null | { nodes: { p: number[]; degree: number; v: number }[]; corners: { v: number; kind: string; p: number[] }[]; suggestions: (CurveView & { reason: string; region: number })[]; regions: { faces: number; sides: number; loops: number; area: number; center: number[] }[]; regionOf: Int32Array; tJunctions: number; foursided: number },
};
initReexUI({ lasso: () => lassoPick(), call: (req) => busy(engine.call<any>(req as any)), renderAll: () => renderAll(), renderScene: () => renderScene(), showZone: () => showZone, setShowZone: (on) => setShowZone(on), toast: (t) => toast(t), invalidate: (id) => { ptsCache.delete(id); trimCache.delete(id); curveCache.delete(id); },
  recompute: () => recomputeDistances(), autosave: () => scheduleAutosave(), flash: (sel, pending) => flashUpdated(sel, pending), fmt: (v, d) => fmt(v, d) });
// '?' help buttons with a docs section (e.g. Exclude raised) – delegated, works for every panel
document.addEventListener('click', (e) => { const b = (e.target as HTMLElement)?.closest?.('[data-doc-sec]') as HTMLElement | null; if (!b) return; e.preventDefault(); e.stopPropagation(); showDocs(b.dataset.docSec); }, true);
installNumFields();
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
/** 'Show extraction zone' – persistent global preference (localStorage); the zone is only drawn while the feature's
 *  dialog is open (desktop pane visible / phone sheet shown) and that feature is selected. */
let showZone = (() => { try { return localStorage.getItem('mw3d-show-zone') !== '0'; } catch { return true; } })();
function setShowZone(on: boolean) { showZone = on; try { localStorage.setItem('mw3d-show-zone', on ? '1' : '0'); } catch { /* private mode */ } renderAll(); }
const dialogVisible = () => (isPhone() ? document.body.classList.contains('show-dialog') : !document.body.classList.contains('no-dialog'));
const zoneAlive = (id: number) => state.sel.length === 1 && state.sel[0] === id && !state.mode && !state.csEdit && dialogVisible() && state.features.some((x) => x.id === id);
const fmt = (v: number | null | undefined, d = 4) => (v == null || !isFinite(v) ? '—' : v.toFixed(decFor(d)));
const sgn = (v: number, d = 4) => (v >= 0 ? '+' : '') + v.toFixed(decFor(d));
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const rgb = (c: number) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
const nameOf = (id: number | null) => state.features.find((f) => f.id === id)?.name ?? '—';
const isPhone = () => matchMedia('(max-width: 900px), (max-height: 560px)').matches;

function status(t: string) { $('#status').textContent = t; }
function hint(t: string) { $('#hint').textContent = t + (navPaused ? '' : (state.mode || pe.tool || state.csEdit) && !isPhone() ? '  ·  ' + tt('Space = navigation pause') : ''); }
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
initRibbonSections(); installFitRibbon();
{ // iPhone: ↶ ↷ (Quick Access Toolbar) at the right end of the Start section-chip row – no extra height
  const nav = document.querySelector('#ribbon .panel[data-tab="merkmale"] .rsec-nav'); if (nav) { const q = document.createElement('span'); q.className = 'pqat';
    q.innerHTML = `<button id="q-undo-p" disabled title="${tt('Undo (Ctrl+Z) – for now: the last mesh edit; later: every operation')}">↶</button><button id="q-redo-p" disabled title="${tt('Redo (Ctrl+Y) – comes with the global undo (later)')}">↷</button>`;
    q.querySelector<HTMLButtonElement>('#q-undo-p')!.onclick = () => peUndo(); nav.appendChild(q); } }
document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll<HTMLElement>('.panel').forEach((p) => p.classList.toggle('hidden', p.dataset.tab !== b.dataset.tab));
  renderDialog();
}));
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => (b.onclick = () => viewer.view(b.dataset.view as any)));
// general tolerance (project setting): ISO 2768-1 / -2 class for new controls; “Apply to all” refills every non-manual control
function syncGenTolUI() { const g = state.opts.genTol ?? GENTOL_DEFAULT; ($('#gt-lin') as HTMLSelectElement).value = g.lin ?? ''; ($('#gt-geo') as HTMLSelectElement).value = g.geo ?? ''; }
syncGenTolUI();
($('#gt-lin') as HTMLSelectElement).onchange = (e) => { state.opts.genTol = { ...(state.opts.genTol ?? GENTOL_DEFAULT), lin: ((e.target as HTMLSelectElement).value || null) as GenTol['lin'] }; scheduleAutosave(); };
($('#gt-geo') as HTMLSelectElement).onchange = (e) => { state.opts.genTol = { ...(state.opts.genTol ?? GENTOL_DEFAULT), geo: ((e.target as HTMLSelectElement).value || null) as GenTol['geo'] }; scheduleAutosave(); };
$('#gt-apply').onclick = () => { reapplyAllTol(); renderAll(); scheduleAutosave(); toast(tt('General tolerance applied to all controls without a typed tolerance.')); };


const TYPES: (GeomType | 'auto')[] = ['auto', 'Ebene', 'Kreis', 'Zylinder', 'Langloch', 'Linie', 'Kegel', 'Kugel', 'Torus', 'Punkt', 'Freiformfläche'];
const FIT_TYPES = TYPES.filter((t) => t !== 'auto') as GeomType[];
const typeBtns = $('#feat-type-btns'), featMore = $('#feat-more-pop');
// 0.34 Start ribbon: Auto large; the 8 standard types small in 3 rows (▾ = method); Distance/Angle and Properties/Delete
// columns; Freeform, Polyline, Torus, Bolt circle under ⋯ More (desktop: all groups side by side; iPhone: section chips)
const rbIco = (t: string) => `<span class="ico">${ICON[t] ?? t}</span>`;
function rbSmall(icon: string, label: string, title: string, id?: string, cls = 'rb-s') {
  const b = document.createElement('button'); b.className = cls; if (id) b.id = id; b.title = title;
  b.innerHTML = `${rbIco(icon)}<span>${label}</span>`; return b;
}
function rbSplit(b: HTMLButtonElement, menu: (dd: HTMLElement) => void) {
  const w = document.createElement('span'); w.className = 'split rb-split'; const dd = document.createElement('button'); dd.className = 'split-dd'; dd.textContent = '▾';
  dd.title = tt('Choose the creation method'); dd.onclick = (e) => { e.stopPropagation(); closeRbPops(); menu(dd); }; w.append(b, dd); return w;
}
const rbCol = (items: HTMLElement[], sep = false) => { const c = document.createElement('div'); c.className = 'rb-col' + (sep ? ' sep' : ''); c.append(...items);
  while (c.children.length < 3) { const g = document.createElement('div'); g.className = 'rb-ghost'; c.appendChild(g); } return c; };
const typeTitle = (t: GeomType | 'auto') => t === 'auto' ? tt('Auto: click a surface – the feature type is detected automatically') : t === 'Freiformfläche' ? tt('Freeform surface (B-spline/NURBS) – click or brush') : tt('Create {0}: click on the polygon model (▾ = other methods: construction, anchor)', typeName(t));
{ const b = document.createElement('button'); b.className = 'big rb-auto'; b.dataset.ftype = 'auto'; b.title = typeTitle('auto');
  b.innerHTML = `${rbIco('auto')}<span>${typeName('auto')}</span>`; b.onclick = () => startFitMode('auto'); typeBtns.appendChild(b); }
const typeSmall = (t: GeomType) => { const b = rbSmall(t, typeName(t), typeTitle(t)); b.dataset.ftype = t; b.onclick = () => startFitMode(t); return rbSplit(b, (dd) => splitMenu(dd, t)); };
const featMoreBtn = rbSmall('⋯', tt('More'), tt('More feature types: Freeform, Polyline, Torus, Bolt circle'), 'btn-feat-more', 'rb-s more'); featMoreBtn.dataset.pop = 'feat-more-pop';
const distBtn = rbSmall('Abstand 3D', tt('Distance'), tt('Distance between two features or two clicked points (▾ = method)'), 'btn-distance'); distBtn.dataset.ftype = 'Abstand';
const angleSlot = document.createElement('span'); angleSlot.className = 'rb-angle-slot';
typeBtns.append(rbCol([typeSmall('Ebene'), typeSmall('Kreis'), typeSmall('Zylinder')]), rbCol([typeSmall('Langloch'), typeSmall('Linie'), typeSmall('Kegel')]),
  rbCol([typeSmall('Kugel'), typeSmall('Punkt'), featMoreBtn]), rbCol([rbSplit(distBtn, (dd) => splitMenu(dd, 'Abstand')), angleSlot], true),
  rbCol([rbSmall('🛠', tt('Properties'), tt('Properties of the selection: a feature → its properties (also: double-click in the tree); a coordinate system → edit it'), 'btn-props'),
    rbSmall('✕', tt('Delete'), tt('Delete the selection: feature, control or coordinate system'), 'btn-delete-feat')], true));
{ // ⋯ More: Freeform, Polyline, Torus (+ methods), Bolt circle (added with the constructions below)
  const mi = (icon: string, label: string, title: string, id?: string) => rbSmall(icon, label, title, id, 'rb-mi');
  const ff = mi('Freiformfläche', tt('Freeform'), typeTitle('Freiformfläche')); ff.dataset.ftype = 'Freiformfläche'; ff.onclick = () => { closeRbPops(); startFitMode('Freiformfläche'); };
  // Polyline: no nominal on the polygon model → only From CAD reference (later) or Derived from Analyze
  const pl = mi('Linienzug', typeName('Linienzug'), tt('Polyline (connected line segments). Not from the polygon model (it has no nominal there): derive it in Analyze (e.g. the median line of a bore) – From CAD reference comes later'), 'btn-polyline');
  pl.insertAdjacentHTML('beforeend', `<span class="hint">▸ ${tt('Analyze')}</span>`);
  pl.onclick = (e) => { e.stopPropagation(); closeRbPops(); ctxMenu.className = 'ctx-menu'; const items: [string, (() => void) | null][] = [[tt('From CAD reference (later)'), null],
    [`🔗 ${tt('Derived from Analyze')}`, () => { (document.querySelector('.tab[data-tab="analyze"]') as HTMLButtonElement)?.click(); toast(tt('Analyze a cylinder/cone (axis view), then 🔗 Derive › Derived median line (Polyline).')); }]];
    ctxMenu.innerHTML = items.map(([l, f], i) => `<button data-i="${i}" ${f ? '' : 'disabled'}>${l}</button>`).join('');
    ctxMenu.querySelectorAll<HTMLButtonElement>('button').forEach((x) => (x.onclick = () => { ctxMenu.classList.add('hidden'); items[+x.dataset.i!][1]?.(); }));
    const r = featMoreBtn.getBoundingClientRect(); ctxMenu.style.left = Math.min(r.left, innerWidth - 220) + 'px'; ctxMenu.style.top = r.bottom + 2 + 'px'; };
  const to = mi('Torus', typeName('Torus'), typeTitle('Torus')); to.dataset.ftype = 'Torus'; to.onclick = () => { closeRbPops(); startFitMode('Torus'); };
  const tw = rbSplit(to, () => splitMenu(featMoreBtn, 'Torus')); tw.classList.add('rb-mi-split');
  featMore.append(ff, pl, tw);
}
/** ⋯ More popups of the Start ribbon (fixed position below the button, closed by a click elsewhere or Esc) */
function closeRbPops() { document.querySelectorAll('.rb-pop').forEach((p) => p.classList.add('hidden')); document.querySelectorAll('[data-pop].on').forEach((b) => b.classList.remove('on')); }
document.querySelectorAll<HTMLButtonElement>('[data-pop]').forEach((b) => (b.onclick = (e) => {
  e.stopPropagation(); const pop = document.getElementById(b.dataset.pop!)!; const open = pop.classList.contains('hidden'); closeRbPops(); if (!open) return;
  pop.classList.remove('hidden'); b.classList.add('on'); const r = b.getBoundingClientRect();
  pop.style.left = Math.max(4, Math.min(r.left, innerWidth - pop.offsetWidth - 4)) + 'px'; pop.style.top = Math.min(r.bottom + 3, innerHeight - pop.offsetHeight - 4) + 'px';
}));
document.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest?.('.rb-pop')) closeRbPops(); });
document.querySelectorAll('.rb-pop').forEach((p) => p.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button:not(.split-dd)')) setTimeout(closeRbPops, 0); }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRbPops(); });
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
  d.innerHTML = `<div class="rv-head"><b>${tt('Load sample part')}</b><span class="note">${tt('Demo measurement data (scan/CT-like) – nominal geometry in samples/*.json')}</span><span style="flex:1"></span><button class="btn" id="sd-close" title="${tt('Close')}">✕</button></div>
    <div class="sd-grid">${samples!.filter((s) => !s.hidden).map((s) => `<button class="sample-card" data-key="${s.key}"><img src="./samples/${s.thumb}" alt="" loading="lazy"><span class="sc-t">${s.name}</span>
      <span class="sc-d">${s.description}</span><span class="sc-m">${s.kind} · ${(s.triangles / 1000).toFixed(0)} k ${tt('triangles')} · ${(s.bytes / 1048576).toFixed(1)} MB</span></button>`).join('')}</div>`;
  d.classList.remove('hidden');
  ($('#sd-close') as HTMLButtonElement).onclick = () => d.classList.add('hidden');
  if (!d.dataset.ovb) { d.dataset.ovb = '1'; const c = () => d.classList.add('hidden'); bindSwipeClose(d, c); bindEscClose(d, c);
    document.addEventListener('pointerdown', (e) => { if (!d.classList.contains('hidden') && !d.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('#btn-sample')) c(); }, true); }
  d.querySelectorAll<HTMLButtonElement>('.sample-card').forEach((b) => (b.onclick = () => loadSample(samples!.find((s) => s.key === b.dataset.key)!)));
}
$('#btn-sample').onclick = () => openSamples();
$('#btn-csv').onclick = () => download('pruefmerkmale.csv', controlsCSV(state.controls, featMap(), ctx));
$('#btn-report').onclick = () => makeReport();
$('#btn-report2').onclick = () => makeReport();
// help/docs overlay: big ✕, tap outside (backdrop) and Esc close it (iOS: no hardware Esc → backdrop + ✕)
{ const hv = $('#help-view'), bd = $('#help-backdrop');
  new MutationObserver(() => bd.classList.toggle('hidden', hv.classList.contains('hidden'))).observe(hv, { attributes: true, attributeFilter: ['class'] });
  bd.addEventListener('click', () => hv.classList.add('hidden'));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !hv.classList.contains('hidden')) { hv.classList.add('hidden'); e.stopPropagation(); } }, true);
  bindSwipeClose(hv, () => hv.classList.add('hidden'));
  pinLayout('#app, #workspace, #scene, #viewport'); }
$('#btn-toggle-labels').onclick = () => { state.showLabels = !state.showLabels; renderScene(); renderRibbon(); syncViewToggles(); };
$('#btn-csv-feat').onclick = () => download('merkmale.csv', featureCSV(state.features, ctx));
$('#btn-delete-feat').onclick = () => deleteSelection();
document.getElementById('btn-toggle-wcs')!.onclick = () => setWcsVisible(!wcsVisible); document.getElementById('btn-toggle-wcs')!.classList.toggle('on', localStorage.getItem('mw3d-wcs') === '1');
document.getElementById('btn-center-wcs')!.onclick = () => centerOnWcs();
$('#btn-props').onclick = () => propsSelection();
/** 0.34: ONE Properties and ONE Delete in the Start ribbon – they act on the current selection: a coordinate system
 *  (tree) or a feature/control. Global (WCS) can neither be edited nor deleted. */
const csSelected = () => state.csSel != null && state.csSel !== 0 && state.csys.some((c) => c.id === state.csSel);
function propsSelection() {
  if (csSelected()) { csEditStart(state.csSel!); return; }
  const f = state.features.find((x) => x.id === state.sel[0]); if (f && state.sel.length === 1) openFeatureProps(f); else toast(tt('Select one feature or coordinate system first (tree or 3D view).'));
}
function deleteSelection() {
  if (csSelected()) { csDelete(state.csSel!); return; }
  if (!state.sel.length && state.selControl == null) { toast(tt('Select a feature, control or coordinate system first.')); return; }
  deleteSelected();
}
$('#btn-toggle-prims').onclick = () => { state.showPrims = !state.showPrims; renderScene(); renderRibbon(); syncViewToggles(); };
$('#btn-toggle-wire').onclick = () => toggleWire();
$('#btn-toggle-curves').onclick = () => toggleCurves();
$('#btn-view-center').onclick = () => centerOn();
$('#btn-view-fit').onclick = () => viewer.view('fit');
$('#btn-toggle-pts').onclick = () => { state.colorPts = !state.colorPts; if (!state.colorPts) state.usedPts.clear(); renderScene(); renderRibbon(); };
$('#btn-toggle-aux').onclick = () => { state.colorAux = !state.colorAux; if (!state.colorAux) state.usedAux.clear(); renderScene(); renderRibbon(); };

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
/** Desktop navigation pause (Space): all interaction tools are suspended, the mouse only rotates/pans/zooms; Space
 *  again resumes exactly the same tool state (mode, panel, selection are not touched). */
let navPaused = false;
function setNavPause(on: boolean) {
  navPaused = on; document.body.classList.toggle('nav-pause', on);
  if (on) { painting = false; viewer.controls.enabled = true; viewer.showCursor(null, 1); clearAuxHover(); }
  let el = document.querySelector<HTMLElement>('#nav-pause-ind');
  if (on && !el) { el = document.createElement('div'); el.id = 'nav-pause-ind'; el.title = tt('Navigation pause: tools are suspended, the mouse rotates/pans/zooms freely. Press Space again to continue with the same tool.');
    el.textContent = '🧭 ' + tt('Navigation (Space to resume)'); el.onclick = () => setNavPause(false); canvas.parentElement!.appendChild(el); }
  if (!on) el?.remove();
  status(on ? tt('Navigation pause – Space resumes the tool.') : tt('Tool resumed.'));
}
const isTyping = (t: EventTarget | null) => { const e = t as HTMLElement | null; return !!e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || e.isContentEditable); };
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' && e.key !== ' ') return;
  if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || isPhone() || !matchMedia('(pointer: fine)').matches) return;
  e.preventDefault(); e.stopImmediatePropagation(); if (e.repeat) return;
  (document.activeElement as HTMLElement | null)?.blur?.();
  setNavPause(!navPaused);
}, true);
window.addEventListener('keyup', (e) => { if ((e.code === 'Space' || e.key === ' ') && !isTyping(e.target) && !isPhone()) e.preventDefault(); }, true);
canvas.addEventListener('pointerdown', (e) => {
  if (navPaused) { down = null; return; }
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
  if (navPaused) return;
  if (cv.drag) { curveDragMove(e.clientX, e.clientY); return; }
  if (e.pointerType === 'mouse' && !e.buttons) curveHover(e.clientX, e.clientY);
  const desk = e.pointerType === 'mouse';
  if (pe.tool === 'erase') { const h = viewer.pick(e.clientX, e.clientY); lastHit = h; viewer.showCursor(h, pe.radius, desk); if (painting && h) pePaint(h); return; }
  if (state.mode?.kind === 'fit' && state.mode.method === 'Klick' && desk && !e.buttons) {
    const h = viewer.pick(e.clientX, e.clientY); lastHit = h;
    // Click & grow: pick circle = seed area of the region growing (also the plane/wall transition window for circles)
    viewer.showCursor(h, pickR(), true);
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
canvas.addEventListener('pointerup', (e) => { if (navPaused) { rdown = null; return; } if (e.button !== 2 || !rdown) return; const d = Math.hypot(e.clientX - rdown.x, e.clientY - rdown.y); rdown = null;
  if (d > 6) return; if (pe.tool === 'curve' && curveDraft.length > 1) { curveFinish(); return; } window.dispatchEvent(new CustomEvent('mw-rclick')); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerleave', (e) => { if ((e.pointerType !== 'mouse' || state.preview) && state.mode?.kind === 'fit' && state.mode.method === 'Klick') return; // keep the seed feedback of the tap/click (touch; busy overlay over the canvas)
  if (!painting) { viewer.showCursor(null, 1); clearAuxHover(); } });
let lastHit: Hit | null = null;
/** Automatic pick radius for display: 6 × median edge length of the mesh (same rule as the worker's seed patch). */
let autoPick: { uuid: string; r: number } | null = null;
function pickR(): number {
  if (state.opts.pick > 0) return state.opts.pick;
  const m = viewer.model; if (!m) return 1;
  if (autoPick?.uuid === m.geometry.uuid) return autoPick.r;
  const g = m.geometry, P = g.attributes.position.array as ArrayLike<number>, I = g.index?.array as ArrayLike<number> | undefined, nt = I ? I.length / 3 : P.length / 9, L: number[] = [];
  const step = Math.max(1, Math.floor(nt / 3000));
  for (let t = 0; t < nt; t += step) { const a = I ? I[3 * t] : 3 * t, b = I ? I[3 * t + 1] : 3 * t + 1; L.push(Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2])); }
  L.sort((x, y) => x - y); autoPick = { uuid: g.uuid, r: +(6 * (L[L.length >> 1] || 0.2)).toFixed(2) }; return autoPick.r;
}
function setPickR(v: number | 0) {
  state.opts.pick = v > 0 ? +Math.min(Math.max(v, 0.05), (state.data?.diag ?? 1000) / 4).toFixed(v < 1 ? 2 : 1) : 0; localStorage.setItem('mw3d-pick', String(state.opts.pick));
  for (const el of document.querySelectorAll<HTMLInputElement>('.cp-pick-v')) el.value = state.opts.pick ? String(state.opts.pick) : '';
  for (const el of document.querySelectorAll<HTMLInputElement>('.cp-pick-v')) el.placeholder = `${tt('auto')} ${pickR()}`;
  if (lastHit && areaMode()) viewer.showCursor(lastHit, pickR(), true);
  status(tt('Pick radius r = {0} mm{1} – seed area of Click & grow (mouse wheel; empty = automatic).', pickR(), state.opts.pick ? '' : ' (' + tt('auto') + ')'));
}
/** Pinsel aktiv (Fit-Pinsel oder Polygon-Radierer)? Dann ändert das Mausrad den Radius, Strg+Rad zoomt. */
const brushActive = () => pe.tool === 'erase' || (state.mode?.kind === 'fit' && state.mode.method === 'Pinsel');
const areaMode = () => state.mode?.kind === 'fit' && state.mode.method === 'Klick';
function setBrushRadius(v: number) {
  v = +Math.min(Math.max(v, 0.05), (state.data?.diag ?? 1000) / 2).toFixed(v < 1 ? 2 : 1);
  if (pe.tool === 'erase') { pe.radius = v; for (const id of ['#pe-rad-n', '#pe-rad-r']) { const el = document.querySelector<HTMLInputElement>(id); if (el) el.value = String(v); } }
  else { state.opts.brush = v; const el = document.querySelector<HTMLInputElement>('#d-brush'); if (el) el.value = String(v); const mb = document.querySelector('#mb-brush-r'); if (mb) mb.textContent = String(v); }
  if (lastHit) viewer.showCursor(lastHit, v, true);
  status(tt('Brush radius {0} mm (mouse wheel; Space = navigation).', v));
}
// 0.38 Pick-Modus: in der Feature-Erstellung (Auto/typisiert, Klick & Wachsen) und bei Pinsel/Radierer ändert die Maus die
// Ansicht nicht; das Mausrad ändert den Pick-/Pinselradius. Leertaste = Navigation (und zurück).
registerPickTool({ name: 'erase', active: () => pe.tool === 'erase', wheel: (d) => setBrushRadius(pe.radius * Math.pow(1.1, d)) });
registerPickTool({ name: 'brush', active: () => state.mode?.kind === 'fit' && state.mode.method === 'Pinsel', wheel: (d) => setBrushRadius(state.opts.brush * Math.pow(1.1, d)) });
registerPickTool({ name: 'grow', active: () => areaMode(), wheel: (d) => setPickR(pickR() * Math.pow(1.1, d)) });
installPickMode(canvas.parentElement!, viewer.controls, () => navPaused);
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
        const r = await engine.call<any>({ op: 'grow', tri: h.tri, point: h.point, maxAngleDeg: state.opts.maxAngleDeg, radius: state.opts.radius, type: m.type, seedR: state.opts.pick });
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
  if (navPaused) { down = null; return; }
  if ((e as any).cadHandled) { down = null; return; }
  if (painting) { painting = false; viewer.controls.enabled = true; down = null; scheduleBrushFit(); return; }
  if (cv.drag) { const d0 = down; down = null; const tap = d0 && Math.hypot(e.clientX - d0.x, e.clientY - d0.y) < 8; if (tap) cv.drag.moved = false; await curveDragEnd(); if (!tap) return; await curveClick(e.clientX, e.clientY); return; }
  if (!down || e.target !== canvas) { down = null; return; }
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
  down = null;
  if (moved > 8 || dt > 700) return;
  if (!state.mode && await curveClick(e.clientX, e.clientY)) return;
  const h = viewer.pick(e.clientX, e.clientY);
  if (!h) { if (!state.mode && !pe.tool) clearSelection(); return; }
  if (pe.tool === 'curve') curveAddPoint(h);
  else if (state.mode?.kind === 'fit' && state.mode.method === 'Klick' && auxPickArm) { const F = viewer.model!.geometry.index?.array, vs = F ? [F[3 * h.tri], F[3 * h.tri + 1], F[3 * h.tri + 2]] : [3 * h.tri];
    const pl = state.features.find((f) => f.type === 'Ebene' && f.measured && vs.some((v) => f.indices.includes(v)));
    if (pl) setAuxPlane(pl.id); else status(tt('No measured plane at this point – click a plane feature (or choose it in the list).')); }
  else if (state.mode?.kind === 'fit' && state.mode.method === 'Klick' && !e.shiftKey && !state.opts.multi && islandAt(h) >= 0) { islSel = islandAt(h); viewer.showCursor(null, 1); renderAll(); }
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
  state.preview = null; renderAll(); scheduleBrushFit(); status(tt('Brush stroke undone – {0} points marked.', state.brushCount));
}
/** 0.33 (F4): brush in one step – live fit of the painted points after each stroke (stats in the panel), ✓ creates directly */
/** ⚙ › Transparent: data object transparency (amount in %, Options › Display) */
const viewTrans = { on: false, amt: 60 };
let brushLive: Preview | null = null, brushLiveT = 0, brushLiveSeq = 0;
function scheduleBrushFit() {
  window.clearTimeout(brushLiveT); brushLive = null;
  if (!state.brushMask || !state.brushCount || state.mode?.kind !== 'fit' || (state.mode as FitMode).type === 'Freiformfläche') { renderModeBar(); return; }
  brushLiveT = window.setTimeout(async () => { const seq = ++brushLiveSeq, idx = brushIndices();
    try { const r = await engine.call<any>({ op: 'fit', indices: idx, type: (state.mode as FitMode).type });
      if (seq !== brushLiveSeq) return; brushLive = { fit: r.fit, indices: r.indices, candidates: r.candidates, method: 'Pinsel' }; }
    catch { brushLive = null; } renderModeBar(); }, 150);
}
function brushIndices(): Uint32Array { const idx = new Uint32Array(state.brushCount); let k = 0; state.brushMask!.forEach((v, i) => { if (v) idx[k++] = i; }); return idx; }
async function brushCreate() { await previewFromBrush(); if (state.preview?.method === 'Pinsel') await commitPreview(); }
function clearBrush() { brushLive = null; window.clearTimeout(brushLiveT); state.brushMask = state.data ? new Uint8Array(state.data.vertexCount) : null; state.brushCount = 0; brushUndo.length = 0; }
function clearSelectionAll() {
  const had = state.brushCount > 0 || !!state.preview;
  clearBrush(); state.preview = null; renderAll(); status(had ? tt('Selection cleared.') : tt('No selection.'));
}
/** 0.40: Pinsel-Ergänzung – die Punkte der aktuellen Vorschau werden in die Pinselmaske übernommen, Typ bleibt;
 *  weiter malen fügt hinzu, ✓ erzeugt das Merkmal aus beidem (ohne Wachsen). */
function brushAddToPreview() {
  const p = state.preview; if (state.mode?.kind !== 'fit' || !p || !state.data) return;
  const keep = p.indices, t = p.fit.type as GeomType; const m = state.mode; m.type = t; setMethod('Pinsel');
  const mask = state.brushMask!; for (const v of keep) mask[v] = 1; state.brushCount = keep.length;
  status(tt('Brush add: paint further points – the {0} points of the selection stay.', keep.length)); scheduleBrushFit(); renderAll();
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
  // Phase 1 step 2: feedback is exactly point count, form deviation and standard deviation (sizes etc. after ✓ in the tree/dialog)
  const m = p.fit, std = m.nurbs ? m.nurbs.std : m.rms;
  const pts = p.aux ? `${p.indices.length} <small class="cp-aux-n" title="${tt('Points on the auxiliary plane')}">+ ${p.aux.refId ? nameOf(p.aux.refId) : p.aux.indices.length + ' ' + tt('aux.')}</small>` : String(p.indices.length);
  const rows: [string, string, string][] = [[tt('Points'), pts, 'pts'], [m.nurbs ? tt('Surface profile') : formName(m.type), fmt(m.form), 'form'], [tt('Std. dev.'), fmt(std), 'std']];
  return `<span class="cp-type">${ICON[m.type] ?? ''} ${typeName(m.type)}</span>` + rows.map(([k, v, c]) => `<span class="cp-kv" data-kv="${c}"><small>${k}</small><b>${v}</b></span>`).join('');
}
function renderModeBar() {
  const spec = ctxSpec(); setCtx('mesh', spec); setCtx('tool', analysisSpec());
}
function ctxSpec(): CtxSpec | null {
  if (!state.data) return null;
  if (pe.tool === 'curve') return { title: `〰 ${tt('Draw curve')} · <b>${curveDraft.length}</b> ${tt('pts')}`,
    ok: { run: () => curveFinish(), disabled: curveDraft.length < 2, title: tt('Create curve') }, undo: { run: () => { curveDraft.pop(); renderAll(); }, disabled: !curveDraft.length }, cancel: { run: () => peExit() } };
  if (pe.tool === 'erase') return { title: `✧ ${tt('Magic eraser')}`, cls: 'brush',
    controls: `<label>r <input id="cp-rad" data-num="abs" type="number" min="0.1" step="0.1" value="${pe.radius}" inputmode="decimal"> mm</label><span><b>${peCount}</b> ${tt('pts')}</span>
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
  // selection method – the user's choice: Click & grow | Add region (same intelligence, every click adds a region) | Brush only
  // 0.40 Feature Builder: Hauptmodus „Smart Detect“ (= Klicken & Wachsen); Pinsel als Alternative unter „Erweitert“;
  // nach der Erkennung: Region hinzufügen (Original bleibt), Region entfernen, Pinsel-Ergänzung zum selben Merkmal
  const smart = `<button data-a="click" class="cp-smart ${m.method === 'Klick' && !state.opts.multi ? 'on' : ''}" title="${tt('Smart Detect: tap/click a face – the region grows from the seed area (pick circle) and the feature is detected (Auto) or fitted as the chosen type')}">✨ ${tt('Smart Detect')}</button>`;
  const seg = !p ? `<span class="cp-seg cp-selm">${smart}</span>`
    : `<span class="cp-seg cp-selm">${smart}<button data-a="addreg" class="${m.method === 'Klick' && state.opts.multi ? 'on' : ''}" title="${tt('Add region: the next click grows a further region and adds it – the original region stays; the union is fitted again (plane, cylinder, cone, sphere, circle, slot).')}">＋ ${tt('Add region')}</button><button data-a="brushadd" title="${tt('Brush add: paint further points onto the SAME feature (no region growing) – the current selection stays, ✓ creates the feature from both.')}">🖌＋ ${tt('Brush add')}</button></span>`;
  const type = `<select id="cp-type" title="${tt('Feature type')}">${typeOptions(p ? p.fit.type : m.type)}</select>`;
  // aux plane for circle / slot / line (also when Auto detected one): Full plane | Local ring (+ gap/width), All inside boundary
  const AUXT = ['Kreis', 'Langloch', 'Linie'], auxable = m.method === 'Klick' && !!p && AUXT.includes(p.fit.type); // 0.40: auch bei Smart Detect (Auto) ohne bisherige Hilfsebene // 0.33: only after a click actually detected a circle/slot/line
  const ao = state.opts.aux;
  // Phase 1 step 6: ▱ Auto (detected adjacent face) | ◎ Ring / ⊂⊃ Band zone (offset + width, shown live) | ▭ assigned plane
  const slotT = (p ? p.fit.type : m.type) === 'Langloch', isLine = (p ? p.fit.type : m.type) === 'Linie';
  const auxCtl = auxable ? `<span class="cp-seg cp-aux" title="${tt('Auxiliary plane: the circle/slot/line is the intersection of the wall with this plane')}"><button data-aux="auto" class="${ao === 'auto' ? 'on' : ''}" title="${tt('Auto: the detected adjacent planar face is the auxiliary plane')}">▱ ${tt('Auto')}</button><button data-aux="ring" class="${ao === 'ring' ? 'on' : ''}" title="${slotT ? tt('Band zone: only the plane points in a stadium band around the detected slot – offset from the edge and width in mm (shown in the 3D view)') : isLine ? tt('Band zone: only the plane points in a band along the detected line – offset and width in mm') : tt('Ring zone: only the plane points in an annulus around the detected circle – offset from the edge and width in mm (shown in the 3D view)')}">${slotT || isLine ? '⊂⊃ ' + tt('Band') : '◎ ' + tt('Ring')}</button><button data-aux="plane" class="${typeof ao === 'number' ? 'on' : ''}" title="${tt('Assigned plane: the circle/slot/line lies in a plane you already measured – only the wall is taken from the click, its points are projected onto that plane')}">▭ ${tt('Plane')}</button></span>`
    + (ao === 'ring' ? `<label title="${tt('Offset [mm]: distance of the zone from the detected edge')}">${tt('offset')} <input id="cp-rg" data-num="abs" type="number" min="0" step="0.1" value="${state.opts.ring.gap}" inputmode="decimal"></label><label title="${tt('Width [mm] of the zone')}">${tt('width')} <input id="cp-rw" data-num="abs" type="number" min="0.2" step="0.5" value="${state.opts.ring.width}" inputmode="decimal"></label>` : '')
    + (typeof ao === 'number' || auxPickArm ? auxPlaneSel(ao) : '') + (ao === 'none' ? `<span class="cp-hint">${tt('None (3D fit)')}</span>` : '') : '';
  const pick = `<span class="cp-pick" title="${tt('Pick radius [mm]: the circle at the cursor is the seed area of Click & grow – the region starts from the surface inside it. For circles/slots/lines place it across the edge between hole wall and plane (the transition must lie inside the circle). Desktop: Alt + mouse wheel. Empty = automatic (6 × mesh edge length).')}">◎ r <button type="button" data-pk="-">−</button><input class="cp-pick-v" data-num="abs" value="${state.opts.pick || ''}" placeholder="${tt('auto')} ${pickR()}" inputmode="decimal"><button type="button" data-pk="+">＋</button></span>`;
  const dsel = p && p.fit.type !== 'Abstand' && p.fit.type !== 'Winkel' && p.fit.type !== 'Linienzug'
    ? `<label class="cp-datum" title="${tt('Assign a datum label to the new feature directly (it can be changed later in the Feature dialog)')}">${tt('Datum')} <select id="cp-datum"><option value="">–</option>${DATUM_LETTERS.filter((l) => !state.features.some((g) => g.datum === l)).slice(0, 8).map((l) => `<option ${state.opts.newDatum === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : '';
  const ctl = m.method === 'Klick'
    ? `${seg}${p ? type : ''}${dsel}${(p ? p.fit.type : m.type) === 'Linie' ? `<span class="cp-seg" title="${tt('Which adjacent face is the auxiliary plane')}"><button data-side="0" class="${state.opts.lineSide === 0 ? 'on' : ''}">${tt('Aux: clicked face')}</button><button data-side="1" class="${state.opts.lineSide === 1 ? 'on' : ''}">${tt('Aux: adjacent face')}</button></span>` : ''}${p && MULTI_TYPES.includes(p.fit.type) && !p.aux ? `${p.regions && p.regions.length > 1 ? `<span class="cp-hint">${p.regions.length} ${tt('regions')}</span>` : ''}${p.regions || regionOps.length ? `<button data-a="unregion" title="${tt('Undo the last added or removed region')}">↶ ${tt('Region')}</button>` : ''}` : ''}${p && !p.aux && p.method === 'Klick' && p.fit.type !== 'Freiformfläche' ? `<button data-a="subreg" class="${state.opts.sub ? 'on' : ''}" title="${tt('Remove region: the next tap/click grows a region there (same intelligence as Click & grow) and REMOVES it from the selection – e.g. a bump, a burr or a wrongly grown strip. Tapping the selected surface itself removes a disc of brush size. ↶ Region undoes. Tap again to switch off.')}">− ${tt('Remove region')}</button>${removedSets.length ? `<span class="cp-hint">${tt('{0} removed', removedSets.length)}</span>` : ''}` : ''}${auxCtl}`
    : `${seg}${type}${dsel}<label>r <input id="cp-brush" data-num="abs" type="number" min="0.05" step="0.1" value="${state.opts.brush}" inputmode="decimal"> mm</label>
       <button data-a="paint" class="${brushErase ? '' : 'on'}">🖌 ${tt('Paint')}</button><button data-a="erase" class="${brushErase ? 'on' : ''}" title="${tt('Eraser (or Shift while painting)')}">🧽 ${tt('Erase')}</button>
       <span><b>${state.brushCount}</b> ${tt('pts')}</span><button data-a="clear" class="warn" ${state.brushCount ? '' : 'disabled'}>🗑</button>`;
  // collapsible 'Parameters': the unified extraction parameters (identical in Re-extraction)
  const ptype = (p ? p.fit.type : m.type) as string, isPl = ptype === 'Ebene', x = state.opts.ex;
  const glim = ''; // 0.33 (Martin 15:49): Growth limit r removed (odd results when clicking a new spot)
  const fullPars = !p?.aux && !['Abstand', 'Winkel', 'Linienzug', 'Freiformfläche'].includes(ptype) && (p ? p.method === 'Klick' : m.method === 'Klick'); // 0.33: brush = painted area as-is (no outer contour)
  const bfrom = fullPars ? (GEOM_ZONE.includes(ptype) || ptype === 'auto' ? `<label title="${tt('Boundary from: “Point selection” = the grown region(s) as clicked; “Fitted geometry” = a zone around the fitted shape (e.g. cylinder radius ± search distance over the axial extent of the points, cone, sphere cap) – collects all points of that surface, also where growing stopped. Exclusion distance ± then shrinks (+) or extends (−) the zone at its ends. Live preview; the zone is drawn transparent.')}">${tt('Boundary from')} <select data-exs="zoneSrc"><option value="points" ${x.zoneSrc !== 'geom' ? 'selected' : ''}>${tt('Point selection')}</option><option value="geom" ${x.zoneSrc === 'geom' ? 'selected' : ''}>${tt('Fitted geometry')}</option></select></label>` : '') : ''; // 0.32: Boundary from directly visible
  const pars = !fullPars && !glim ? '' : `<details class="cp-params" ${cpParamsOpen ? 'open' : ''}><summary title="${tt('Extraction parameters – the same set as in Re-extraction (Dialog). Changes update the preview live.')}">⚙ ${tt('Advanced parameters')}</summary><div class="cp-pg">${!p && m.method === 'Klick' ? `<span class="cp-adv-first">${type}${pick}<button data-a="brush" title="${tt('Brush: paint exactly the points to use – no region growing (alternative creation path)')}">🖌 ${tt('Brush')}</button></span>` : ''}${glim}${state.opts.fill.on && ((p && p.fit.type === 'Ebene' && !p.aux) || (auxable && ao === 'auto')) ? `<label title="${tt('Search distance ± [mm]: thickness of the search region normal to the plane – points farther away are not part of the face (same parameter as in Re-extraction)')}">${tt('Search distance ±')} <input id="cp-fband" data-num="abs" value="${state.opts.fill.band ?? ''}" placeholder="${tt('auto')}${p?.bandUsed && state.opts.fill.band == null ? ' ' + fmt(p.bandUsed, 2) : ''}" inputmode="decimal" style="width:5.5em"> mm</label><button data-a="fillraised" class="${state.opts.fill.exRaised ? 'on' : ''}" title="${raisedTip()}">⛰ ${tt('Exclude raised')}${p?.raised?.length ? ` (${p.raised.length})` : ''}</button>${raisedHelp()}` : ''}${fullPars ? `
    ${isPl || TRIM_TYPES.includes(ptype) ? smoothCtl('cp-smooth') : ''}

    ${isPl || (GEOM_ZONE.includes(ptype) && x.zoneSrc === 'geom') ? `<label title="${exclTip()}">${tt('Boundary excl.')} <input data-exn="inset" data-num="${isPl ? 'abs' : 'signed'}" value="${x.inset}" inputmode="${isPl ? 'decimal' : 'text'}"> mm<button type="button" class="help-q" data-doc-sec="excl" title="${tt('Boundary exclusion distance – documentation')}">?</button></label>` : ''}
    ${m.method === 'Klick' ? `<label title="${tt('Normal angle: region growing from the click stops where the surface normal bends more than this angle (edge, fillet, chamfer, adjacent face). Smaller = stops earlier; larger = grows over soft transitions. The normal is robust and edge-aware: for every triangle it comes from a plane fit over its neighbourhood (1.3 × edge length) that keeps to the face the point lies on – scan noise does not stop growing and edges stay sharp. Computed on demand while growing. Further areas: ＋ Add region.')}">${tt('Normal angle')} <input id="cp-nang" data-num="abs" value="${state.opts.maxAngleDeg}" inputmode="decimal" style="width:3.5em">°<button type="button" class="help-q" data-doc-sec="nangle" title="${tt('Normal angle – documentation')}">?</button></label>` : ''}
  ` : ''}</div></details>`;
  return {
    title: `${tt('Feature Builder')} · ${p ? typeName(p.fit.type as GeomType) : m.method === 'Klick' ? (m.type === 'auto' ? tt('Smart Detect') : typeName(m.type)) : tt('Brush')}`, cls: m.method === 'Pinsel' ? 'brush' : '',
    controls: (isPl && p && !p.aux && p.method === 'Klick' ? islandsHTML(p.islands ?? []) : '') + ctl + bfrom + pars, stats: p ? previewStats(p) : m.method === 'Pinsel' ? (brushLive ? previewStats(brushLive) : state.brushCount ? `<span class="cp-kv"><small>${tt('Points')}</small><b>${state.brushCount}</b></span>` : `<span class="cp-hint">${tt('Paint the area – the fit is shown here, ✓ creates the feature')}</span>`) : hoverType ? `<span class="cp-hint">${tt('Detected')}: <b>${typeName(hoverType)}</b></span>` : '',
    bind: (el) => {
      el.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) => (b.onclick = () => { const a = b.dataset.a;
        if (a === 'subreg') { state.opts.sub = !state.opts.sub; if (state.opts.sub) state.opts.multi = false; renderModeBar(); renderHint(); status(state.opts.sub ? tt('Remove region: tap the area to remove.') : ''); return; }
        if (a === 'click' || a === 'addreg') { state.opts.sub = false; const was = state.opts.multi; state.opts.multi = a === 'addreg'; if (m.method !== 'Klick') setMethod('Klick'); else if (was !== state.opts.multi) { renderModeBar(); renderHint(); } } else if (a === 'brush') setMethod('Pinsel'); else if (a === 'brushadd') brushAddToPreview(); else if (a === 'paint' || a === 'erase') { brushErase = a === 'erase'; renderModeBar(); renderDialog(); } else if (a === 'clear') clearSelectionAll(); else if (a === 'multi') { state.opts.multi = !state.opts.multi; renderModeBar(); renderHint(); } else if (a === 'fillraised') { state.opts.fill.exRaised = !state.opts.fill.exRaised; applyExtract().then(() => renderAll()); } else if (a === 'fill') { setContour(!state.opts.fill.on); applyExtract().then(() => renderAll()); } else if (a === 'unregion') { const snap = regionSnaps.pop(); if (snap) { if (regionOps.pop() === 'sub') removedSets.pop(); state.preview = snap; renderAll(); return; } const pv = state.preview!; const op = regionOps.pop() ?? 'add'; let rg = baseRegions(pv); if (op === 'sub') removedSets.pop(); else rg = rg.slice(0, -1); refitRegions(rg.length ? rg : baseRegions(pv), pv.hit).then(() => (extractActive() ? applyExtract() : undefined)).then(() => renderAll()); } }));
      el.querySelectorAll<HTMLButtonElement>('[data-pk]').forEach((b) => (b.onclick = () => setPickR(pickR() * (b.dataset.pk === '+' ? 1.25 : 0.8))));
      el.querySelectorAll<HTMLInputElement>('.cp-pick-v').forEach((i) => (i.onchange = () => { const v = parseNum(i.value); setPickR(v && v > 0 ? v : 0); }));
      el.querySelectorAll<HTMLButtonElement>('[data-side]').forEach((b) => (b.onclick = async () => { state.opts.lineSide = Number(b.dataset.side) as 0 | 1;
        if (state.preview?.hit && state.preview.fit.type === 'Linie') { try { await previewWithAux(state.preview.hit, 'Linie'); } catch (e: any) { toast(e.message); } } renderAll(); }));
      el.querySelector<HTMLSelectElement>('#cp-type')!.onchange = (e) => { const v = (e.target as HTMLSelectElement).value as GeomType | 'auto'; (state.mode as FitMode).type = v; if (state.preview) refitPreview(v); else renderAll(); };
      const auxRefresh = () => { const pv = state.preview; if (pv?.hit && pv.aux && AUXT.includes(pv.fit.type)) previewWithAux(pv.hit, pv.fit.type as 'Kreis' | 'Langloch' | 'Linie').catch((e) => toast(e.message)).then(() => renderAll()); else renderAll(); };
      el.querySelectorAll<HTMLButtonElement>('button[data-aux]').forEach((b) => (b.onclick = () => { const a = b.dataset.aux!;
        if (a === 'plane') { const pls = state.features.filter((f) => f.type === 'Ebene' && f.measured); const last = pls.find((f) => f.id === lastAuxPlane) ?? pls.at(-1);
          if (!last) { toast(tt('Measure the plane first (Plane), then assign it here.')); return; } state.opts.aux = last.id; lastAuxPlane = last.id; }
        else state.opts.aux = a as 'auto' | 'ring';
        auxRefresh(); }));
      const apl = el.querySelector<HTMLSelectElement>('#cp-auxpl'); if (apl) apl.onchange = () => { if (!apl.value) return; state.opts.aux = lastAuxPlane = +apl.value; auxPickArm = false; auxRefresh(); };
      const apk = el.querySelector<HTMLButtonElement>('[data-auxpick]'); if (apk) apk.onclick = () => { auxPickArm = !auxPickArm; if (auxPickArm) status(tt('Click the plane to use as aux plane (3D view or tree).')); renderModeBar(); };
      for (const [id, k] of [['#cp-rg', 'gap'], ['#cp-rw', 'width']] as const) { const ie = el.querySelector<HTMLInputElement>(id); if (ie) ie.onchange = () => { const x = Number(ie.value.replace(',', '.')); if (isFinite(x) && x >= 0) { state.opts.ring[k] = k === 'width' ? Math.max(0.2, x) : x; auxRefresh(); } }; }
      const fb = el.querySelector<HTMLInputElement>('#cp-fband'); if (fb) fb.onchange = () => { const x = parseNum(fb.value); if (x == null || x === 0) { state.opts.fill.band = null; extractLive(); } else if (isFinite(x) && x > 0) { state.opts.fill.band = x; extractLive(); } };
      const dz = el.querySelector<HTMLSelectElement>('#cp-datum'); if (dz) dz.onchange = () => { state.opts.newDatum = dz.value; };
      bindIslands(el); bindSmooth(el, '#cp-smooth');
      const pd = el.querySelector<HTMLDetailsElement>('details.cp-params'); if (pd) pd.ontoggle = () => { cpParamsOpen = pd.open; };
      el.querySelectorAll<HTMLInputElement>('[data-ex]').forEach((c) => (c.onchange = () => { const k = c.dataset.ex!;
        if (k === 'contour') setContour(c.checked);
        else (state.opts.ex as any)[k] = c.checked;
        extractLive(); }));
      el.querySelectorAll<HTMLInputElement>('[data-exn]').forEach((c) => { c.onchange = () => { const v = parseNum(c.value); if (v != null && isFinite(v) && (v >= 0 || (c.dataset.exn === 'inset' && c.dataset.num === 'signed'))) { (state.opts.ex as any)[c.dataset.exn!] = v; extractLive(); } };
        c.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); c.onchange?.(new Event('change')); } }); });
      el.querySelectorAll<HTMLSelectElement>('[data-exs]').forEach((c) => (c.onchange = () => { (state.opts.ex as any)[c.dataset.exs!] = c.value; extractLive(); }));
      const ar = el.querySelector<HTMLInputElement>('#cp-area'); if (ar) ar.onchange = () => { const x = Number(ar.value.replace(',', '.')); if (isFinite(x) && x >= 0) { state.opts.radius = x; renderDialog(); } };
      const na = el.querySelector<HTMLInputElement>('#cp-nang'); if (na) na.onchange = () => { const v = parseNum(na.value); if (v != null && v > 0 && v < 90) { state.opts.maxAngleDeg = v; const pv = state.preview; if (pv?.hit && pv.method === 'Klick' && !pv.regions) previewByClick(pv.hit); } };
      const br = el.querySelector<HTMLInputElement>('#cp-brush'); if (br) br.onchange = () => { const x = Number(br.value.replace(',', '.')); if (x > 0) setBrushRadius(x); };
    },
    ok: p ? { run: commitPreview, title: tt('Create feature (Enter)') } : m.method === 'Pinsel' ? { run: brushCreate, disabled: !state.brushCount, title: tt('Create feature from the painted points (Enter)') } : null,
    undo: m.method === 'Pinsel' ? { run: undoBrush, disabled: !brushUndo.some((x) => x.length), title: tt('Undo brush stroke (Ctrl+Z)') } : null,
    cancel: p ? { run: discardPreview, title: tt('Discard preview (Esc)') } : { run: stopMode, title: tt('Exit mode (Esc)') },
  };
}

/** Boundary smoothing input (Advanced): empty = auto, 0 = off */
function smoothCtl(id: string) {
  return `<label title="${tt('Boundary smoothing [mm] (display only): the boundary of the selection is drawn as a smooth contour on the fitted surface instead of the triangle zigzag; every point moves at most this far. Empty = automatic (0.7 × mesh edge length, max. 0.5 mm), 0 = off. Applies to the preview and all features.')}">${tt('Boundary smoothing')} <input id="${id}" class="smooth-in" data-num="abs" value="${smoothTol ?? ''}" placeholder="${tt('auto')}" inputmode="decimal"> mm</label>`;
}
function bindSmooth(el: ParentNode, id: string) {
  const i = el.querySelector<HTMLInputElement>(id); if (!i) return;
  i.onchange = () => { const t = i.value.trim(); const v = t === '' ? null : parseNum(t); if (v === null || (isFinite(v) && v >= 0)) { setSmoothTol(v); renderAll(); } else i.value = String(smoothTol ?? ''); };
}
const islIcon = (I: Island) => (I.kind === 'raised' ? '▮' : I.kind === 'bump' ? '▲' : I.rim ? '◎' : '◯');
const islKind = (I: Island) => (I.kind === 'raised' ? tt('raised feature') : I.kind === 'bump' ? tt('local bump') : I.rim ? tt('hole + raised rim') : tt('hole / opening'));
const islCanInc = (_I: Island) => true; // 0.38: every island removable (holes are then shown closed)
const islHoleWarn = (I: Island) => I.kind === 'hole' && !I.rim;
/** Plane · All inside boundary: detected islands (auto) – tap one (here or in 3D) → “Not an island” / refine its extent */
function islandsHTML(list: Island[]) {
  const ex = list.filter((I) => !I.inc).length, S = list[islSel];
  const chips = list.map((I, i) => `<button type="button" class="isl-chip${I.inc ? ' inc' : ''}${i === islSel ? ' on' : ''}" data-isl="${i}" title="${islKind(I)} · ${I.n} ${tt('pts')}${I.inc ? ' · ' + tt('not an island (points included)') : ''}">${islIcon(I)}${I.id}</button>`).join('');
  const det = S ? `<div class="isl-det"><b>${tt('Island')} ${S.id}</b> ${islKind(S)} · Ø≈${fmt(2 * S.r, 1)} · h ${fmt(S.h, 2)} mm · ${S.n} ${tt('pts')}
    <span class="cp-seg"><button type="button" data-islinc="0" class="${S.inc ? '' : 'on'}" title="${tt('Island: its points are excluded from the plane')}">${tt('Island')}</button><button type="button" data-islinc="1" class="${S.inc ? 'on' : ''}" title="${tt('Not an island: its points belong to the plane again (a hole is shown closed – the plane contour no longer has this opening)')}">${tt('Not an island')}</button></span>${islHoleWarn(S) ? `<span class="isl-warn" title="${tt('No surface points inside – this is probably a real hole/bore. Removing it closes the opening in the plane contour.')}">⚠ ${tt('probably a hole/bore')}</span>` : ''}
    <label title="${tt('Refine the island: grow (+) or shrink (−) its excluded zone by this distance [mm]')}">${tt('Refine')} ± <input id="cp-islm" data-num="signed" value="${S.m}" inputmode="text"> mm</label></div>` : '';
  const man = state.opts.fill.man.map((I, k) => `<button type="button" class="isl-chip man" data-islman="${k}" title="${tt('Island added by tap, Ø {0} mm – click to remove it', fmt(2 * I.r, 1))}">✚${k + 1} ✕</button>`).join('');
  const addB = `<button type="button" class="isl-chip add${state.opts.addIsl ? ' on' : ''}" data-isladd="1" title="${tt('Add an island: tap the plane where detection was too generous – a disc of the brush diameter (Ø {0} mm) is excluded', fmt(2 * state.opts.brush, 1))}">＋ ${tt('Island')}</button>`;
  // 0.38: collapsible (collapsed by default), summary = count in one line; expanded the chips wrap (no scrolling),
  // beyond 20 islands a compact dropdown list replaces the chips
  const many = list.length > 20;
  const pickL = many ? `<select class="isl-sel" data-islsel="1" title="${tt('Select an island')}"><option value="-1">${tt('Island…')}</option>${list.map((I, i) => `<option value="${i}" ${i === islSel ? 'selected' : ''}>${islIcon(I)}${I.id} ${islKind(I)}${I.inc ? ' · ' + tt('not an island') : ''}</option>`).join('')}</select>` : chips;
  const sum = `🏝 ${tt('Islands')} ${list.length}${ex !== list.length ? ` (${tt('{0} excluded', ex)})` : ''}`;
  return `<details class="cp-isl" ${islOpen || islSel >= 0 ? 'open' : ''}><summary class="cp-isl-h" title="${tt('Islands inside the outer contour, detected automatically: ◯ hole/opening, ◎ hole with raised rim, ▲ local bump, ▮ raised feature. Excluded from the plane unless marked “Not an island”. Tap an island (here or in the 3D view) to change it.')}">${sum}</summary><div class="cp-isl-b">${pickL}${man}${addB}${det}</div></details>`;
}
let islOpen = false;
function islandChoice(I: Island): IslandChoice {
  const L = state.opts.fill.isl; let o = L.find((q) => Math.hypot(q.c[0] - I.c[0], q.c[1] - I.c[1], q.c[2] - I.c[2]) < Math.max(1, 0.5 * I.r));
  if (!o) { o = { c: [...I.c] }; L.push(o); } return o;
}
function bindIslands(el: ParentNode) {
  el.querySelectorAll<HTMLButtonElement>('[data-islman]').forEach((b) => (b.onclick = () => { state.opts.fill.man.splice(Number(b.dataset.islman), 1); extractLive(); }));
  el.querySelectorAll<HTMLButtonElement>('[data-isladd]').forEach((b) => (b.onclick = () => { state.opts.addIsl = !state.opts.addIsl; state.opts.sub = false; renderModeBar(); status(state.opts.addIsl ? tt('Add island: tap the plane – a disc of the brush diameter is excluded.') : ''); }));
  const dt = el.querySelector<HTMLDetailsElement>('details.cp-isl'); if (dt) dt.ontoggle = () => { islOpen = dt.open; };
  const list = state.preview?.islands; if (!list) return;
  const sel = el.querySelector<HTMLSelectElement>('[data-islsel]'); if (sel) sel.onchange = () => { islSel = Number(sel.value); renderAll(); };
  el.querySelectorAll<HTMLButtonElement>('[data-isl]').forEach((b) => (b.onclick = () => { const i = Number(b.dataset.isl); islSel = islSel === i ? -1 : i; renderAll(); }));
  el.querySelectorAll<HTMLButtonElement>('[data-islinc]').forEach((b) => (b.onclick = () => { const I = list[islSel]; if (!I) return; islandChoice(I).inc = b.dataset.islinc === '1'; extractLive(); }));
  const m = el.querySelector<HTMLInputElement>('#cp-islm'); if (m) m.onchange = () => { const I = list[islSel]; const v = parseNum(m.value); if (!I || v == null || !isFinite(v)) return; islandChoice(I).m = v; extractLive(); };
}
/** island under a tap in the 3D view (ray from the camera through the hit, intersected with the preview plane) */
function islandAt(h: Hit): number {
  const p = state.preview; if (!p?.islands?.length || p.fit.type !== 'Ebene') return -1;
  const n = p.fit.normal, c = p.fit.center, cam = viewer.camera.position, d = [h.point[0] - cam.x, h.point[1] - cam.y, h.point[2] - cam.z];
  const den = d[0] * n[0] + d[1] * n[1] + d[2] * n[2]; if (Math.abs(den) < 1e-9) return -1;
  const t = ((c[0] - cam.x) * n[0] + (c[1] - cam.y) * n[1] + (c[2] - cam.z) * n[2]) / den, q = [cam.x + t * d[0], cam.y + t * d[1], cam.z + t * d[2]];
  const [u, v] = basis(unit(n as Vec3)), P = (a: number[]) => [(a[0] - c[0]) * u[0] + (a[1] - c[1]) * u[1] + (a[2] - c[2]) * u[2], (a[0] - c[0]) * v[0] + (a[1] - c[1]) * v[1] + (a[2] - c[2]) * v[2]];
  const [qx, qy] = P(q);
  const inside = (L: number[][]) => { let w = false; for (let i = 0, j = L.length - 1; i < L.length; j = i++) { const [xi, yi] = P(L[i]), [xj, yj] = P(L[j]); if ((yi > qy) !== (yj > qy) && qx < ((xj - xi) * (qy - yi)) / (yj - yi) + xi) w = !w; } return w; };
  let best = -1, ba = Infinity;
  p.islands.forEach((I, i) => { let w = false; for (const L of I.loops) if (inside(L)) w = !w; if (w && I.area < ba) { ba = I.area; best = i; } });
  if (best < 0) p.islands.forEach((I, i) => { const d = Math.hypot(q[0] - I.c[0], q[1] - I.c[1], q[2] - I.c[2]) - I.r; if (d < 0.5 && d < ba) { ba = d; best = i; } }); // just outside its edge
  return best;
}
// ------------------------------------------------------------------ Vorschau
const usesAux = (t: GeomType | 'auto') => (t === 'Kreis' || t === 'Langloch' || t === 'Linie') && state.opts.aux !== 'none';
const usesAuxType = usesAux;
/** Hilfsebenen-Extraktion im Worker: Kreis/Langloch (Wand in Ebene) bzw. Linie (Kante, Seite wählbar). */
/** 'Use existing plane' for circle/slot/line: select from the planes in the tree or 🎯 pick one in the 3D view. */
let auxPickArm = false, lastAuxPlane = -1;
function auxPlaneSel(ao: unknown): string {
  const pls = state.features.filter((f) => f.type === 'Ebene' && f.measured);
  return `<label class="cp-auxpl" title="${tt('Assigned aux plane: pick a measured plane in the list, or 🎯 then click the plane in the 3D view / tree – then click only the hole wall; its points are projected onto that plane and the circle/slot is fitted in 2D.')}"><select id="cp-auxpl">${pls.length ? '' : `<option value="">${tt('no measured plane yet')}</option>`}${pls.map((f) => `<option value="${f.id}" ${ao === f.id ? 'selected' : ''}>${f.name.replace(/[<>&"]/g, '')}${f.datum ? ` [${f.datum}]` : ''}</option>`).join('')}</select>${pls.length ? `<button type="button" data-auxpick class="${auxPickArm ? 'on' : ''}" title="${tt('Pick the aux plane: click a measured plane in the 3D view or in the tree')}">🎯</button>` : ''}</label>`;
}
function auxCall(tri: number, point: Vec3, maxAngleDeg: number, type: GeomType, ref?: FeatureView, ring?: { gap: number; width: number }, fill?: { band: number; excludeRaised: boolean } | null, extra: object = {}) {
  return type === 'Linie'
    ? engine.call<any>({ op: 'auxLine', tri, point, maxAngleDeg, side: state.opts.lineSide ?? 0, plane: ref?.measured, ring, fill, ...extra } as any)
    : engine.call<any>({ op: 'aux', tri, point, maxAngleDeg, type: type as 'Kreis' | 'Langloch', plane: ref?.measured, ring, fill, seedR: state.opts.pick, ...extra } as any);
}
async function previewWithAux(h: Hit, type: 'Kreis' | 'Langloch' | 'Linie') {
  const ref = typeof state.opts.aux === 'number' ? state.features.find((f) => f.id === state.opts.aux) : undefined;
  const fill = false as boolean ? { band: state.opts.fill.band ?? 0, excludeRaised: state.opts.fill.exRaised } : null;
  const r = await busy(auxCall(h.tri, h.point, state.opts.maxAngleDeg, type, ref, state.opts.aux === 'ring' ? state.opts.ring : undefined, fill));
  state.preview = { fit: r.fit, indices: r.indices, candidates: [], method: 'Klick', hit: h, raised: fill ? r.aux.raised : undefined, contour: fill ? r.aux.contour : undefined, auxFill: !!fill,
    aux: { plane: r.aux.plane, indices: r.aux.indices, source: (ref ? ref.name : state.opts.aux === 'ring' ? tt(type === 'Kreis' ? 'ring zone (offset {0} mm, width {1} mm)' : 'band zone (offset {0} mm, width {1} mm)', state.opts.ring.gap, state.opts.ring.width) : tt('automatic (adjacent face)')) + (fill ? ' · ' + tt('all inside boundary') : ''), refId: ref?.id } };
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
  seedFeedback(h);
  // phones: the Creation Panel sits at the bottom – close bottom sheets / drawers that would cover it
  if (isPhone()) { togglePanel('dialog', false); togglePanel('table', false); }
  const m = state.mode as FitMode;
  const pv = state.preview;
  if (state.opts.addIsl && pv && pv.fit.type === 'Ebene' && !pv.aux) { state.opts.fill.man.push({ c: [...h.point] as Vec3, r: state.opts.brush }); state.opts.addIsl = false; await applyExtract(); renderAll(); status(tt('Island added (Ø {0} mm = brush diameter).', fmt(2 * state.opts.brush, 1))); return; }
  if (state.opts.sub && pv && !pv.aux) { await removeRegion(h); return; }
  if ((add || state.opts.multi) && pv?.aux && (pv.fit.type === 'Kreis' || pv.fit.type === 'Langloch') && (m.type === pv.fit.type || m.type === 'auto')) { await addAuxRegion(h); return; }
  if ((add || state.opts.multi) && pv && MULTI_TYPES.includes(pv.fit.type) && !pv.aux && (m.type === pv.fit.type || m.type === 'auto')) { await addPlaneRegion(h); return; }
  resetIslands(); // a new selection: island choices start from the automatic detection
  if (m.type === 'Freiformfläche') { await previewNurbs({ hit: h }, 'Klick'); return; }
  if (usesAux(m.type)) {
    try { await previewWithAux(h, m.type as 'Kreis' | 'Langloch'); }
    catch (e: any) { state.preview = null; status(tt('Auxiliary plane: {0}', e.message)); toast(tt('Auxiliary plane: {0}', e.message)); }
    renderAll(); return;
  }
  try {
    const r = await busy(engine.call<any>({ op: 'grow', tri: h.tri, point: h.point, maxAngleDeg: state.opts.maxAngleDeg, radius: state.opts.radius, type: m.type, seedR: state.opts.pick }));
    state.preview = { fit: r.fit, indices: r.indices, candidates: r.candidates, method: 'Klick', hit: h,
      aux: r.aux ? { plane: r.aux.plane, indices: r.aux.indices, source: tt('automatic (adjacent face)') } : undefined };
    // 0.32: no implicit “Auto + existing plane” switch any more – an assigned plane is used only for a typed circle/slot/line
    if (!r.aux && extractActive()) await applyExtract();
    if (r.aux) {
      // Creation Panel choice (local ring / all inside boundary) also applies to an auto-detected circle/slot/line
      if ((state.opts.aux === 'ring' || false) && (r.fit.type === 'Kreis' || r.fit.type === 'Langloch' || r.fit.type === 'Linie')) { try { await previewWithAux(h, r.fit.type); } catch (e: any) { toast(e.message); } renderAll(); return; }
      status(tt('Auto: {0} in auxiliary plane – {1} wall points (orange), {2} plane points (blue).', typeName(r.fit.type), r.indices.length, r.aux.indices.length)); renderAll(); return; }
    status(tt('Preview: {0} from {1} points ({2} ms). ✓ creates the feature.', typeName(r.fit.type), r.indices.length, r.ms.toFixed(0)));
  } catch (e: any) { state.preview = null; status(tt('No geometry found: {0}', e.message)); }
  renderAll();
}

/** Plane preview: capture all points inside the outer boundary of the grown region(s) (or back to the grown points). */
let cpParamsOpen = false;
(window as any).__flash = flashUpdated;
const exclTip = () => tt('Boundary exclusion distance [mm]: points closer than this to the boundary are excluded – the outer contour, holes/openings and (with islands off) island edges. Removes edge roundings, burrs and chamfer starts. 0 = off.');
/** any extraction parameter that changes the plain region-growing result? */
/** Use outer contour on/off (Action Bar button and Parameters checkbox): switching it on also switches outlier removal
 *  off – otherwise bumps/spatter would be dropped again as outliers and flatness would ignore them. */
function setContour(on: boolean) { void on;
  state.opts.fill.on = true; // 0.33: planes always inside the detected contour (option removed)
  if (on && state.opts.ex.outlierOn) { state.opts.ex.outlierOn = false; toast(tt('Outer contour: outlier removal switched off so that bumps and spatter stay in (switch it on again under Parameters if wanted).')); }
}
const extractActive = () => (state.preview?.fit.type === 'Ebene' && !state.preview.aux && state.preview.method === 'Klick') || state.opts.ex.inset !== 0 || state.opts.ex.zoneSrc === 'geom' || state.opts.ex.angleOn; // 0.33: planes always inside the detected contour; no outlier removal at creation // plain growing = raw fit (0.30)
/** fit parameters (worker) from the unified extraction parameters */
function extractParams(type: GeomType): import('./worker').FitParams {
  const x = state.opts.ex, plane = type === 'Ebene', fill = plane && state.opts.fill.on;
  return { k: 0, nf: x.angleOn ? { angleDeg: x.angleDeg, maxPct: 100 } : null,
    fill: fill ? { band: state.opts.fill.band ?? 0, excludeRaised: state.opts.fill.exRaised, islands: x.islands, inset: x.inset, isl: state.opts.fill.isl } : null, inset: plane && !fill ? x.inset : 0 };
}
/** Preview: apply the extraction parameters (outer contour, islands, exclusion distance, normal angle, outliers) to the grown region(s). */
async function applyExtract() {
  const pv = state.preview; if (!pv) return;
  if (pv.aux && pv.hit && state.opts.aux === 'auto' && (pv.fit.type === 'Kreis' || pv.fit.type === 'Langloch' || pv.fit.type === 'Linie')) {
    try { await previewWithAux(pv.hit, pv.fit.type); } catch (e: any) { toast(e.message); } return; }
  if (pv.aux || pv.method === 'Konstruiert' || pv.fit.type === 'Abstand' || pv.fit.type === 'Winkel' || pv.fit.nurbs) return;
  const base = pv.grown ?? (pv.regions ? Uint32Array.from(new Set(pv.regions.flatMap((r) => Array.from(r)))) : pv.indices), grown = minusRemoved(base);
  const type = pv.fit.type as GeomType, fill = type === 'Ebene' && state.opts.fill.on;
  try {
    const x0 = state.opts.ex, geom = x0.zoneSrc === 'geom' && GEOM_ZONE.includes(type);
    const r = await busy(engine.call<any>({ op: 'fit', indices: grown, type, params: geom ? { ...extractParams(type), inset: 0 } : extractParams(type) }));
    let zone: import('./core/reextract').SearchRegion | undefined;
    if (geom) { // boundary from the fitted geometry: zone around the fitted shape, all points of that surface inside it
      const g = await geomZoneExtract(r.fit, r.indices, pv.hit?.point, state.opts.fill.band ?? undefined, { k: 0, angleOn: x0.angleOn, angleDeg: x0.angleDeg, inset: x0.inset });
      r.fit = g.fit; r.indices = g.indices; r.band = g.band; zone = g.zone; }
    if (removedSets.length || state.opts.fill.man.length) { const k = minusRemoved(r.indices); if (k.length !== r.indices.length) { const q = await busy(engine.call<any>({ op: 'fit', indices: k, type })); r.fit = q.fit; r.indices = q.indices; } } // removed regions stay out (also All inside boundary / fitted geometry)
    state.preview = { ...pv, fit: r.fit, indices: r.indices, grown: base, bandUsed: r.band, seed: fill ? grown : undefined, filled: r.filled, raised: fill ? r.raised : undefined, contour: fill ? r.contour : undefined, islands: fill ? r.islands : undefined, zone };
    if (islSel >= (state.preview.islands?.length ?? 0)) islSel = -1;
    const x = state.opts.ex, extra = [x.inset > 0 ? tt('exclusion distance {0} mm', x.inset) : '', x.angleOn ? tt('normal angle ≤ {0}°{1}', x.angleDeg, r.fit.nfRemoved ? ` (−${r.fit.nfRemoved})` : '') : '', x.outlierOn ? tt('outliers > {0} × RMS removed', x.outlierK) : tt('no outlier removal')].filter(Boolean).join(' · ');
    if (fill) status(tt('Inside outer boundary: {0} points (+{1} on bumps/rims), flatness {2} mm.', r.indices.length, r.filled ?? 0, fmt(r.fit.form, 4)) + ' ' + extra + (r.raised?.length ? ' · ' + (state.opts.fill.exRaised ? tt('Raised features excluded: {0} points (magenta).', r.raised.length) : tt('Raised features (magenta) included: {0} points – “Exclude raised” drops them.', r.raised.length)) : ''));
    else status(tt('{0} points', r.indices.length) + ' · ' + extra);
  } catch (e: any) { toast(tt('Fit failed: {0}', e.message)); }
}
/** Boundary from “Fitted geometry”: ONE zone around the analytic fitted shape (cylinder/cone: radius ± band over the axial
 *  extent of the points, full 360°; sphere/torus shell), the exclusion distance shortens (+) / extends (−) it at its ends.
 *  All mesh points of that surface inside the zone are taken – not only the grown/selected triangles. */
async function geomZoneExtract(fit: FitResult, indices: Uint32Array, seed: Vec3 | undefined, band: number | undefined, x: { k: number; angleOn: boolean; angleDeg: number; inset: number }, crit?: FitCrit) {
  const b = band ?? REEX_DEFAULT.maxDist; // 0.39: Standard-Suchabstand (Optionen › Extraktion, 1 mm)
  const g = await busy(engine.call<any>({ op: 'reex', fit, indices, seedPts: seed ? [seed] : [],
    params: { maxDist: b, sigma: x.k > 0 ? x.k : 3, sigmaOn: x.k > 0, angleOn: x.angleOn, maxAngleDeg: x.angleDeg, margin: -x.inset, iterations: 3 }, ...(crit ? { crit, formBy: true } : {}) }));
  return { fit: g.fit as FitResult, indices: g.indices as Uint32Array, band: b, zone: g.region as import('./core/reextract').SearchRegion };
}
/** debounced live update of the preview after a parameter change */
let exTimer = 0;
function extractLive() { window.clearTimeout(exTimer); flashUpdated('#ctx-panel', true); exTimer = window.setTimeout(() => { applyExtract().then(() => { renderAll(); flashUpdated('#ctx-panel'); }); }, 250); }
/** short visual confirmation that a parameter change was applied to the preview NOW (pending = computing) */
function flashUpdated(sel: string, pending = false) {
  const host = document.querySelector<HTMLElement>(sel); if (!host) return;
  host.querySelector('.upd-flash')?.remove(); const b = document.createElement('span'); b.className = 'upd-flash' + (pending ? ' pending' : '');
  b.textContent = pending ? '⟳ ' + tt('updating preview…') : '✓ ' + tt('preview updated'); host.appendChild(b);
  if (!pending) window.setTimeout(() => b.remove(), 1800);
}
/** Multi-seed plane: grow another region at the click and fit one plane through all regions (also split/disjoint faces). */
/** types whose boundary can come from the fitted geometry (zone around the shape) */
const GEOM_ZONE: string[] = ['Zylinder', 'Kegel', 'Kugel', 'Torus'];
/** types whose preview can be built from several clicked regions (union, multi-seed) */
const MULTI_TYPES: string[] = ['Ebene', 'Zylinder', 'Kegel', 'Kugel'];
async function addPlaneRegion(h: Hit) {
  const pv = state.preview!, type = pv.fit.type as GeomType;
  try {
    const g = await busy(engine.call<any>({ op: 'grow', tri: h.tri, point: h.point, maxAngleDeg: state.opts.maxAngleDeg, radius: state.opts.radius, type, seedR: state.opts.pick }));
    const regions = [...baseRegions(pv), g.indices as Uint32Array];
    await refitRegions(regions, pv.hit, type); regionOps.push('add'); regionSnaps.push(pv);
    if (extractActive()) await applyExtract();
    status(tt('{0} from {1} regions: {2} points, form {3} mm.', typeName(type), regions.length, state.preview!.indices.length, fmt(state.preview!.fit.form, 4)));
  } catch (e: any) { status(tt('No geometry found: {0}', e.message)); }
  renderAll();
}
/** 0.39: Add Region bei Kreis/Langloch – neue Wand in der bestehenden Hilfsebene, vereinigt, neu gefittet */
async function addAuxRegion(h: Hit) {
  const pv = state.preview!; const type = pv.fit.type as 'Kreis' | 'Langloch';
  try {
    const r = await busy(engine.call<any>({ op: 'auxMerge', tri: h.tri, point: h.point, maxAngleDeg: state.opts.maxAngleDeg, seedR: state.opts.pick, type, plane: pv.aux!.plane, indices: pv.indices } as any));
    regionOps.push('add'); regionSnaps.push(pv);
    state.preview = { ...pv, fit: r.fit, indices: r.indices };
    status(tt('{0} from {1} regions: {2} points, form {3} mm.', typeName(type), regionOps.filter((x) => x === 'add').length + 1, r.indices.length, fmt(r.fit.form, 4)));
  } catch (e: any) { status(tt('No geometry found: {0}', e.message)); }
  renderAll();
}
async function refitRegions(regions: Uint32Array[], hit?: Hit, type: GeomType = (state.preview?.fit.type as GeomType) ?? 'Ebene') {
  const set = new Set<number>(); for (const r of regions) for (const v of r) set.add(v);
  const idx = minusRemoved(Uint32Array.from(set).sort());
  const r = await busy(engine.call<any>({ op: 'fit', indices: idx, type }));
  state.preview = { fit: r.fit, indices: r.indices, candidates: [], method: 'Klick', hit, regions: regions.length > 1 || removedSets.length ? regions : undefined };
}
/** Seed area feedback: the triangles inside the pick circle at the click/tap (desktop shows it on hover already; on
 *  touch devices it is the only feedback where the region starts) – stays until the next hover/tap or the preview ends. */
function seedFeedback(h: Hit) { if (state.mode?.kind === 'fit' && state.mode.method === 'Klick') { lastHit = h; viewer.showCursor(h, pickR(), true); } }
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
    const src = p.grown ?? p.indices;
    const r = await busy(engine.call<any>({ op: 'fit', indices: src, type: t }));
    state.preview = { ...p, aux: undefined, zone: undefined, fit: r.fit, indices: r.indices, grown: src, candidates: r.candidates.length ? r.candidates : p.candidates };
    // the Creation Panel parameters (Boundary from: Fitted geometry, exclusion, angle, outliers) apply to the new type too –
    // before 0.27 a type change (e.g. Auto ▸ circle → Cylinder) kept only the selected points, so ✓ stored a trimmed feature
    if (extractActive()) await applyExtract();
    status(tt('Refitted as {0}.', typeName(r.fit.type)));
  } catch (e: any) { status(tt('Fit failed: {0}', e.message)); }
  renderAll();
}

function commitPreview() {
  const p = state.preview; if (!p) return;
  viewer.showCursor(null, 1); // seed feedback ends with the preview
  const t = p.fit.type;
  const n = (state.typeCount[t] = (state.typeCount[t] ?? 0) + 1);
  const f: FeatureView = {
    id: state.nextId++, name: `${typeName(t)} ${n}`, type: t, measured: p.fit, pointCount: p.indices.length,
    method: p.method, color: state.colorMode === 'uniform' ? state.uniformColor : PALETTE[state.features.length % PALETTE.length], indices: p.indices, candidates: p.candidates, refs: p.refs,
    src: p.seed ?? p.indices, hit: p.hit, fp: defaultFp(), dev: p.dev,
  };
  if (p.auxFill) f.fp!.fill = { on: true, band: state.opts.fill.band ?? 0, exRaised: state.opts.fill.exRaised };
  if (p.grown || p.seed) { const x = state.opts.ex; f.src = p.zone ? p.indices : (p.grown ?? p.seed!); f.fp!.k = 0; f.fp!.nf = { on: x.angleOn, angleDeg: x.angleDeg, maxPct: 100 };
    if (p.zone && GEOM_ZONE.includes(t)) { f.fp!.zoneSrc = 'geom'; f.fp!.zoneBand = p.bandUsed; f.fp!.inset = x.inset; f.src = p.grown ?? p.indices; }
    if (t === 'Ebene') { f.fp!.inset = x.inset; if (state.opts.fill.on) f.fp!.fill = { on: true, band: state.opts.fill.band ?? 0, exRaised: state.opts.fill.exRaised, islands: x.islands, isl: state.opts.fill.isl.map((o) => ({ ...o, c: [...o.c] })) }; } }
  if (p.regions) f.hit = undefined; // Add region stays the chosen selection method
  if (t === 'Ebene' && p.method !== 'Konstruiert' && viewer.model?.geometry.index) { // 0.33: freeze the boundary of the final selection (union of regions, after islands)
    const g = viewer.model.geometry; f.frozen = freezeBoundary(p.fit, g.getAttribute('position').array as Float32Array, g.index!.array as ArrayLike<number>, p.indices) ?? undefined;
    if (f.frozen) { if (p.bandUsed) f.frozen.band = p.bandUsed; f.src = p.indices; f.frozenIdx = p.indices; f.hit = undefined; if (f.fp?.fill) f.fp.fill = { ...f.fp.fill, on: false }; } }
  // 0.38 (F11): other surface types with “Boundary from: Point selection” keep their creation point set as well – re-extraction
  // then works from it (stable, identical count on repeat) instead of growing from its own last result
  if (t !== 'Ebene' && !p.aux && f.fp?.zoneSrc !== 'geom' && p.method !== 'Konstruiert' && p.indices.length >= 3 && GEOM_ZONE.includes(t)) f.frozenIdx = p.indices;
  if (state.mode?.kind === 'con') f.cons = { key: state.mode.key, refs: p.refs!, params: { ...state.mode.params } };
  if (p.aux) {
    f.aux = { plane: p.aux.plane, pointCount: p.aux.indices.length, source: p.aux.source, refId: p.aux.refId } as AuxPlane;
    f.auxIndices = p.aux.indices;
  }
  state.features.push(asNode(f)); // node + Ist (core/featuremodel.ts)
  if (state.opts.newDatum && !state.features.some((g) => g.datum === state.opts.newDatum)) setDatum(f, state.opts.newDatum);
  state.opts.newDatum = '';
  state.preview = null; clearBrush(); resetIslands();
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
      const seed = f.hit && f.method === 'Klick' ? { tri: f.hit.tri, point: f.hit.point, maxAngleDeg: fp.maxAngleDeg, radius: 0 } : undefined;
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
        // 0.32 fix: an existing aux plane is respected on refit – never re-detected elsewhere (assigned plane by id stays live)
        const keep = typeof fp.aux !== 'number' && f.aux?.plane ? { aux: f.aux, idx: f.auxIndices } : null;
        const ref = typeof fp.aux === 'number' ? state.features.find((g) => g.id === fp.aux) : keep ? ({ measured: f.aux!.plane, name: f.aux!.source, id: f.aux!.refId } as any) : undefined;
        auxR = await busy(auxCall(f.hit.tri, f.hit.point, fp.maxAngleDeg, type, ref, fp.aux === 'ring' ? (fp.ring ??= { ...state.opts.ring }) : undefined,
          fp.aux === 'auto' && fp.fill?.on ? { band: fp.fill.band, excludeRaised: !!fp.fill.exRaised } : null, { crit: fp.crit ?? 'lsq', formBy: true }));
        if (keep) { auxR.aux = { ...auxR.aux, plane: keep.aux.plane, indices: keep.idx ?? auxR.aux.indices }; auxR.source = keep.aux.source; auxR.refId = keep.aux.refId; } else auxR.source = ref ? ref.name : fp.aux === 'ring' ? tt(type === 'Kreis' ? 'ring zone (offset {0} mm, width {1} mm)' : 'band zone (offset {0} mm, width {1} mm)', fp.ring!.gap, fp.ring!.width) : tt('automatic (adjacent face)') + (fp.fill?.on ? ' · ' + tt('all inside boundary') : ''); auxR.refId = ref?.id;
      } else idx = (await busy(engine.call<any>({ op: 'grow', tri: f.hit.tri, point: f.hit.point, maxAngleDeg: fp.maxAngleDeg, radius: 0, type }))).indices;
    }
    if (auxR) {
      f.measured = auxR.fit; f.indices = auxR.indices; f.src = auxR.indices;
      f.aux = { plane: auxR.aux.plane, pointCount: auxR.aux.indices.length, source: auxR.source, refId: auxR.refId } as AuxPlane; f.auxIndices = auxR.aux.indices;
    } else {
      const r = await busy(engine.call<any>({ op: 'fit', indices: idx, type, crit: fp.crit ?? 'lsq', formBy: true, params: { k: fp.k, nf: fp.nf.on ? fp.nf : null, fill: fp.fill?.on && type === 'Ebene' ? { band: fp.fill.band, excludeRaised: !!fp.fill.exRaised, islands: fp.fill.islands !== false, inset: fp.inset ?? 0, isl: fp.fill.isl } : null, inset: type === 'Ebene' && !fp.fill?.on ? fp.inset ?? 0 : 0 } }));
      f.measured = r.fit; f.indices = r.indices; f.src = idx; f.aux = undefined; f.auxIndices = undefined; f.dev = undefined;
      if (fp.zoneSrc === 'geom' && GEOM_ZONE.includes(type)) { // keep the boundary from the fitted geometry (not the grown triangles)
        const g = await geomZoneExtract(r.fit, r.indices, f.hit?.point, fp.zoneBand, { k: fp.k, angleOn: !!fp.nf?.on, angleDeg: fp.nf?.angleDeg ?? 30, inset: fp.inset ?? 0 }, fp.crit ?? 'lsq');
        f.measured = { ...g.fit, type }; f.indices = g.indices; }
    }
    f.type = f.measured!.type; f.pointCount = f.indices.length; ptsCache.delete(f.id);
    state.controls = state.controls.filter((c) => !(c.featureIds[0] === f.id && !availableControls(f.type).includes(c.kind)));
    recomputeDistances();
    const m = f.measured!;
    status(tt('{0} refitted: {1} points, RMS {2}', f.name, f.pointCount, fmt(m.rms, 4)) + (m.outliers ? tt(', {0} outliers', m.outliers) : '') + (m.nfRemoved ? tt(', {0} removed by normal filter', m.nfRemoved) : '') + '.');
  } catch (e: any) { status(tt('Fit failed: {0}', e.message)); toast(tt('Fit failed: {0}', e.message)); }
  renderAll(); scheduleAutosave();
}
function resetIslands() { state.opts.fill.isl = []; state.opts.fill.man = []; state.opts.addIsl = false; islSel = -1; removedSets = []; regionOps = []; regionSnaps = []; state.opts.sub = false; }
/** Remove region (0.32): grown regions removed from the selection, and the order of add/remove steps (↶ Region) */
let removedSets: Uint32Array[] = [], regionOps: ('add' | 'sub')[] = [], regionSnaps: Preview[] = []; // snapshots: ↶ Region restores the exact previous preview
function minusRemoved(idx: Uint32Array): Uint32Array {
  const man = state.opts.fill.man; if (man.length && state.preview?.fit.type === 'Ebene' && viewer.model) { const P = viewer.model.geometry.getAttribute('position').array as Float32Array;
    idx = idx.filter((v) => !man.some((I) => Math.hypot(P[3 * v] - I.c[0], P[3 * v + 1] - I.c[1], P[3 * v + 2] - I.c[2]) <= I.r)); }
  if (!removedSets.length) return idx; const rm = new Set<number>(); for (const r of removedSets) for (const v of r) rm.add(v);
  return idx.filter((v) => !rm.has(v));
}
const baseRegions = (pv: Preview) => pv.regions ?? [pv.grown ?? pv.seed ?? pv.indices];
async function removeRegion(h: Hit) {
  const pv = state.preview!, type = pv.fit.type as GeomType;
  // 0.33: planes are always filled up to the detected contour, so the selection is larger than the grown seed – remove
  // from the whole current selection (the seed alone could vanish and the refit would fail)
  const regions = pv.filled != null || (pv.indices.length > (pv.grown?.length ?? 0) && pv.fit.type === 'Ebene') ? [pv.indices] : baseRegions(pv);
  let g: Uint32Array;
  try { g = (await busy(engine.call<any>({ op: 'grow', tri: h.tri, point: h.point, maxAngleDeg: state.opts.maxAngleDeg, radius: state.opts.radius, type: 'auto', seedR: state.opts.pick }))).indices; }
  catch { g = (await busy(engine.call<any>({ op: 'brush', center: h.point, radius: pickR(), facing: h.normal ?? [0, 0, 1] }))).indices as Uint32Array; }
  let inSel = new Set(pv.indices), hit = g.filter((v) => inSel.has(v));
  const covers = regions.some((rg) => { const R = new Set(rg); let c = 0; for (const v of g) if (R.has(v)) c++; return c > 0.5 * rg.length; }) || pv.grown != null && (() => { const R = new Set(pv.grown!); let c = 0; for (const v of g) if (R.has(v)) c++; return c > 0.5 * pv.grown!.length; })();
  if (hit.length > 0.5 * pv.indices.length || covers) { // tapped the selected surface itself → remove a disc (brush radius) instead of everything
    g = (await busy(engine.call<any>({ op: 'brush', center: h.point, radius: Math.max(pickR(), state.opts.brush), facing: h.normal ?? [0, 0, 1] }))).indices as Uint32Array;
    hit = g.filter((v) => inSel.has(v));
  }
  if (!hit.length) { status(tt('Remove region: nothing of the selection there.')); return; }
  removedSets.push(g); regionOps.push('sub'); regionSnaps.push(pv);
  try { await refitRegions(regions, pv.hit, type); if (extractActive()) await applyExtract(); }
  catch (e: any) { removedSets.pop(); regionOps.pop(); regionSnaps.pop(); state.preview = pv; toast(tt('Fit failed: {0}', e.message)); renderAll(); return; }
  status(tt('Region removed: {0} points – {1} points left.', hit.length, state.preview!.indices.length)); renderAll();
}
function discardPreview() { state.preview = null; clearBrush(); resetIslands(); status(tt('Preview discarded.')); renderAll(); }

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
  if (state.preview && isPhone()) { togglePanel('dialog', false); togglePanel('table', false); }
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
type AnKind = 'form' | 'mesh' | 'axis' | 'cpos';
/** Controls shown in the axis view (cylinder/cone): orientation/location of the axis and straightness of the axis. */
const AXIS_CTRL = ['Position', 'Rechtwinkligkeit', 'Parallelität', 'Neigung', 'Koaxialität', 'Geradheit Achse'];
/** Which analysis view a control gets: axis view, surface colour map, or none (dimensions). */
function ctrlAnalysisKind(c: Control): 'axis' | 'form' | 'cpos' | null {
  const f = state.features.find((x) => x.id === c.featureIds[0]); if (!f || !f.measured) return null;
  if (c.kind === 'Position' && isPattern(f)) return 'axis'; // bolt-circle pattern: axis view of every hole
  if (c.kind === 'Position' && (f.type === 'Kreis' || f.type === 'Langloch') && !isPattern(f) && c.datumIds?.length) return 'cpos'; // centre point in a Ø zone ⟂ aux plane
  if (!f.indices.length) return null;
  if ((f.type === 'Zylinder' || f.type === 'Kegel') && AXIS_CTRL.includes(c.kind)) return 'axis';
  if ((isZoneControl(c.kind) || isDatumControl(c.kind)) && f.type !== 'Abstand' && f.type !== 'Winkel') return 'form';
  return null;
}
const ctrlTitle = (c: Control) => { const f = state.features.find((x) => x.id === c.featureIds[0]); return `${f?.name ?? '?'} · ${controlLabel(c, f)}${c.datumIds?.length ? ` |${datumText(c, featMap())}|` : ''}`; };
/** Axis analysis of one cylinder/cone for one control (or against its own fitted axis). */
function axisFor(f: FeatureView, C: Control | null): AxisAnalysis {
  const pts = featPoints(f.id) ?? []; // same point sample as the Controls table → identical values
  if (C?.kind === 'Position' && C.datumIds?.length) {
    // the table evaluation (free DOF, datum shift, pattern CZ/SZ, Ⓜ/Ⓛ) gives per hole its nominal axis and permitted t → same in the view
    const r = evaluate(C, featMap(), ctx), mi = r.members?.findIndex((m) => m.fid === f.id) ?? -1;
    if (mi >= 0 && r.flag !== NOMINAL_MISSING) {
      const m = r.members![mi], many = r.members!.length > 1;
      const an = analyzeAxis(f.measured!, pts, { dir: m.dirW, point: m.nomW }, m.tol > 0 ? m.tol : null, 0,
        `${f.name} · ${kindName(C.kind)} → ${C.datumIds.map(nameOf).join('|')}${many ? ` · ${tt('hole {0} of {1}', mi + 1, r.members!.length)}${mi === r.worst ? ' · ' + tt('worst margin') : ''}` : ''}${C.mod ? ` · ${tt('tol')} ${fmt(C.tolUp, 4)} + ${tt('bonus')} ${fmt(m.bonus, 4)} = ${fmt(m.tol, 4)}` : ''} · ${tt('margin')} ${sgn(m.margin, 4)}${r.flag === NOMINAL_UNCONFIRMED ? ` · ⚠ ${tt('Nominal unconfirmed')}` : ''}`);
      an.zone = m.dia; return an;
    }
  }
  const c = C && C.kind !== 'Geradheit Achse' && C.datumIds?.length ? C : null;
  // nominal axis from the full datum reference frame of the control (buildDRF: A|B|C); TED missing → direction only
  const DS = c ? c.datumIds!.map((i) => state.features.find((x) => x.id === i)).filter((x): x is FeatureView => !!x?.measured) : [];
  const rb = c ? resolveBasic(c, f, DS, ctx) : null, miss = !!rb?.missing.length;
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
/** Position of a circle/slot centre: nominal point (foot on the zone axis), actual centre, zone axis ⟂ aux plane. */
interface CposView { fid: number; nom: Vec3; act: Vec3; dir: Vec3; tol: number; val: number; bonus: number; mod?: boolean; radius: number; status: string; flag?: string }
interface AnResult { cpos?: CposView; idx: Uint32Array; dev: Float32Array; pos?: Float32Array; dir?: Float32Array; label: string; feats?: { id: number; lo: number; hi: number }[]; axes?: AxisAnalysis[] }
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
  cpos: async () => {
    const C = state.an.ctrl != null ? state.controls.find((c) => c.id === state.an.ctrl) : undefined; if (!C) return null;
    const f = state.features.find((x) => x.id === C.featureIds[0]); if (!f?.measured) return null;
    const r = evaluate(C, featMap(), ctx), m = r.members?.[0];
    if (!m) { toast(r.flag ? tt(r.flag) : tt('Enter the TED in the control first.')); return null; }
    const act = f.measured.center as Vec3, d = m.dirW, t = (act[0] - m.nomW[0]) * d[0] + (act[1] - m.nomW[1]) * d[1] + (act[2] - m.nomW[2]) * d[2];
    const nom: Vec3 = [m.nomW[0] + t * d[0], m.nomW[1] + t * d[1], m.nomW[2] + t * d[2]];
    state.an.ids = [f.id, ...(C.datumIds ?? [])];
    return { idx: new Uint32Array(0), dev: new Float32Array(0), label: `◐ ${ctrlTitle(C)}`,
      cpos: { fid: f.id, nom, act, dir: d, tol: m.tol, val: m.dia, bonus: m.bonus, mod: !!C.mod, radius: f.measured.radius ?? (f.measured.diameter ?? 2) / 2, status: r.status, flag: r.flag } };
  },
  axis: async () => {
    const C = state.an.ctrl != null ? state.controls.find((c) => c.id === state.an.ctrl) : undefined;
    const pat = C ? state.features.find((f) => f.id === C.featureIds[0] && isPattern(f)) : undefined;
    let fs = pat ? pat.cons!.refs.map((id) => state.features.find((f) => f.id === id)).filter((f): f is FeatureView => !!f?.measured && !!f.indices.length) : C ? state.features.filter((f) => f.id === C.featureIds[0]) : state.features.filter((f) => state.sel.includes(f.id) && (f.type === 'Zylinder' || f.type === 'Kegel') && f.indices.length);
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
  if (state.mode?.kind === 'con' && !state.preview) state.mode = null;
  if (state.mode?.kind === 'fit' && !state.preview) { state.mode = null; clearBrush(); clearAuxHover(); viewer.controls.enabled = true; viewer.showCursor(null, 1); }
  const r = await AN_SOURCES[kind]().catch((e) => { toast(tt('Analysis failed: {0}', e.message)); return null; });
  if (!r) return;
  if (!keepView) state.an.otherLabels = false; // entering Analyze: annotations of unrelated features hidden (restored on exit)
  state.an.kind = kind; state.an.res = r; state.an.on = true; pe.cmp = false;
  if (kind === 'axis' && r.axes?.length && !keepView) sideView(viewer, r.axes);
  if (kind === 'cpos' && r.cpos && !keepView) { const d = r.cpos.dir, q = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], k = q[0] * d[0] + q[1] * d[1] + q[2] * d[2], pp = [q[0] - k * d[0], q[1] - k * d[1], q[2] - k * d[2]];
    viewer.focus(r.cpos.act as [number, number, number], Math.min(r.cpos.radius * 5, Math.max(r.cpos.tol, r.cpos.val, 1e-3) * Math.max(1, state.an.axLoc) * 3), [d[0] + 0.45 * pp[0], d[1] + 0.45 * pp[1], d[2] + 0.45 * pp[2]]);
    // the Action Bar covers the lower middle: move the centre into the upper part of the view
    const cam = viewer.camera as any; cam.updateMatrixWorld(); const e = cam.matrixWorld.elements, up = [e[4], e[5], e[6]], tg = viewer.controls.target;
    const dist = cam.position.distanceTo(tg), sh = 0.25 * 2 * dist * Math.tan(((cam.fov ?? 45) * Math.PI) / 360);
    for (const o of [tg, cam.position]) { o.x -= up[0] * sh; o.y -= up[1] * sh; o.z -= up[2] * sh; } viewer.controls.update(); }
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
/** Optional 3D value labels of the axis analysis (zone, envelope, nominal). */
function axisLabels(x: AxisAnalysis) {
  const L = state.an.axLab, sh = x.planeN ? `∥ ${tt('2 planes')}` : 'Ø';
  return { zone: L.zone && x.tol ? `${tt('tolerance zone')} ${sh} ${fmt(x.tol, 4)}` : '', req: L.zone && !x.missing ? `${tt('required')} ${sh} ${fmt(x.zone, 4)}` : '',
    env: L.env && state.an.axEnv ? `${tt('envelope')} Ø ${fmt(x.straightness, 4)}` : '', nom: L.nom ? (x.mode === 'position' ? tt('nominal axis (TED, DRF)') : tt('nominal direction')) : '' };
}
/** Zone shape indicator (legend/tooltips). */
const zoneShapeHTML = (x: { planeN?: unknown }) => x.planeN
  ? `<span class="zshape" title="${tt('Zone shape: two parallel planes, distance t apart (no Ø in the feature control frame). The axis must lie between them.')}">∥ ${tt('2 planes')}</span>`
  : `<span class="zshape" title="${tt('Zone shape: cylinder of diameter t around the nominal axis (Ø in the feature control frame). The axis must lie inside it.')}">Ø ${tt('cylinder')}</span>`;
function paintAnalysis(): boolean {
  const a = state.an, r = a.res;
  if (!a.on || !r || !viewer.colors) return false;
  if (r.axes) {
    viewer.setModelOpacity(a.axHide ? 0 : a.trans ? 0.35 : 1);
    let el = document.getElementById('dev-legend'); if (!el) { el = document.createElement('div'); el.id = 'dev-legend'; viewer.el.appendChild(el); }
    const fx = axisExag(r), lx = Math.max(1, a.axLoc);
    el.innerHTML = `<b>${r.label}</b>` + r.axes.map((x) => `<small><b>${x.label}</b><br>${tt('tilt')} ${fmt(x.tiltDeg, 4)}° · ${x.missing ? `<span class="st missing" title="${tt('Enter the TED in the panel below (or ⋯ → Use actual as nominal) to get the zone and OK/NOK')}">${tt('zone')}: ${tt('Nominal missing')}</span>` : `${zoneShapeHTML(x)} · ${tt('required')} ${fmt(x.zone, 4)}${x.tol != null ? ` / t ${fmt(x.tol, 3)} ${x.zone <= x.tol ? '✔' : '✘'}` : ''}`}${x.mode === 'position' ? `<br>${tt('location offset')} Δ ${fmt(x.offsetLen, 4)} mm` : ''}<br>${tt('median line: {0} sections · straightness Ø {1} (minimum zone)', x.centers.length, fmt(x.straightness, 4))}</small>`).join('')
      + `<small>${tt('Median line at its true location; its bend is shown ×{0}.', fx)} ${lx > 1 ? `<b style="color:#1565c0">${tt('Location offset and zones shown ×{0} (not true scale).', lx)}</b>` : tt('Location and zones: true scale.')}</small>`
      + r.axes.slice(0, 1).map((x) => { const cs = axisColorScale(x), REF = { nominal: tt('distance from the nominal axis'), zone: tt('distance from the zone axis'), planes: tt('distance from the zone mid-plane'), form: tt('distance from the minimum-zone axis') };
        return `<small title="${tt('Median-line points and segments are coloured by their deviation: green = on the reference, red = at the zone boundary (t/2) or beyond')}">${tt('Colour')}: ${REF[cs.ref]}<div class="bar half"></div><div class="ticks"><span>0</span><span>${fmt(cs.h / 2, 4)}</span><span>≥ ${fmt(cs.h, 4)}${x.tol != null ? ' (t/2)' : ''}</span></div></small>`; }).join('')
      + `<small><span style="color:#555">━</span> ${tt('nominal axis')} · <span style="color:#2e9e3e">━</span><span style="color:#c62828">●</span> ${tt('median line (coloured)')} · <span style="color:#e57373">┅</span> ${tt('its axis')} · <span style="color:#1565c0">➝</span> ${tt('offset')} · <span style="color:#22aa44">▮</span> ${tt('tolerance')} · <span style="color:#ff8c1a">▮</span> ${tt('required zone')} · <span style="color:#8e44ad">◎</span> ${tt('envelope (min. zone)')}</small>`;
    return true;
  }
  if (r.cpos) {
    viewer.setModelOpacity(a.axHide ? 0 : a.trans ? 0.35 : 1);
    let el = document.getElementById('dev-legend'); if (!el) { el = document.createElement('div'); el.id = 'dev-legend'; viewer.el.appendChild(el); }
    const v = r.cpos, lx = Math.max(1, a.axLoc);
    el.innerHTML = `<b>${r.label}</b><small>${tt('Position Ø')} <b>${fmt(v.val, 4)}</b> · ${tt('permitted')} ${v.mod ? `${tt('tol')} ${fmt(v.tol - v.bonus, 4)} + ${tt('bonus')} ${fmt(v.bonus, 4)} = ` : ''}${fmt(v.tol, 4)} · ${tt('offset')} ${fmt(v.val / 2, 4)} ${v.flag ? `<span class="st missing">⚠ ${tt(v.flag)}</span>` : ''}</small>`
      + `<small>${tt('Only the fitted centre counts; zone = cylinder Øt ⟂ the auxiliary plane through the TED point.')} ${lx > 1 ? `<b style="color:#1565c0">${tt('Location offset and zones shown ×{0} (not true scale).', lx)}</b>` : tt('True scale.')}</small>`
      + `<small><span style="color:#555">━</span> ${tt('zone axis')} · <span style="color:#555">●</span> ${tt('nominal point')} · <span style="color:#c62828">●</span>/<span style="color:#2e9e3e">●</span> ${tt('actual centre')} · <span style="color:#2e9e3e">▮</span> ${tt('tolerance zone')} · <span style="color:#1565c0">➜</span> ${tt('offset')}</small>`;
    return true;
  }
  if (r.idx.length && r.idx[r.idx.length - 1] >= viewer.colors.length / 3) { a.on = false; a.res = null; return false; }
  const { c, h } = anRange(r);
  viewer.paintScalar(r.idx, r.dev, h, a.steps, c);
  viewer.setModelOpacity(a.trans ? 0.4 : 1);
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
  const spec = f ? tedSpec(c, f, ds, ctx) : [];
  const st = r.flag === NOMINAL_MISSING ? `<span class="st missing">${tt('Nominal missing')}</span>` : r.measured != null ? `<b>${fmt(r.measured)}</b>${bonusText(c, r)} ${stHtml(r)}` : r.flag ? `<span class="st missing" title="${r.flag}">⚠ ${tt(r.flag)}</span>` : '';
  return {
    html: `<span class="an-ctrl" title="${tt('Active control – changes recompute the analysis immediately')}"><b>${ctrlTitle(c)}</b>
      <label>${isZoneControl(c.kind) ? tt('Tol') : tt('Tol+')} <input id="an-tol" inputmode="decimal" data-num="${isZoneControl(c.kind) ? 'abs' : 'signed'}" value="${c.tolUp}"></label>${c.datumIds?.length ? '<span data-dsl></span>' : ''}<span data-teds></span><span data-dia></span> ${st}${membersHtml(c, r)}</span>`,
    bind: (el) => {
      const upd = () => { void analyzeControl(c.id, true); };
      const t = el.querySelector<HTMLInputElement>('#an-tol'); if (t) t.onchange = () => { const v = parseNum(t.value) ?? NaN; if (isFinite(v)) { c.tolUp = isZoneControl(c.kind) ? Math.abs(v) : v; c.tolSrc = 'manual'; upd(); } };
      const dsl = el.querySelector('.an-ctrl [data-dsl]'); if (dsl && f) dsl.appendChild(datumSlots(c, f, upd));
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
/** In Analyze: features whose annotations stay visible (analysed feature(s) + datum features of the control); null = all. */
function anFocusIds(): Set<number> | null {
  const a = state.an; if (!a.on) return null;
  const C = anControl();
  const ids = C ? [...C.featureIds, ...(a.otherLabels ? C.datumIds ?? [] : [])] : a.ids.length ? a.ids : state.sel;
  return new Set(ids);
}
const anControl = () => (state.an.ctrl != null ? state.controls.find((c) => c.id === state.an.ctrl) : undefined);
/** 'Show datum features': only for controls with datums; toggles annotations + highlight of the datum features (default off). */
const otherLabelsHtml = () => { const C = anControl(); if (!C?.datumIds?.length) return '';
  const names = C.datumIds.map((i) => state.features.find((f) => f.id === i)).filter(Boolean).map((f) => (f!.datum ? `${f!.datum} (${f!.name})` : f!.name)).join(', ');
  return `<button data-ol class="${state.an.otherLabels ? 'on' : ''}" title="${tt('While analysing only the annotation of the analysed feature is shown. Switch on to also show the annotations of the datum features of this control and highlight them (blue): {0}. Off by default; restored when Analyze is closed.', names)}">🏷 ${tt('Show datum features')}</button>`; };
function deriveHtml(): string {
  const p = deriveParent(), dv = p ? derivesFor(p.type) : [];
  if (state.an.derivePrev) return `<span class="an-derive"><b>🔗 ${tt(DERIVES.find((d) => d.key === state.an.derivePrev!.key)!.label)}</b><button class="btn primary" data-dv="add" title="${tt('Create the previewed geometry as a feature in the tree; it is recomputed automatically when the parent feature changes')}">＋ ${tt('Add to tree')}</button><button class="btn" data-dv="x" title="${tt('Discard the preview')}">✕</button></span>`;
  return `<button class="btn" data-dv="menu" ${dv.length ? '' : 'disabled'} title="${tt('Derive feature from Analyze: preview dependent geometry (flatness zone planes, derived median line as Polyline, minimum-zone axis) and add it to the tree')}">🔗 ${tt('Derive')}</button>`;
}
function bindDerive(el: HTMLElement) {
  el.querySelectorAll<HTMLButtonElement>('[data-ol]').forEach((b) => (b.onclick = () => { state.an.otherLabels = !state.an.otherLabels; renderAll(); }));
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
  state.features.push(asNode(f)); deriveSrc.set(f, { m: p.measured, P: featPoints(p.id) });
  toast(`✔ ${tt('{0} created', f.name)} (🔗 ${tt('derived from {0}', p.name)})`);
}
/** Compact bottom area of the axis/position analysis: value-label checkboxes + [Hide mesh][Transparent] side by side. */
function axViewRow(cpos: boolean): string {
  const a = state.an, L = a.axLab, cb = (k: keyof typeof L, lbl: string, tip: string) => `<label class="an-lab" title="${tip}"><input type="checkbox" data-lab="${k}" ${L[k] ? 'checked' : ''}> ${lbl}</label>`;
  return `<div class="an-labs"><span title="${tt('3D value labels (annotations) next to the drawn elements')}">🏷</span>${cb('zone', tt('Zone'), tt('Label the tolerance zone (green) with its shape and size, e.g. Ø 0.100, and the required zone of the actual axis (orange)'))}${cpos ? '' : cb('env', tt('Envelope'), tt('Label the envelope (purple minimum-zone cylinder around the median line) with its Ø = straightness of the axis'))}${cb('nom', tt('Nominal'), tt('Label the nominal (TED) axis/point, located in the datum reference frame (DRF triad)'))}${cb('dev', tt('Deviation'), tt('Label the location deviation (blue arrow nominal → actual)'))}</div>
    ${otherLabelsHtml()}<div class="an-btm"><button data-a="hide" class="${a.axHide ? 'on' : ''}" title="${tt('Hide the polygon model so that only the analysis (median line, nominal axis, zones) is visible')}">▢ ${tt('Hide mesh')}</button><button data-a="trans" class="${a.trans ? 'on' : ''}" ${a.axHide ? 'disabled' : ''} title="${tt('Transparent model: the scan is drawn semi-transparent so the tolerance zones and axes inside the part are visible (same switch as Analyze › Transparent, remembered)')}">◌ ${tt('Transparent')}</button></div>`;
}
function bindAxView(el: HTMLElement) {
  el.querySelectorAll<HTMLInputElement>('[data-lab]').forEach((c) => (c.onchange = () => { state.an.axLab[c.dataset.lab as 'zone'] = c.checked; renderScene(); }));
}
function analysisSpec(): CtxSpec | null {
  const a = state.an; if (!a.on || !a.res) return null;
  const cp = ctrlPanel();
  if (a.res.cpos) return { title: `◐ ${tt('Circle position')}`, cls: 'an',
    controls: `${cp.html}<label title="${tt('Location exaggeration (×): magnifies the LOCATION error – the offset of the median line from the nominal (TED) axis, measured perpendicular to the nominal axis, is multiplied by this factor, and the tolerance zones are enlarged by the same factor, so ‘inside/outside the zone’ looks the same as at true scale. 1 = true scale; a blue note is shown when > 1.')}">${tt('Location offset')} × <input id="an-lx" class="an-n" type="number" min="1" step="10" value="${a.axLoc}"></label>
      ${axViewRow(true)}`,
    bind: (el) => { cp.bind(el); bindAxView(el); const lx = el.querySelector<HTMLInputElement>('#an-lx')!; lx.onchange = () => { const v = Number(lx.value.replace(',', '.')); if (isFinite(v) && v >= 1) { a.axLoc = v; renderAll(); } };
      el.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) => (b.onclick = () => { if (b.dataset.a === 'hide') a.axHide = !a.axHide; else if (b.dataset.a === 'zones') a.axZones = !a.axZones; else { a.trans = !a.trans; localStorage.setItem('mw3d-trans', a.trans ? '1' : '0'); } renderAll(); }));
      el.querySelectorAll<HTMLButtonElement>('[data-ol]').forEach((b) => (b.onclick = () => { state.an.otherLabels = !state.an.otherLabels; renderAll(); })); },
    cancel: { run: analyzeOff, title: tt('Close analysis') } };
  if (a.res.axes) return { title: `◐ ${tt('Axis analysis')}`, cls: 'an',
    controls: `${cp.html}<label title="${tt('Form exaggeration (×): only the BEND of the derived median line is magnified – each section centre is moved away from the median line’s own best-fit axis, perpendicular to it, by (distance × factor). Its location and tilt stay true. Also scales the envelope Ø. 0 = automatic (largest bend ≈ 25 % of the radius).')}">${tt('Form bend')} × <input id="an-ax" class="an-n" type="number" min="0" step="10" value="${a.axExag}"></label>
      <label title="${tt('Location exaggeration (×): magnifies the LOCATION error – the offset of the median line from the nominal (TED) axis, measured perpendicular to the nominal axis, is multiplied by this factor, and the tolerance zones are enlarged by the same factor, so ‘inside/outside the zone’ looks the same as at true scale. 1 = true scale; a blue note is shown when > 1.')}">${tt('Location offset')} × <input id="an-lx" class="an-n" type="number" min="1" step="10" value="${a.axLoc}"></label>
      <button data-a="env" class="${a.axEnv ? 'on' : ''}" title="${tt('Show the envelope: the minimum-zone cylinder (purple) that encloses the derived median line; its Ø is the straightness of the axis')}">◎ ${tt('Envelope')}</button><button data-a="help" title="${tt('Explain the analysis settings')}">?</button>${deriveHtml()}${axViewRow(false)}`,
    bind: (el) => { cp.bind(el); bindDerive(el); bindAxView(el); const i = el.querySelector<HTMLInputElement>('#an-ax')!; i.onchange = () => { const v = Number(i.value.replace(',', '.')); if (isFinite(v) && v >= 0) { a.axExag = v; renderAll(); } };
      const lx = el.querySelector<HTMLInputElement>('#an-lx')!; lx.onchange = () => { const v = Number(lx.value.replace(',', '.')); if (isFinite(v) && v >= 1) { a.axLoc = v; renderAll(); } };
      el.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) => (b.onclick = () => { if (b.dataset.a === 'help') showDocs('analyze'); else if (b.dataset.a === 'hide') { a.axHide = !a.axHide; renderAll(); } else if (b.dataset.a === 'zones') { a.axZones = !a.axZones; renderAll(); } else if (b.dataset.a === 'env') { a.axEnv = !a.axEnv; renderAll(); } else if (b.dataset.a === 'trans') { a.trans = !a.trans; localStorage.setItem('mw3d-trans', a.trans ? '1' : '0'); renderAll(); } })); },
    cancel: { run: analyzeOff, title: tt('Close analysis') } };
  return {
    title: `◐ ${tt('Analyze')}`, cls: 'an',
    controls: `${cp.html}<label title="${tt('Centre of the color scale. Zone mid (default, ISO 1101): green = middle of the form zone; 0 = fitted element; custom = your value')}">${tt('Centre')} <select id="an-cm"><option value="zone" ${a.center === 'zone' ? 'selected' : ''}>${tt('Zone mid')}</option><option value="zero" ${a.center === 'zero' ? 'selected' : ''}>0</option><option value="custom" ${a.center === 'custom' ? 'selected' : ''}>${tt('Custom')}</option></select></label>
      ${a.center === 'custom' ? `<input id="an-c0" data-num="signed" type="number" step="0.001" value="${a.c0}" inputmode="decimal" title="${tt('Custom centre [mm]')}" style="width:70px">` : ''}
      <label title="${tt('Half range of the color scale ± [mm] around the centre. 0 = automatic: zone/2, or t/2 if a form tolerance exists')}">${tt('Range ±')} <input id="an-sc" type="number" min="0" step="0.01" value="${a.scale}" inputmode="decimal"></label>
      <label title="${tt('Color classes: the colour scale is split into this many equal bands. Example: 10 classes over ±0.05 mm (range 0.1 mm) = bands of 0.01 mm. 0 = continuous gradient. Blue = below, green = middle, red = above.')}">${tt('Classes')} <input id="an-st" type="number" min="0" max="40" step="1" value="${a.steps}"></label>
      <button data-a="whisk" class="${a.whisk ? 'on' : ''}" ${a.res.dir ? '' : 'disabled'} title="${tt('Deviation arrows: one colored arrow per point along the surface normal, length = deviation × exaggeration')}">➚ ${tt('Arrows')}</button>
      <label title="${tt('Exaggeration: arrow length = deviation × this factor (deviations are often µm, invisible at 1×)')}">× <input id="an-ex" type="number" min="1" step="10" value="${a.exag}"></label>
      <button data-a="zones" class="${a.zones ? 'on' : ''}" ${a.kind === 'form' ? '' : 'disabled'} title="${tt('Show the bounding surfaces of the form zone (ISO 1101), e.g. two parallel planes for flatness, two coaxial cylinders for cylindricity')}">▤ ${tt('Zone')}</button>
      <button data-a="trans" class="${a.trans ? 'on' : ''}" title="${tt('Transparent model: the scan is drawn semi-transparent under the color map so hidden features/zones show through (same switch as Analyze › Transparent, remembered)')}">◌ ${tt('Transparent')}</button>
      <button data-a="help" title="${tt('Explain the analysis settings')}">?</button>${otherLabelsHtml()}${deriveHtml()}`,
    bind: (el) => {
      cp.bind(el); bindDerive(el);
      const num = (id: string, f: (v: number) => void, neg = false) => { const i = el.querySelector<HTMLInputElement>(id); if (!i) return; i.onchange = () => { const v = Number(i.value.replace(',', '.')); if (isFinite(v) && (neg || v >= 0)) { f(v); renderScene(); } }; };
      num('#an-sc', (v) => (a.scale = v)); num('#an-st', (v) => (a.steps = Math.round(v))); num('#an-ex', (v) => (a.exag = Math.max(1, v))); num('#an-c0', (v) => (a.c0 = v), true);
      const cm = el.querySelector<HTMLSelectElement>('#an-cm')!; cm.onchange = () => { a.center = cm.value as any; renderAll(); };
      el.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) => (b.onclick = () => {
        const k = b.dataset.a;
        if (k === 'help') { showDocs('analyze'); return; }
        if (k === 'whisk') { a.whisk = !a.whisk; if (a.whisk && a.res && a.res.dev.length > 1e6) toast(tt('{0} points – more than 1 million: arrows are thinned out to 4000 for display speed', a.res.dev.length.toLocaleString())); }
        else if (k === 'zones') a.zones = !a.zones; else { a.trans = !a.trans; localStorage.setItem('mw3d-trans', a.trans ? '1' : '0'); } renderAll();
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
document.querySelector('#btn-an-trans')?.addEventListener('click', () => { state.an.trans = !state.an.trans; localStorage.setItem('mw3d-trans', state.an.trans ? '1' : '0'); status(state.an.trans ? tt('Model semi-transparent in Analyze – click again for opaque.') : tt('Model opaque.')); renderAll(); });
document.querySelector('#btn-an-set')?.addEventListener('click', () => { if (!state.an.on) analyze(state.an.kind); else document.querySelector<HTMLInputElement>('#an-sc')?.focus(); });

// ------------------------------------------------------------------ Auswahl, Prüfmerkmale
function setAuxPlane(id: number) {
  auxPickArm = false; state.opts.aux = lastAuxPlane = id; const pv = state.preview;
  status(tt('Aux plane: {0} – now click the hole wall.', nameOf(id)));
  if (pv?.hit && ['Kreis', 'Langloch', 'Linie'].includes(pv.fit.type)) previewWithAux(pv.hit, pv.fit.type as 'Kreis').catch((e) => toast(e.message)).then(() => renderAll()); else renderAll();
}
function selectFeature(id: number, additive = false) {
  if (auxPickArm && state.features.find((f) => f.id === id)?.type === 'Ebene') { setAuxPlane(id); return; }
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
  const b = document.createElement('button'), on = diaInfo(c, f).on; b.className = 'btn dia-tg' + (on ? ' on' : ''); b.textContent = on ? `Ø ${tt('cylinder')}` : `∥ ${tt('2 planes')}`;
  b.title = (on ? tt('Zone shape: CYLINDER Ø t around the nominal axis (drawing shows Ø before the tolerance value).') : tt('Zone shape: TWO PARALLEL PLANES t apart (drawing shows no Ø; direction = worst case if the drawing gives none).')) + ' ' + tt('Click to switch the zone shape. The zone is always drawn in Analyze.');
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
    const sel = document.createElement('select'); sel.className = 'dslot' + (i === 0 && !ids.length ? ' req' : ''); sel.dataset.slot = String(i);
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
/** Direction (world vector) described in the current display CS, e.g. "+X (Global (WCS))" or "≈ −Y, 3.2° off". */
/** Control whose datum reference frame is being edited: selected control, analysed control, or the Position/Profile
 *  control of the selected feature (Control Properties). */
function drfControl(): Control | undefined {
  const pick = (c?: Control) => (c && c.datumIds?.length && isDatumControl(c.kind) ? c : undefined);
  return pick(state.controls.find((c) => c.id === (state.selControl ?? state.an.ctrl)))
    ?? (state.sel.length === 1 ? state.controls.find((c) => c.featureIds[0] === state.sel[0] && (c.kind === 'Position' || c.kind === 'Profil (Bezug)') && c.datumIds?.length) : undefined);
}
/** DRF triad (origin + axes of the datum system, contact datums as in the evaluation) while a datum control is edited. */
function renderDrfTriad() {
  const c = drfControl(); if (!c) return;
  const ds = (c.datumIds ?? []).map((i) => state.features.find((x) => x.id === i)); if (ds.some((d) => !d?.measured || !d.datum)) return;
  try { const F = buildDRF(simulateDatums(ds as Feature[], ctx).feats); viewer.addTriad(F.o, [F.x, F.y, F.z], `DRF ${F.text}`, false, true); } catch { /* incomplete DRF */ }
}
function dirName(w: number[]): string {
  const fr = activeFrame(), d = fr ? csDir(fr, w as Vec3) : w, i = [0, 1, 2].reduce((q, k) => (Math.abs(d[k]) > Math.abs(d[q]) ? k : q), 0);
  const L = Math.hypot(d[0], d[1], d[2]) || 1, off = (Math.acos(Math.min(1, Math.abs(d[i]) / L)) * 180) / Math.PI;
  return `${off > 0.5 ? '≈ ' : ''}${d[i] < 0 ? '−' : '+'}${'XYZ'[i]} ${tt('of {0}', activeCsName())}${off > 0.5 ? ` (${fmt(off, 1)}° ${tt('off')})` : ''}`;
}
/** TED field label by drawing meaning: “from B” (location measured from datum B) – DRF axis + display direction in the tooltip. */
function tedLabel(t: TedField): string { return t.from && t.k <= 2 ? tt('from {0}', t.from) : t.label; }
function tedDirTip(t: TedField): string { return t.dirW && t.k <= 2 ? ` · ${tt('DRF axis {0} = {1}', 'XYZ'[t.k], dirName(t.dirW))}` : ''; }
function tedEl(c: Control, t: TedField, after: () => void, inline = false): HTMLElement {
  const wrap = document.createElement(inline ? 'label' : 'span'); wrap.className = 'ted-f ' + t.state;
  const conf = c.basic?.[t.k] != null && isFinite(c.basic[t.k]!), sug = !conf && t.state === 'req' && t.sug != null;
  if (inline) wrap.append(tedLabel(t) + ' ');
  const i = document.createElement('input'); i.inputMode = 'decimal'; i.dataset.num = 'signed'; i.className = 'ted' + (sug ? ' sug' : '') + (t.state === 'req' && !conf && !sug ? ' req' : '');
  i.dataset.ted = String(t.k);
  i.value = conf ? String(c.basic![t.k]) : sug ? String(t.sug) : '';
  i.placeholder = t.state === 'free' ? tt('n/a') : t.state === 'opt' ? tt('optional') : tt('required');
  i.disabled = t.state === 'free';
  i.title = tt(t.why) + tedDirTip(t) + (sug ? ' · ' + tt('Suggested from the actual part (unconfirmed): tick ✓ to confirm, or type the drawing value') : '');
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
  const spec = tedSpec(c, f, ds, ctx);
  for (const t of spec) lab(tedLabel(t), tedEl(c, t, () => renderAll()));
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
/** Per-hole table of a Position control (pattern and/or Ⓜ/Ⓛ): Ø, permitted t (+bonus), margin; worst-margin hole marked. */
function membersHtml(c: Control, r: ControlResult, open = false): string {
  const M = r.members; if (!M || (M.length < 2 && !c.mod)) return '';
  const rows = M.map((m, i) => `<tr class="${i === r.worst ? 'worst' : ''}${m.margin < 0 ? ' nio' : ''}"><td>${i === r.worst ? '▶ ' : ''}${m.name}</td><td>${fmt(m.dia, 4)}</td>${c.mod ? `<td title="${bonusTip(m.bx)}">${m.bx ? (m.bx.beyond ? '⚠ ' : '') + fmt(m.bx.ms, 4) : '—'}</td>` : ''}<td>${fmt(c.tolUp, 4)}${c.mod ? ` + ${fmt(m.bonus, 4)}` : ''}</td><td>${fmt(m.tol, 4)}</td><td>${sgn(m.margin, 4)}</td></tr>`).join('');
  const w = M[r.worst ?? 0];
  return `<details class="pm" ${open ? 'open' : ''}><summary title="${tt('Per hole: measured position Ø, permitted tolerance (t + bonus from Ⓜ/Ⓛ) and margin = permitted − measured. ▶ = hole with the smallest margin (decides OK/NOK)')}">${M.length > 1 ? tt('{0} holes', M.length) + ' · ' : ''}${M.length > 1 ? tt('worst margin') : tt('margin')} ${sgn(w.margin, 4)}${M.length > 1 ? ` (${w.name})` : ''}</summary>
    <table><thead><tr><th>${tt('Hole')}</th><th title="${tt('Position Ø (measured)')}">${tt('Pos. Ø')}</th>${c.mod ? `<th title="${tt('Mating size used for the bonus (hover a value for details)')}">${tt('size Ø')}</th>` : ''}<th>t${c.mod ? ' + ' + tt('bonus') : ''}</th><th>${tt('permitted')}</th><th>${tt('margin')}</th></tr></thead><tbody>${rows}</tbody></table></details>`;
}
/** Text after the value in the frame: Ⓜ/Ⓛ and CZ. */
const frameMods = (c: Control, f?: FeatureView) => `${c.mod ? MOD_SYM[c.mod] : ''}${f && isPattern(f) && c.cz !== false ? ' CZ' : ''}`;
/** Tooltip of 'Exclude raised' (All inside boundary) – same text everywhere; the ? link opens the docs section. */
const raisedTip = () => tt('Exclude raised: raised regions inside the outer contour that belong to another feature (boss, sphere, step – surface rising above the search distance with steep walls, a flat top or higher than 2.5 mm) are shown in magenta. OFF (default) = they count to the plane (e.g. flatness incl. bumps and spatter). ON = they are excluded as a whole. ? = documentation with a picture.');
const raisedHelp = () => `<button type="button" class="help-q" data-doc-sec="fill" title="${tt('Exclude raised – documentation')}">?</button>`;
/** Ⓜ/Ⓛ: permitted tolerance as a sum, 'tol 0.100 + bonus 0.030 = 0.130' (worst member), or null without a modifier. */
function tolSum(c: Control, r: ControlResult, d = 3): string | null {
  if (!c.mod || r.measured == null || r.flag === NOMINAL_MISSING) return null;
  const m = r.members?.[r.worst ?? 0], b = m ? m.bonus : (r.bonus ?? 0);
  return `${tt('tol')} ${fmt(c.tolUp, d)} + ${tt('bonus')} ${fmt(b, d)} = ${fmt(c.tolUp + b, d)}`;
}
/** Tooltip with the size behind the bonus: hole/shaft, mating size vs Gauss Ø, MMC/LMC, why no bonus. */
function bonusTip(bx?: BonusInfo): string {
  if (!bx) return tt('Bonus tolerance from Ⓜ/Ⓛ (added to the tolerance)');
  const M = bx.mod === 'M', lim = M ? 'MMC' : 'LMC';
  const size = M ? (bx.hole ? tt('mating size (largest inscribed cylinder)') : tt('mating size (smallest circumscribed cylinder)')) : (bx.hole ? tt('least-material size (smallest circumscribed cylinder)') : tt('least-material size (largest inscribed cylinder)'));
  return `${bx.hole ? tt('Hole') : tt('Shaft')} · ${size} Ø ${fmt(bx.ms, 4)}${bx.gauss != null ? ` (${tt('Gauss')} Ø ${fmt(bx.gauss, 4)})` : ''} · ${tt('size')} ${fmt(bx.nominal, 3)} ${sgn(bx.tolUp, 3)}/${sgn(bx.tolLo, 3)} · ${lim} ${fmt(bx.limit, 4)} → ${tt('bonus')} ${fmt(bx.bonus, 4)}`
    + (bx.beyond ? ` · ⚠ ${tt('the size is beyond the {0} – no bonus (scan points inside the hole make the inscribed size smaller than the Gauss Ø)', lim)}` : bx.capped ? ` · ⚠ ${tt('capped at the size tolerance range – size outside its limits')}` : '');
}
const bonusText = (c: Control, r: ControlResult) => { const s = tolSum(c, r, 4), bx = r.members?.[r.worst ?? 0]?.bx;
  return s ? ` <small class="bonus${bx?.beyond ? ' warn' : ''}" title="${bonusTip(bx)}">${bx?.beyond ? '⚠ ' : ''}${s}</small>` : ''; };

function addControl(kind: ControlKind, id: number) {
  const t = defaultTolerance(kind);
  const c: Control = { id: state.nextCtrl++, kind, featureIds: [id], nominal: t.nominal, tolUp: t.up, tolLo: t.lo };
  if (isDatumControl(kind)) { c.datumIds = []; /* no auto-prefill: the user picks Primary (required) → Secondary → Tertiary */ if (kind === 'Neigung') c.basic = [null]; else if (kind === 'Position' || kind === 'Profil (Bezug)') c.basic = [null, null, null]; } // TED never prefilled: user enters drawing values
  state.controls.push(c); applyTol(c);
  state.selControl = state.nextCtrl - 1;
}
// ---------------- general tolerances (ISO 2768-1/-2) and fits (ISO 286): auto-filled, typed values override
const SIZE_KINDS = ['Durchmesser', 'Länge', 'Breite', 'Rohrdurchmesser', 'Abstand 3D', 'Abstand X', 'Abstand Y', 'Abstand Z'];
function tolKindOf(c: Control, f?: FeatureView): TolKind | null {
  const k = c.kind as string;
  if (SIZE_KINDS.includes(k)) return 'size';
  if (k === 'Radius' || k === 'Rohrradius') return 'radius';
  if (k.startsWith('Winkel') || k === 'Kegelwinkel') return 'angle';
  if (k === 'Form') return f?.type === 'Ebene' || f?.type === 'Linie' ? 'straight' : f?.type === 'Kreis' ? 'round' : null;
  if (k === 'Rechtwinkligkeit') return 'perp'; if (k === 'Symmetrie') return 'sym'; if (k === 'Parallelität') return 'parallel';
  if (k === 'Rundlauf' || k === 'Gesamtrundlauf') return 'runout';
  return null;
}
/** relevant length of a feature for ISO 2768 (plane extent, line length, shorter angle leg): bounding-box diagonal of its points */
function featExtent(f?: FeatureView): number {
  if (!f) return 0; const m = f.measured; const P = featPoints(f.id);
  if (P && P.length >= 2) { const a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity]; const st = Math.max(1, Math.floor(P.length / 5000));
    for (let i = 0; i < P.length; i += st) for (let k = 0; k < 3; k++) { a[k] = Math.min(a[k], P[i][k]); b[k] = Math.max(b[k], P[i][k]); } return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); }
  return Math.max(m?.length ?? 0, m?.diameter ?? 0, m?.width ?? 0);
}
const fitApplies = (c: Control) => SIZE_KINDS.includes(c.kind as string) || c.kind === 'Radius';
/** (re)fill the tolerance of a control from its fit code or the project's general tolerance – unless typed by hand */
function applyTol(c: Control, force = false): void {
  if (!prefs.tolTables) return; // Options: tolerance tables off = manual tolerances (pre-0.24), nothing auto-filled
  if (c.tolSrc === 'manual' && !force) return;
  const fm = featMap(), f = fm.get(c.featureIds[0]) as FeatureView | undefined, kind = tolKindOf(c, f); if (!kind) return;
  let val = c.nominal; if (val == null) { try { val = evaluate({ ...c, nominal: null }, fm, ctx).measured; } catch { val = null; } }
  if (val == null && kind !== 'runout') return;
  const v = Math.abs(val ?? 0);
  let L = featExtent(f);
  if (c.datumIds?.length && (kind === 'perp' || kind === 'parallel')) L = Math.min(L || Infinity, ...c.datumIds.map((id) => featExtent(fm.get(id) as FeatureView)).filter((x) => x > 0));
  if (kind === 'angle' && f?.refs?.length) L = Math.min(...f.refs.map((id) => featExtent(fm.get(id) as FeatureView)).filter((x) => x > 0), L || Infinity);
  let out: { up: number; lo: number; src: string } | null = null;
  if (c.fit && fitApplies(c)) { const r = iso286(c.fit, c.kind === 'Radius' ? 2 * v : v); if (r) out = { up: c.kind === 'Radius' ? r.up / 2 : r.up, lo: c.kind === 'Radius' ? r.lo / 2 : r.lo, src: `ISO 286 ${c.fit}` }; }
  if (!out) out = generalTol(kind, state.opts.genTol ?? GENTOL_DEFAULT, v, L, f?.measured?.diameter);
  if (!out) { if (c.tolSrc && c.tolSrc !== 'manual') c.tolSrc = undefined; return; }
  c.tolUp = out.up; c.tolLo = isZoneControl(c.kind) ? 0 : out.lo; c.tolSrc = out.src;
}
function reapplyAllTol() { for (const c of state.controls) applyTol(c); }
/** tolerance source badge: general tolerance / fit / manual (↺ = back to the general tolerance) */
function tolSrcEl(c: Control): HTMLElement {
  const s = document.createElement('span'); s.className = 'tsrc' + (c.tolSrc === 'manual' ? ' man' : '');
  const k = tolKindOf(c, featMap().get(c.featureIds[0]) as FeatureView | undefined);
  s.textContent = c.tolSrc === 'manual' ? tt('manual') : c.tolSrc ?? (k ? tt('default') : '');
  s.title = c.tolSrc === 'manual' ? tt('Tolerance typed by hand (overrides the general tolerance). ↺ = back to the general tolerance / fit.') : c.tolSrc ? tt('Tolerance from {0} (project general tolerance or fit code); typing a value overrides it.', c.tolSrc) : tt('Built-in default tolerance (no general tolerance applies).');
  if (c.tolSrc === 'manual') { const b = document.createElement('button'); b.type = 'button'; b.className = 'tsrc-rs'; b.textContent = '↺'; b.title = tt('Back to the general tolerance / fit'); b.onclick = (e) => { e.stopPropagation(); c.tolSrc = undefined; applyTol(c, true); renderAll(); scheduleAutosave(); }; s.appendChild(b); }
  return s;
}
function fitInput(c: Control): HTMLInputElement {
  const i = document.createElement('input'); i.type = 'text'; i.className = 'fitcode'; i.value = c.fit ?? ''; i.placeholder = 'H7'; i.size = 4; i.autocapitalize = 'off'; i.spellcheck = false;
  i.title = tt('ISO 286 fit (e.g. H7 hole, g6 shaft, JS9): the tolerances follow from the nominal size. Empty = general tolerance.');
  i.onchange = () => { const v = i.value.trim(); if (v && !iso286(v, Math.max(1, Math.abs(c.nominal ?? 10)))) { toast(tt('Unknown fit code {0} (ISO 286, sizes up to 500 mm)', v)); i.value = c.fit ?? ''; return; }
    c.fit = v || undefined; c.tolSrc = undefined; applyTol(c, true); renderAll(); scheduleAutosave(); };
  return i;
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
  const r = buildReport(state.nextReport++, state.features, state.controls, state.data?.name ?? '', new Date(), ctx, { tolTables: prefs.tolTables });
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
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !state.mode && pe.undo.length && !pe.running) { e.preventDefault(); peUndo(); return; } // QAT ↶
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
  // phone portrait: Dialog and Control Properties are both bottom sheets – one at a time (the 3D view stays visible above)
  if (show && window.matchMedia('(max-width:700px)').matches && (p === 'dialog' || p === 'table')) document.body.classList.remove(p === 'dialog' ? 'show-table' : 'show-dialog');
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
function refreshProps() { const el = document.getElementById('props-dlg'), b = el?.querySelector('#props-body'); if (!el || !b) return;
  const f = state.features.find((x) => x.id === +el.dataset.fid!); if (!f?.measured) { el.remove(); return; } const h = propertiesHTML(f); if (b.innerHTML !== h) b.innerHTML = h; }
function renderAll() { refreshProps(); (document.getElementById('btn-props') as HTMLButtonElement | null)?.toggleAttribute('disabled', !csSelected() && (state.sel.length !== 1 || !state.features.some((x) => x.id === state.sel[0]))); (document.getElementById('btn-delete-feat') as HTMLButtonElement | null)?.toggleAttribute('disabled', !csSelected() && !state.sel.length && state.selControl == null); if (document.getElementById('cs-ind')) renderCsIndicator(); renderModeBar(); renderRibbon(); renderTree(); renderDialog(); renderTable(); renderScene(); renderHint(); renderReport(); scheduleAutosave(); }

function renderRibbon() {
  renderPolyRibbon(); // mesh group: ↶ (QAT), Restore original, status in the group label
  document.querySelectorAll<HTMLButtonElement>('[data-ftype]').forEach((b) => b.classList.toggle('on',
    (state.mode?.kind === 'fit' && state.mode.type === b.dataset.ftype) || (state.mode?.kind === 'dist' && b.dataset.ftype === 'Abstand')));
  document.querySelectorAll<HTMLButtonElement>('[data-con]').forEach((b) => b.classList.toggle('on', state.mode?.kind === 'con' && (b.dataset.con === state.mode.out || b.dataset.con === state.mode.key) && !(b.dataset.con === 'Kreis' && state.mode.key === 'bc-pattern')));
  $('#btn-toggle-prims').classList.toggle('on', state.showPrims);
  document.querySelector('#btn-an-trans')?.classList.toggle('on', !!state.an.trans);
  $('#btn-toggle-zone')?.classList.toggle('on', showZone); document.querySelector('#view-gear [data-vg="zone"]')?.classList.toggle('on', showZone);
  document.querySelectorAll<HTMLInputElement>('[data-rxz]').forEach((i) => (i.checked = showZone));
  $('#btn-toggle-pts').classList.toggle('on', state.colorPts);
  $('#btn-toggle-aux').classList.toggle('on', state.colorAux);
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
  if (state.preview && state.opts.multi && MULTI_TYPES.includes(state.preview.fit.type)) return hint(tt('Add region: click further faces of the {0} (Shift+click also works), then ✓ create.', typeName(state.preview.fit.type)));
  if (state.preview) return hint(tt('Preview – check the values, then ✓ create or ✕ discard.'));
  if (m.method === 'Klick') return hint(tt('{0}: click/tap on the surface – the circle is the pick radius (seed area; for circles place it across the hole edge). Pick mode: the mouse does not move the view – wheel = pick radius, Space = navigation.', m.type === 'auto' ? tt('Auto detection') : typeName(m.type)));
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
  // 0.33: groups Data + Reference (future home of the CAD model); a pinned group stays visible at the top of the tree
  const pinBtn = (d: HTMLElement, k: 'data' | 'ref', extra = '') => { const b = document.createElement('span'); b.className = 'pin-btn' + (treePins.has(k) ? ' on' : ''); b.textContent = '📌';
    b.title = treePins.has(k) ? tt('Unpin – back to its place in the tree') : tt('Pin: keep this group visible at the top of the tree (display only)'); b.dataset.pin = k;
    b.onclick = (e) => { e.stopPropagation(); if (treePins.has(k)) treePins.delete(k); else treePins.add(k); try { localStorage.setItem('mw3d-tree-pins', JSON.stringify([...treePins])); } catch { /* */ } renderTree(); };
    d.appendChild(b); if (extra) d.classList.add(extra); if (treePins.has(k)) d.classList.add('pin'); return d; };
  const dataGroup = () => {
    const pin = treePins.has('data'), c = pin ? ' pin' : '';
    pinBtn(node(`<span class="tw">▾</span>${ICON.data}${tt('Data')}`, 'indent1 grp-data' + c, undefined, false, undefined, state.data ? eyeBtn(state.modelVisible, () => { state.modelVisible = !state.modelVisible; renderAll(); }) : undefined), 'data');
    if (state.data) {
      const mn = node(`<span class="tw"></span>${ICON.mesh}${state.data.name} <span class="sub">(${tt('polygon model')})</span>`, 'indent2 model-node' + c, () => selectModel(), state.selModel, undefined,
        eyeBtn(state.modelVisible, () => { state.modelVisible = !state.modelVisible; renderTree(); renderScene(); }));
      mn.ondblclick = () => centerOn(null); attachContext(mn, null);
    }
  };
  const refGroup = () => { const n = pinBtn(node(`<span class="tw"></span>${ICON.folder}${tt('Reference')} <span class="sub">(${tt('empty – CAD model later')})</span>`, 'indent1 grp-ref' + (treePins.has('ref') ? ' pin' : '')), 'ref');
    n.title = tt('Reference: the nominal/CAD model will live here'); };
  if (treePins.has('data')) dataGroup(); if (treePins.has('ref')) refGroup();
  node(`<span class="tw">▾</span>${ICON.folder}<b>${tt('Objects')}</b>`, '');
  if (!treePins.has('data')) dataGroup(); if (!treePins.has('ref')) refGroup();
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
    fnode.ondblclick = (e) => { e.preventDefault(); openFeatureProps(f); };
    fnode.title = tt('Double-click: Properties (editable) · right-click: menu');
    attachContext(fnode, f.id);
    if (f.measured) { const an = node(`<span class="tw"></span>${ICON.ist}${tt('Actual')}${f.type === 'Abstand' ? ` <span class="sub">${fmt(distValue(f.measured, f.dim?.comp ?? '3D'), 3)} mm</span>` : ''}`, 'indent3', () => selectFeature(f.id));
      an.title = tt('Actual geometry – right-click or double-click: read-only properties (points, fit results, statistics)');
      an.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); showMenu(e.clientX, e.clientY, [[`ⓘ ${tt('Properties…')}`, () => showProperties(f)], [`⌖ ${tt('Center')}`, () => centerOn(f.id)]]); };
      an.ondblclick = (e) => { e.preventDefault(); showProperties(f); }; }
    if (f.aux) node(`<span class="tw"></span>${ICON.aux}${tt('Aux. plane')} <span class="sub">${f.aux.refId ? '(' + nameOf(f.aux.refId) + ')' : ''}</span>`, 'indent3 aux-node', () => selectFeature(f.id));
    if (f.soll) node(`<span class="tw"></span>${ICON.soll}${tt('Nominal')}`, 'indent3', () => selectFeature(f.id));
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
  // pinned groups: sticky at the top (stacked)
  let top = 0; const pinned = [...t.querySelectorAll<HTMLElement>('.node.pin')].filter((e) => e.style.display !== 'none');
  pinned.forEach((e, i) => { e.style.top = top + 'px'; top += e.offsetHeight; if (i === pinned.length - 1) e.classList.add('pin-last'); });
  // empty space in the tree clears the selection (features, data object, coordinate system, control)
  t.onclick = (e) => { if (!(e.target as HTMLElement).closest('.node')) clearSelection(); };
}
const treePins = new Set<string>((() => { try { return JSON.parse(localStorage.getItem('mw3d-tree-pins') ?? '[]'); } catch { return []; } })());
const CURVE_KIND_EN: Record<string, string> = { Kante: 'edge', Tangente: 'tangent', Übergang: 'transition', Benutzer: 'user', Vorschlag: 'seam' };
function selectModel() { if (state.mode?.kind === 'dist') return; state.sel = []; state.selModel = true; state.selControl = null; state.curveSel = null; renderAll(); }
function clearSelection() { if (!state.sel.length && !state.selModel && state.curveSel == null && state.csSel == null && state.selControl == null) return; state.sel = []; state.selModel = false; state.csSel = null; state.selControl = null; state.curveSel = null; renderAll(); }
($('#search') as HTMLInputElement).oninput = () => renderTree();

/** Numeric field (central helper, see ui/numfield): kind 'abs' = magnitude only, 'signed' = ± toggle, 'neg' = Tol− (a plain
 *  number counts as negative, '+' or the ± toggle makes it positive). onChange gets the parsed value and the raw text. */
function numInput(v: number | null, onChange: (x: number | null, raw: string) => void, kind: 'abs' | 'signed' | 'neg' | 'any' = 'any') {
  const i = document.createElement('input'); i.type = 'text'; i.inputMode = 'decimal';
  if (kind !== 'any') i.dataset.num = kind === 'neg' ? 'signed' : kind; if (kind === 'neg') i.dataset.numNeg = '1';
  i.value = v == null ? '' : kind === 'neg' && v > 0 ? '+' + v : String(v);
  i.onchange = () => { const raw = i.value.trim(), x = parseNum(raw); if (x === null || isFinite(x)) onChange(x, raw); renderAll(); };
  return i;
}
/** Tol− from its field: plain number = negative deviation, explicit '+' = positive (e.g. +0.2/+0.1) */
const tolLoOf = (x: number | null, raw: string) => (x == null ? 0 : raw.replace(/\s/g, '').startsWith('+') ? Math.abs(x) : -Math.abs(x));

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
  if (m.crit && m.crit !== 'lsq') rows.push([tt('Fit criterion'), tt(CRIT_NAME[m.crit])]);
  if (full && m.formBy) for (const c of FIT_CRITS) if (m.formBy[c] != null) rows.push([`${FORM_NAME[m.type]} (${tt(CRIT_SHORT[c])})`, fmt(m.formBy[c]!)]);
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
    ${usesAuxType(m.type) ? `<h4>${ICON.aux} ${tt('Auxiliary plane (projection plane)')}</h4>
    <div class="row"><select id="d-aux"><option value="auto" ${state.opts.aux === 'auto' ? 'selected' : ''}>${tt('Automatic – full adjacent planar face')}</option><option value="ring" ${state.opts.aux === 'ring' ? 'selected' : ''}>${tt('Local ring around the contour')}</option>
      ${state.features.filter((f) => f.type === 'Ebene').map((f) => `<option value="${f.id}" ${state.opts.aux === f.id ? 'selected' : ''}>${tt('Existing plane')}: ${f.name}</option>`).join('')}
      <option value="none" ${state.opts.aux === 'none' ? 'selected' : ''}>${tt('None (3D fit)')}</option></select></div>
    ${state.opts.aux === 'ring' ? `<div class="row"><label>${tt('Ring gap [mm]')}</label><input id="d-rg" data-num="abs" value="${state.opts.ring.gap}" inputmode="decimal"></div><div class="row"><label>${tt('Ring width [mm]')}</label><input id="d-rw" data-num="abs" value="${state.opts.ring.width}" inputmode="decimal"></div><p class="note">${tt('Only the plane points in a ring (circle), stadium band (slot) or band along the edge (line) are used: starting at the gap outside the edge, with the given width. Useful when the face is not flat far away from the hole.')}</p>` : ''}
    <p class="note">${m.type === 'Linie' ? tt('Click on the edge between two faces. The line is the intersection edge fitted inside the auxiliary plane; choose which adjacent face is the auxiliary plane in the Action Bar.') : tt('Click near the transition face/wall (or on the wall): the wall points are projected into the plane and the feature is fitted in the plane. The center lies in the plane, orientation = plane normal.')}</p>` : ''}`
    : `<h4>${tt('Brush')}</h4><p class="note">${tt('Paint: stroke over the mesh. Erase: Erase button or hold Shift. Undo: Ctrl+Z. Esc clears the selection, a second Esc returns to Click & grow.')}</p>`}
    ${p ? `<h4>${tt('Preview')}: ${typeName(p.fit.type)}</h4>${p.aux ? auxStats(p) : ''}${kv(fitRows(p.fit, p.indices.length))}
      ${p.candidates.length ? `<h4>${tt('Detection (RMS per type)')}</h4>${kv(p.candidates.map((c) => [typeName(c.type), fmt(c.rms)] as [string, string]))}` : ''}`
    : `<p class="note">${tt('A click first creates a preview (points + geometry + values). Only ✓ creates the feature.')}</p>`}`;
  const bind = (id: string, key: 'maxAngleDeg' | 'radius' | 'brush') => { const el = d.querySelector<HTMLInputElement>(id); if (el) el.onchange = () => { const x = Number(el.value.replace(',', '.')); if (isFinite(x)) { state.opts[key] = x; renderModeBar(); } }; };
  bind('#d-ang', 'maxAngleDeg');
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
    <div class="row chk"><label><input type="checkbox" id="d-vis" ${state.hidden.has(f.id) ? '' : 'checked'}> ${tt('Geometry visible')}</label><label><input type="checkbox" id="d-lab" ${state.hiddenLabels.has(f.id) ? '' : 'checked'}> ${tt('Annotation visible')}</label>${f.indices?.length && f.type !== 'Abstand' ? `<label title="${tt('Show the points used in the fit, in the feature colour')}"><input type="checkbox" id="d-pts" ${state.colorPts || state.usedPts.has(f.id) ? 'checked' : ''}> ${tt('Used points')}</label>` : ''}${f.auxIndices?.length ? `<label title="${tt('Show the points of the fitted auxiliary plane, in blue')}"><input type="checkbox" id="d-auxpts" ${state.colorAux || state.usedAux.has(f.id) ? 'checked' : ''}> ${tt('Aux-plane points')}</label>` : ''}</div>
    ${dk ? dsec('datum', `<span class="dflag sm">${f.datum ?? '?'}</span> ${tt('Datum (ISO 5459)')}`, `<div class="row" id="dt-box"><select id="dt-letter">${DATUM_LETTERS.slice(0, 10).map((l) => { const o = state.features.find((g) => g.datum === l && g.id !== f.id);
        return `<option value="${l}" ${(f.datum ?? nextFreeLetter()) === l ? 'selected' : ''}>${l}${o ? ` (${tt('swap with {0}', o.name)})` : ''}</option>`; }).join('')}</select>
        <button class="btn primary" id="dt-apply">${f.datum ? tt('Rename') : tt('Assign datum')}</button></div>
      ${f.datum ? `<div class="row"><button class="btn" id="dt-remove">${tt('Remove datum {0}', f.datum)}</button><span class="note">${tt('{0} control(s) use {1}', dependents(f.id).length, f.datum)}</span></div>` : ''}
      <p class="note">${dk === 'plane' ? tt('Plane as datum: defines a direction (normal) and location.') : dk === 'axis' ? tt('Axis as datum (hole/shaft): defines axis direction and location.') : tt('Center point as datum.')}
        <button class="linkbtn" id="dt-training">🎓 ${tt('Training mode: datums')}</button></p>`, true) : ''}
    ${dsec('sel', '① ' + tt('Point selection'), `${f.refs && !f.cons ? `<div class="note">${tt('References')}: ${nameOf(f.refs[0])} → ${nameOf(f.refs[1])}</div>` : ''}${conDefinitionHTML(f)}${provenanceHTML(f)}${selectionParamsHTML(f)}`, true)}
    ${reexHTML(f) ? '' : dsec('flt', '② ' + tt('Filters'), filterParamsHTML(f), true)}
    ${f.type !== 'Abstand' && !f.cons ? dsec('fit', (reexHTML(f) ? '② ' : '③ ') + tt('Fit'), fitParamsHTML(f), true) : ''}
    ${reexHTML(f) || TRIM_TYPES.includes(f.type) ? dsec('adv', '⚙ ' + (reexHTML(f) ? tt('Advanced · Re-extraction') : tt('Advanced')), `${TRIM_TYPES.includes(f.type) ? `<div class="row">${smoothCtl('fp-smooth')}</div>` : ''}${reexHTML(f) ? `<p class="note">${tt('Rarely needed: re-extract the points of this actual feature with other parameters.')}</p>${reexHTML(f)}` : ''}`, false) : ''}
    <div class="row"><button class="linkbtn" id="d-props" title="${tt('Geometric properties of the actual feature – points, RMS, form deviation, position, direction … (read-only info window)')}">${tt('Geometric properties')} ›</button></div>
    <div><button class="btn" id="d-center">⌖ ${tt('Center')}</button><button class="btn" id="d-addctrl">＋ ${tt('Control …')}</button><button class="btn" id="d-an">◐ ${tt('Analyze deviation')}</button><button class="btn" id="d-del">${tt('Delete feature')}</button></div>`;
  d.querySelector('#dt-apply')?.addEventListener('click', () => setDatum(f, ($('#dt-letter') as HTMLSelectElement).value));
  bindSmooth(d, '#fp-smooth');
  d.querySelector('#dt-remove')?.addEventListener('click', () => setDatum(f, null));
  d.querySelector('#dt-training')?.addEventListener('click', () => startTraining());
  d.querySelector('#d-center')?.addEventListener('click', () => centerOn(f.id));
  d.querySelector('#d-props')?.addEventListener('click', () => showProperties(f));
  d.querySelector('#d-an')?.addEventListener('click', () => { state.sel = [f.id]; analyze('form'); });
  ($('#d-name') as HTMLInputElement).onchange = (e) => { f.name = (e.target as HTMLInputElement).value; renderAll(); };
  ($('#d-color') as HTMLInputElement).oninput = (e) => { f.color = parseInt((e.target as HTMLInputElement).value.slice(1), 16); f.colorSet = true; renderTree(); renderScene(); scheduleAutosave(); };
  ($('#d-vis') as HTMLInputElement).onchange = (e) => { (e.target as HTMLInputElement).checked ? state.hidden.delete(f.id) : state.hidden.add(f.id); renderTree(); renderScene(); };
  const dpts = d.querySelector<HTMLInputElement>('#d-pts'); if (dpts) dpts.onchange = () => { if (dpts.checked) state.usedPts.add(f.id); else { state.usedPts.delete(f.id); state.colorPts = false; } renderRibbon(); renderScene(); };
  const daux = d.querySelector<HTMLInputElement>('#d-auxpts'); if (daux) daux.onchange = () => { if (daux.checked) state.usedAux.add(f.id); else { state.usedAux.delete(f.id); state.colorAux = false; } renderRibbon(); renderScene(); };
  ($('#d-lab') as HTMLInputElement).onchange = (e) => { (e.target as HTMLInputElement).checked ? state.hiddenLabels.delete(f.id) : state.hiddenLabels.add(f.id); renderTree(); renderScene(); };
  ($('#d-del') as HTMLButtonElement).onclick = () => { state.selControl = null; deleteSelected(); };
  ($('#d-addctrl') as HTMLButtonElement).onclick = () => { state.addFeat = f.id; state.ctab = 'katalog'; renderTable(); togglePanel('table', true); };
  if (f.cons) bindConDefinition(d, f); else bindFitParams(d, f);
  bindReex(d, f); bindDsec(d);
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
/** collapsible dialog section; open state remembered per section (localStorage) */
const dsecOpen: Record<string, boolean> = (() => { try { return JSON.parse(localStorage.getItem('mw3d-dsec') || '{}'); } catch { return {}; } })();
const dsec = (id: string, title: string, body: string, def = true) => body.trim() ? `<details class="dsec" data-dsec="${id}" ${dsecOpen[id] ?? def ? 'open' : ''}><summary>${title}</summary><div class="dsec-b">${body}</div></details>` : '';
function bindDsec(d: HTMLElement) { d.querySelectorAll<HTMLDetailsElement>('details.dsec').forEach((x) => x.addEventListener('toggle', () => { dsecOpen[x.dataset.dsec!] = x.open; try { localStorage.setItem('mw3d-dsec', JSON.stringify(dsecOpen)); } catch { /* private mode */ } })); }
const CRIT_NAME: Record<FitCrit, string> = { lsq: 'Gauss (least squares)', mz: 'Minimum zone (Chebyshev)', mcc: 'Tangential circumscribed (minimum circumscribed)', mic: 'Tangential inscribed (maximum inscribed)' };
const CRIT_SHORT: Record<FitCrit, string> = { lsq: 'Gauss', mz: 'Min. zone', mcc: 'Circumscribed', mic: 'Inscribed' };
/** Point selection part of the feature dialog: how the points were found (region growing, aux plane, brush, file) */
function selectionParamsHTML(f: FeatureView) {
  if (f.measured?.nurbs || f.derived || f.cons || f.type === 'Abstand') return '';
  const fp = (f.fp ??= defaultFp()); const grow = !!f.hit && f.method === 'Klick';
  const planes = state.features.filter((g) => g.type === 'Ebene' && g.id !== f.id);
  return `<div id="fp-sel">
    ${grow ? `<div class="row"><label>${tt('Region growing: max. angle [°]')}</label><input id="fp-ang" value="${fp.maxAngleDeg}" inputmode="decimal"></div>` : `<p class="note">${f.method === 'Pinsel' ? tt('Points from brush selection – no region growing.') : tt('Points from project file – no region growing.')}</p>`}
    ${(f.type === 'Kreis' || f.type === 'Langloch' || f.type === 'Linie') && grow ? `<div class="row"><label>${tt('Auxiliary plane')}</label><select id="fp-aux"><option value="auto" ${fp.aux === 'auto' ? 'selected' : ''}>${tt('Automatic')}</option><option value="ring" ${fp.aux === 'ring' ? 'selected' : ''}>${tt('Local ring')}</option>
      ${planes.map((g) => `<option value="${g.id}" ${fp.aux === g.id ? 'selected' : ''}>${g.name}</option>`).join('')}<option value="none" ${fp.aux === 'none' ? 'selected' : ''}>${tt('None (3D fit)')}</option></select></div>
      ${fp.aux === 'ring' ? `<div class="row"><label>${tt('Ring gap / width [mm]')}</label><input id="fp-rg" data-num="abs" value="${fp.ring?.gap ?? state.opts.ring.gap}" inputmode="decimal" style="width:4em"><input id="fp-rw" data-num="abs" value="${fp.ring?.width ?? state.opts.ring.width}" inputmode="decimal" style="width:4em"></div>` : ''}` : ''}
  </div>`;
}
/** Filters – shown ONCE: in the Extraction section when it exists (re-extraction parameters), else here */
function filterParamsHTML(f: FeatureView) {
  if (f.measured?.nurbs || f.derived || f.cons || f.type === 'Abstand' || reexHTML(f)) return '';
  const fp = (f.fp ??= defaultFp()); const m = f.measured!;
  return `<div id="fp-flt">
    <div class="row" title="${tt('Outlier removal: points whose deviation from the fitted geometry is larger than n × the RMS (standard deviation) are removed – the points with the largest deviation. Unchecked = keep all points.')}"><label><input type="checkbox" id="fp-rob" ${fp.k ? 'checked' : ''}> ${tt('Exclude outliers beyond [n × RMS]')}</label><input id="fp-k" data-num="abs" value="${fp.k || 3}" inputmode="decimal" ${fp.k ? '' : 'disabled'}></div>
    ${f.type === 'Ebene' || (f.aux && fp.aux === 'auto' && f.hit) ? `<div class="row chk"><label title="${tt('Region growing only finds the outer contour; all points inside it within the band are used (bumps, spatter, burrs, craters). Real openings and walls stay out.')}"><input type="checkbox" id="fp-fill" ${fp.fill?.on ? 'checked' : ''}> ${tt('Capture all points inside outer boundary')}</label></div>
    ${fp.fill?.on ? `<div class="row"><label title="${tt('Search distance ± [mm]: thickness of the search region normal to the plane (same parameter as in Re-extraction)')}">${tt('Search distance ± [mm]')}</label><input id="fp-fband" data-num="abs" value="${fp.fill.band || ''}" placeholder="${tt('auto (3 × RMS)')}" inputmode="decimal"></div><div class="row chk"><label title="${raisedTip()}"><input type="checkbox" id="fp-fraised" ${fp.fill.exRaised ? 'checked' : ''}> ${tt('Exclude raised features')}</label>${raisedHelp()}</div>` : ''}` : ''}
    <div class="row chk"><label><input type="checkbox" id="fp-nf" ${fp.nf.on ? 'checked' : ''}> ${tt('Normal direction filter')}</label></div>
    ${fp.nf.on ? `<div class="row"><label>${tt('max. normal deviation [°]')}</label><input id="fp-nfa" value="${fp.nf.angleDeg}" inputmode="decimal"></div>
      <div class="row"><label>${tt('discard at most [%]')}</label><input id="fp-nfp" value="${fp.nf.maxPct}" inputmode="decimal"></div>` : ''}
    <p class="note">${tt('Normal filter: points whose measured surface normal deviates from the fitted element by more than the angle (edges, chamfers, adjacent faces) are discarded – worst first, at most the percentage.')}${m.nfRemoved ? ` <b>${tt('Currently {0} points discarded.', m.nfRemoved)}</b>` : ''}</p>
  </div>`;
}
/** Fit – the LAST step: geometry type and fit criterion; form deviation under every criterion */
function fitParamsHTML(f: FeatureView) {
  if (f.measured?.nurbs) return nurbsParamsHTML(f);
  if (f.derived) return `<div class="note">🔗 ${tt('Derived geometry has no own points: it is recomputed from the parent feature. Change extraction/filters/fit type on the parent – the change propagates here automatically.')}</div>`;
  const fp = (f.fp ??= defaultFp()); const m = f.measured!; const crit = fp.crit ?? 'lsq';
  const fb = m.formBy; const ok = (c: FitCrit) => critSupported(f.type, c);
  return `<div id="fp-box">
    <div class="row"><label>${tt('Geometry type')}</label><select id="d-retype">${FIT_TYPES.map((t) => `<option value="${t}" ${t === f.type ? 'selected' : ''}>${typeName(t)}</option>`).join('')}</select></div>
    <div class="row" title="${tt('Fit criterion (ISO 5459): Gauss = least squares; Minimum zone = smallest separation of two boundaries (Chebyshev); Tangential circumscribed = smallest element containing all points (shaft); Tangential inscribed = largest element inside all points (hole). Plane: outer / inner tangent plane.')}"><label>${tt('Fit criterion')}</label><select id="fp-crit">${FIT_CRITS.map((c) => `<option value="${c}" ${c === crit ? 'selected' : ''} ${ok(c) ? '' : 'disabled'}>${tt(CRIT_NAME[c])}</option>`).join('')}</select><button type="button" class="help-q" data-doc-sec="fitcrit" title="${tt('Fit criteria – documentation')}">?</button></div>
    ${fb ? `<div class="crit-tab" title="${tt('Form deviation of the same points evaluated with every fit criterion (roundness per fit). The selected criterion is bold.')}"><div class="note">${formName(f.type)} ${tt('per fit')} [mm]</div>${FIT_CRITS.filter((c) => fb[c] != null).map((c) => `<span class="${c === crit ? 'on' : ''}">${tt(CRIT_SHORT[c])} <b>${fmt(fb[c]!, 4)}</b></span>`).join('')}</div>` : `<p class="note">${tt('Form per fit criterion is computed on the next refit.')}</p>`}
  </div>`;
}
function bindFitParams(d: HTMLElement, f: FeatureView) {
  if (f.measured?.nurbs) { bindNurbsParams(d, f); return; }
  const fp = f.fp!; const q = <T extends HTMLElement>(s: string) => d.querySelector<T>(s);
  const num = (id: string, set: (x: number) => void, min = 0) => { const el = q<HTMLInputElement>(id); if (el) el.onchange = () => { const x = Number(el.value.replace(',', '.')); if (isFinite(x) && x >= min) { set(x); refitFeature(f); } else el.value = ''; }; };
  q<HTMLSelectElement>('#d-retype')?.addEventListener('change', (e) => refitFeature(f, (e.target as HTMLSelectElement).value as GeomType));
  q<HTMLInputElement>('#fp-rob')?.addEventListener('change', (e) => { fp.k = (e.target as HTMLInputElement).checked ? Math.max(1, Number(q<HTMLInputElement>('#fp-k')?.value.replace(',', '.')) || 3) : 0; refitFeature(f); });
  q<HTMLSelectElement>('#fp-crit')?.addEventListener('change', (e) => { fp.crit = (e.target as HTMLSelectElement).value as FitCrit; refitFeature(f); });
  num('#fp-k', (x) => (fp.k = Math.max(1, x)));
  num('#fp-ang', (x) => (fp.maxAngleDeg = x));
  q<HTMLInputElement>('#fp-fill')?.addEventListener('change', (e) => { const on = (e.target as HTMLInputElement).checked; fp.fill = { on, band: fp.fill?.band ?? state.opts.fill.band ?? 0, exRaised: fp.fill?.exRaised }; if (on && f.type === 'Ebene') { fp.k = 0; fp.nf.on = false; } refitFeature(f); });
  num('#fp-fband', (x) => { if (fp.fill) fp.fill.band = Math.max(0, x); });
  q<HTMLInputElement>('#fp-fraised')?.addEventListener('change', (e) => { if (fp.fill) { fp.fill.exRaised = (e.target as HTMLInputElement).checked; refitFeature(f); } });
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
        lab(c.kind === 'Position' || c.kind === 'Koaxialität' || c.kind === 'Konzentrizität' ? 'Tol Ø' : 'Tol', numInput(c.tolUp, (x) => { c.tolUp = Math.abs(x ?? 0); if (tolKindOf(c, f)) c.tolSrc = 'manual'; }, 'abs'));
        if (prefs.tolTables && tolKindOf(c, f)) ed.appendChild(tolSrcEl(c));
        lab(tt('Datums'), datumSlots(c, f, () => renderAll()));
        tedInputs(c, f, lab);
        if (diaInfo(c, f).applies) lab(tt('Zone'), diaButton(c, f, () => renderAll()));
        if (modApplies(c, f)) lab(tt('Material'), modButton(c, () => renderAll()));
        if (c.kind === 'Position' && isPattern(f)) lab(tt('Pattern'), czButton(c, () => renderAll()));
        ed.insertAdjacentHTML('beforeend', `<span class="frame">${it.symbol} ${c.kind === 'Position' && datumKind(f.type) !== 'plane' ? (f.type === 'Kugel' || f.type === 'Punkt' || f.type === 'Torus' ? 'SØ' : 'Ø') : diaInfo(c, f).on ? 'Ø' : ''}${fmt(c.tolUp, 3)}${frameMods(c, f)}${c.datumIds?.length ? ' | ' + datumText(c, fm) : ''}</span>
          <span class="dev ${r.status}">${r.measured == null ? '' : fmt(r.measured)}${bonusText(c, r)}</span>${r.flag === NOMINAL_UNCONFIRMED ? stHtml(r) : `<span class="st ${r.flag === NOMINAL_MISSING ? 'missing' : r.status === '—' ? 'none' : r.status}">${r.flag ? '⚠' : r.status}</span>${r.flag ? `<span class="flag${r.flag === NOMINAL_MISSING ? ' missing' : ''}">⚠ ${tt(r.flag)}</span>` : ''}`}`);
        if (r.detail) ed.title = r.detail;
        const mh = membersHtml(c, r); if (mh) ed.insertAdjacentHTML('beforeend', mh);
        row.appendChild(ed);
      } else if (c && r) {
        const ed = document.createElement('span'); ed.className = 'cat-ed';
        const lab = (t: string, el: HTMLElement) => { const s = document.createElement('span'); s.className = 'ce'; s.innerHTML = `<small>${t}</small>`; s.appendChild(el); ed.appendChild(s); };
        if (isZoneControl(c.kind)) lab(tt('Tol (0..t)'), numInput(c.tolUp, (x) => { c.tolUp = Math.abs(x ?? 0); c.tolSrc = 'manual'; }, 'abs'));
        else {
          lab(tt('Nominal'), numInput(c.nominal, (x) => { c.nominal = x; applyTol(c); }, 'signed'));
          if (prefs.tolTables && fitApplies(c)) lab(tt('Fit'), fitInput(c));
          lab(tt('Tol+'), numInput(c.tolUp, (x) => { c.tolUp = x ?? 0; c.tolSrc = 'manual'; }, 'signed'));
          lab(tt('Tol−'), numInput(c.tolLo, (x, raw) => { c.tolLo = tolLoOf(x, raw); c.tolSrc = 'manual'; }, 'neg'));
        }
        if (prefs.tolTables) ed.appendChild(tolSrcEl(c));
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
    td(zone ? '<span class="note">—</span>' : numInput(c.nominal, (x) => { c.nominal = x; applyTol(c); }, 'signed'), 'num');
    td(fmt(r.measured), 'num');
    td(zone ? '' : fmt(r.deviation), `num dev ${r.status}`);
    const tu = td(numInput(c.tolUp, (x) => { c.tolUp = zone ? Math.abs(x ?? 0) : x ?? 0; c.tolSrc = 'manual'; }, zone ? 'abs' : 'signed'), 'num'); if (c.tolSrc) tu.title = c.tolSrc === 'manual' ? tt('manual') : c.tolSrc;
    td(zone ? '<span class="note" title="' + tt('Form/orientation tolerance zone 0..t') + '">0</span>' : numInput(c.tolLo, (x, raw) => { c.tolLo = tolLoOf(x, raw); c.tolSrc = 'manual'; }, 'neg'), 'num');
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
      + `<td>${z ? '≤ ' + fmt(c.tolUp + (c.mod ? (r.members?.[r.worst ?? 0]?.bonus ?? r.bonus ?? 0) : 0), 3) : c.nominal == null ? '—' : fmt(c.nominal, 3)}</td><td>${z || r.deviation == null ? '' : sgn(r.deviation, 3)}</td></tr>`
      + (tolSum(c, r) ? `<tr class="lb"><td colspan="4">${MOD_SYM[c.mod!]} ${tolSum(c, r)}${r.members?.[r.worst ?? 0]?.bx?.beyond ? ' ⚠' : ''}</td></tr>` : '');
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
/** Lasso in the 3D view (zone trim): click corners, double-click/Enter = finish, Esc = cancel. Returns NDC polygon + view matrix. */
function lassoPick(): Promise<{ m: number[]; poly: [number, number][] } | null> {
  return new Promise((res) => {
    const host = viewer.el, R = host.getBoundingClientRect(), NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.id = 'lasso'; svg.setAttribute('width', String(R.width)); svg.setAttribute('height', String(R.height));
    svg.style.cssText = 'position:absolute;left:0;top:0;z-index:30;cursor:crosshair;touch-action:none';
    const pl = document.createElementNS(NS, 'polygon'); pl.setAttribute('style', 'fill:rgba(216,27,96,.12);stroke:#d81b60;stroke-width:2;stroke-dasharray:6 4'); svg.appendChild(pl);
    const tip = document.createElement('div'); tip.id = 'lasso-tip'; tip.innerHTML = `${matchMedia('(pointer: coarse)').matches ? tt('Lasso: tap the corners · ✓ = finish · ✕ = cancel') : tt('Lasso: click the corners · double-click or Enter = finish · Esc = cancel')} <button type="button" data-l="ok">✓</button> <button type="button" data-l="x">✕</button>`; host.append(svg, tip);
    tip.querySelector<HTMLButtonElement>('[data-l="ok"]')!.onclick = () => end(true); tip.querySelector<HTMLButtonElement>('[data-l="x"]')!.onclick = () => end(false);
    // phone: the bottom sheets would cover most of the 3D view – hide them while drawing (state unchanged)
    document.body.classList.add('lasso-on');
    const pts: [number, number][] = []; viewer.controls.enabled = false;
    const draw = () => pl.setAttribute('points', pts.map((q) => q.join(',')).join(' '));
    const end = (ok: boolean) => { svg.remove(); tip.remove(); document.body.classList.remove('lasso-on'); document.removeEventListener('keydown', key, true); viewer.controls.enabled = true;
      if (!ok || pts.length < 3) { res(null); return; }
      const cam = viewer.camera; cam.updateMatrixWorld(); const M = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
      res({ m: Array.from(M.elements), poly: pts.map(([x, y]) => [(x / R.width) * 2 - 1, 1 - (y / R.height) * 2] as [number, number]) }); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); end(false); } else if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); end(true); } };
    svg.addEventListener('pointerdown', (e) => { e.stopPropagation(); const r = svg.getBoundingClientRect(); pts.push([e.clientX - r.left, e.clientY - r.top]); draw(); });
    svg.addEventListener('dblclick', (e) => { e.stopPropagation(); pts.pop(); end(true); });
    document.addEventListener('keydown', key, true);
  });
}
/** Central overlay manager: contextual overlays are drawn only while their context lives and are cleared when it ends. */
const featureDialogOpen = () => dialogVisible() && state.sel.length === 1 && state.features.some((f) => f.id === state.sel[0]);
let _ov: OverlayManager | null = null;
const ovm = () => (_ov ??= new OverlayManager({
  mode: () => !!state.mode || !!pe.tool || !!state.csEdit,
  dialog: () => featureDialogOpen(),
  analyze: () => state.an.on,
  control: () => !!drfControl(),
}).register(
  { id: 'preview', ctx: 'mode', label: 'Creation preview (points, geometry, contour, creation zone)', clear: () => { if (!state.mode) state.preview = null; } },
  { id: 'hover', ctx: 'mode', label: 'Hover detection (orange/blue point sets)', clear: () => clearAuxHover() },
  { id: 'cursor', ctx: 'mode', label: 'Pick / brush circle', clear: () => viewer.showCursor(null, 1) },
  { id: 'brush', ctx: 'mode', label: 'Brush selection', clear: () => { if (!state.mode) clearBrush(); } },
  { id: 'anchor', ctx: 'mode', label: 'Anchor points' },
  { id: 'zone', ctx: 'dialog', label: 'Extraction zone + re-extraction preview points', clear: () => clearReexPreview() },
  { id: 'analysis', ctx: 'analyze', label: 'Analyze colour map, arrows, zones, axis view, derive preview', clear: () => { state.an.derivePrev = null; state.an.otherLabels = false; document.getElementById('dev-legend')?.remove(); } },
  { id: 'drf', ctx: 'control', label: 'DRF triad of the selected control' },
));
function renderScene() {
  if (!state.data) return;
  ovm().sync();
  if (viewer.model) viewer.model.visible = state.modelVisible;
  const vis = (f: FeatureView) => !state.hidden.has(f.id);
  viewer.resetColors();
  const peOn = paintPolyCompare() || paintLayout() || paintAnalysis();
  if (!state.an.on) { const o = viewTrans.on ? 1 - viewTrans.amt / 100 : 1; viewer.setModelOpacity(o); setCadOpacity(viewTrans.on ? Math.max(0.4, o) : 1); } // 0.38 (F15): outside Analyze only ⚙ › Transparent counts – the stored Analyze “Transparent” flag made the model transparent by default and the toggle had no effect // 0.33: ⚙ › Transparent (data object; CAD later)
  if (pe.tool === 'erase' && peMask && peCount && peMask.length === state.data.vertexCount) { const ids: number[] = []; peMask.forEach((v, i) => v && ids.push(i)); viewer.paint(Uint32Array.from(ids), [0.62, 0.2, 0.95]); }
  if (!peOn) for (const f of state.features) { // used points: all (View ribbon) or per feature (tree right-click)
    if (f.type === 'Abstand' || !vis(f) || !(state.colorPts || state.usedPts.has(f.id))) continue;
    const c = rgb(f.color), s = state.sel.includes(f.id);
    if (s && f.dev && state.devMap && f.dev.length === f.indices.length) viewer.paintScalar(f.indices, f.dev, devRange(f.dev));
    else viewer.paint(f.indices, s ? c : c.map((v) => 0.55 * v + 0.45 * 0.68));
  }
  if (!peOn) for (const f of state.features) { // 0.32: aux-plane points in their own colour, independent of the feature points
    if (!f.auxIndices?.length || !vis(f) || !(state.colorAux || state.usedAux.has(f.id))) continue;
    viewer.paint(f.auxIndices, rgb(AUX_COLOR));
  }
  if (ovm().on('brush') && state.brushMask && state.brushCount) {
    const idx: number[] = []; state.brushMask.forEach((v, i) => v && idx.push(i));
    viewer.paint(Uint32Array.from(idx), [1, 0.85, 0]);
  }
  const p = ovm().on('preview') ? state.preview : null;
  if (p?.aux?.indices.length) viewer.paint(p.aux.indices, rgb(AUX_COLOR));
  if (p && p.indices.length) { if (p.dev && state.devMap) viewer.paintScalar(p.indices, p.dev, devRange(p.dev)); else viewer.paint(p.indices, rgb(PREVIEW_COLOR)); }
  if (p?.raised?.length) viewer.paint(p.raised, [0.85, 0.1, 0.55]);
  { const rx = ovm().on('zone') ? reexPreviewPts(zoneAlive) : null; if (rx) viewer.paint(rx, rgb(PREVIEW_COLOR)); }
  const lg = [p?.dev && state.devMap ? p.dev : null, ...state.features.filter((f) => state.sel.includes(f.id) && f.dev && state.devMap && vis(f)).map((f) => f.dev!)].find(Boolean);
  if (!peOn) renderDevLegend(lg ?? null);
  if (state.an.on && state.an.otherLabels) for (const i of anControl()?.datumIds ?? []) { const d = state.features.find((x) => x.id === i); if (d?.indices.length && vis(d)) viewer.paint(d.indices, [0.12, 0.53, 0.9]); }
  viewer.commitColors();
  viewer.clearPrims();
  renderCurves();
  if (state.an.on && state.an.whisk && state.an.res?.pos && state.an.res.dir) { const g = anRange(state.an.res); viewer.addArrows(state.an.res.pos, state.an.res.dir, state.an.res.dev, state.an.exag, g.h, g.c); }
  { const R = showZone && ovm().on('zone') ? reexPreview(zoneAlive) : null; if (R) viewer.addRegion(R); }
  if (showZone && p?.zone) viewer.addRegion(p.zone);
  if (state.an.on && state.an.res?.cpos) { const v = state.an.res.cpos; viewer.addCirclePos(v, Math.max(1, state.an.axLoc), state.an.axLab.dev ? `${tt('deviation')} Ø ${fmt(v.val, 4)}${v.status === 'IO' ? ' ✔' : v.status === 'NIO' ? ' ✘' : ''}` : '', true, { zone: state.an.axLab.zone ? `${tt('zone')} Ø ${fmt(v.tol, 4)}` : '', nom: state.an.axLab.nom ? tt('nominal (TED)') : '' }); }
  if (state.an.on && state.an.res?.axes) for (const x of state.an.res.axes) viewer.addAxisAnalysis(x, axisExag(state.an.res), Math.max(1, state.an.axLoc), state.an.axLab.dev ? offsetLabel(x) : '', { zones: true, env: state.an.axEnv, labels: axisLabels(x) });
  if (state.an.on && state.an.zones && state.an.res?.feats) for (const z of state.an.res.feats) { const f = state.features.find((x) => x.id === z.id); if (f?.measured) viewer.addZone(f.measured, z.lo, z.hi); }
  if (state.an.on && state.an.derivePrev) viewer.addPrimitive(state.an.derivePrev.fit, 0xd81b60, true);
  if (ovm().on('anchor') && state.mode?.kind === 'anchor') for (const [i, q] of state.mode.pts.entries()) viewer.addPrimitive({ type: 'Punkt', center: q, normal: state.mode.nrm[i] } as FitResult, 0xff8c1a, true);
  if (state.showPrims) for (const f of state.features) {
    if (!vis(f)) continue;
    const sel = state.sel.includes(f.id);
    if (f.type === 'Winkel') viewer.addAngle(f.measured!, f.color, sel);
    else if (f.type === 'Abstand') viewer.addDistance(f.measured!.p1!, f.measured!.p2!, f.color, sel, f.dim ? dimGeometry(f.measured!, f.dim.comp, state.labelOffsets.get(f.id) ?? null) : undefined);
    else if (f.measured!.nurbs) viewer.addFreeform(f.measured!.nurbs, f.color, sel, sel && state.ctrlNet);
    else if (state.trimGeo && CURVE_TRIM_TYPES.includes(f.type) && f.indices.length >= 2 && viewer.model) {
      const seg = curveTrimFor(f); if (seg) { viewer.addTrimmed(new Float32Array(0), seg, f.color, sel); viewer.addPrimitiveMarkers(f.measured!, f.color); } else viewer.addPrimitive(f.measured!, f.color, sel);
    }
    else if (f.fp?.zoneSrc === 'geom' && GEOM_ZONE.includes(f.type)) { // boundary from the fitted geometry: clean analytic surface + circles/arcs
      const t = (f.type === 'Zylinder' || f.type === 'Kegel') && viewer.model ? shellFor(f) : null;
      if (t) { viewer.addTrimmed(t.tri, t.edges, f.color, sel); viewer.addPrimitiveMarkers(f.measured!, f.color); } else viewer.addPrimitive(f.measured!, f.color, sel);
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
    if (p.aux && state.opts.aux === 'ring' && (p.fit.type === 'Kreis' || p.fit.type === 'Langloch')) for (const L of zoneLoops(p.fit, p.aux.plane, state.opts.ring.gap, state.opts.ring.width)) viewer.addContour(L, AUX_COLOR); // ring / band zone, live
    // 0.31: smoothed boundary of the selection (also All inside boundary) + detected islands
    if (p.fit.type === 'Ebene' || TRIM_TYPES.includes(p.fit.type)) for (const L of previewLoops(p)) viewer.addContour(L, 0x1565c0);
    else for (const L of p.contour ?? []) viewer.addContour(L, 0x1565c0);
    (p.islands ?? []).forEach((I, i) => { if (I.inc && I.kind === 'hole' && i !== islSel) return; /* 0.38: removed hole = shown closed */ for (const L of I.loops) viewer.addContour(L, i === islSel ? 0xff2bd6 : I.inc ? 0x2e7d32 : !islCanInc(I) ? 0x78909c : 0xff8c1a); });
  }
  renderCsTriads();
  if (ovm().on('drf')) renderDrfTriad();
  // Labels
  const fm = featMap();
  const focus = anFocusIds();
  const specs: LabelSpec[] = state.showLabels ? state.features.filter((f) => vis(f) && !state.hiddenLabels.has(f.id) && (!focus || focus.has(f.id))).map((f) => {
    const m = f.measured!;
    const anchor = (f.type === 'Abstand' ? m.p1!.map((v, i) => (v + m.p2![i]) / 2) : m.center) as V3;
    return { id: f.id, anchor, html: labelHTML(f, fm), color: hex(f.color), offset: state.labelOffsets.get(f.id) ?? null, selected: state.sel.includes(f.id) };
  }) : [];
  if (p && p.fit.type === 'Abstand' && state.mode?.kind === 'dist') {
    const m = p.fit, comp = state.mode.comp;
    specs.push({ id: -1, anchor: m.p1!.map((v, i) => (v + m.p2![i]) / 2) as V3, color: hex(PREVIEW_COLOR), offset: state.labelOffsets.get(-1) ?? null, selected: true,
      html: `<div class="lh"><i></i>${tt('Distance')} ${comp}</div><table><tr><td>↔ ${comp}</td><td>${fmt(distValue(m, comp), 3)}</td></tr></table>` });
  }
  // 0.39: Analyse-Wertlabels (Zone, Hülle, Nennachse, Geometrie) – verschiebbar wie Merkmalslabels, Position gespeichert
  for (const t of viewer.texts) { const id = textLabelId(t.key);
    specs.push({ id, anchor: t.anchor, color: t.color, offset: state.labelOffsets.get(id) ?? null, selected: false, html: `<div class="lbl-an" style="color:${t.color}">${esc(t.text)}</div>` }); }
  viewer.labels.set(specs);
}
/** stabile Label-ID (≤ −1000) für ein Analyse-Wertlabel aus Farbe + laufender Nummer */
const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
function textLabelId(key: string): number { let h = 7; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 1e8; return -1000 - h; }
viewer.labels.onMoved = (id, off) => { state.labelOffsets.set(id, off); const f = id < 0 ? null : state.features.find((x) => x.id === id);
  if (id < 0 || f?.dim) renderScene(); else scheduleAutosave(); };
viewer.labels.onSelect = (id) => { if (id >= 0) selectFeature(id); };
viewer.labels.pinTitle = tt('Pinned (dragged) – click to unpin: automatic placement again');
viewer.labels.onUnpin = (id) => { state.labelOffsets.delete(id); status(tt('Annotation unpinned – automatic placement.')); renderScene(); scheduleAutosave(); };
/** Reset annotation positions: the selected features, or all when nothing is selected. */
function resetLabelPositions() {
  const ids = state.sel.filter((i) => state.labelOffsets.has(i));
  if (ids.length) { for (const i of ids) state.labelOffsets.delete(i); status(tt('Annotation positions reset for {0} selected feature(s).', ids.length)); }
  else { const n = [...state.labelOffsets.keys()].filter((k) => k >= 0).length; for (const k of [...state.labelOffsets.keys()]) if (k >= 0) state.labelOffsets.delete(k); status(tt('All annotation positions reset ({0}).', n)); }
  renderScene(); scheduleAutosave();
}
$('#btn-reset-labels').onclick = () => resetLabelPositions();

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
  for (const el of document.querySelectorAll('[data-vt="apts"]')) el.classList.toggle('on', state.annot.pts);
  for (const el of document.querySelectorAll('[data-vt="astd"]')) el.classList.toggle('on', state.annot.std);
}
/** View ▸ Annotations: annotation content toggles (same preference as Options ▸ Annotation, persistent) */
function setAnnot(k: 'pts' | 'std', on: boolean) { state.annot[k] = on; saveViewPrefs(); syncViewToggles(); renderAll();
  const o = document.getElementById(k === 'pts' ? 'od-pts' : 'od-std') as HTMLInputElement | null; if (o) o.checked = on; }
$('#btn-annot-pts').onclick = () => setAnnot('pts', !state.annot.pts);
$('#btn-annot-std').onclick = () => setAnnot('std', !state.annot.std);
{
  const g = document.createElement('div'); g.id = 'view-gear';
  g.innerHTML = `<button class="vg-btn" title="${tt('View')}" aria-label="${tt('View menu')}">⚙</button><div class="vg-menu">
    <button data-vg="center">⌖ ${tt('Center')}</button><button data-vg="fit">⤢ ${tt('Fit all')}</button><button data-vg="trans" title="${tt('Show the data object (polygon model) transparent – amount under Options › Display')}">◌ ${tt('Transparent')}</button>
    <button data-vg="prims" data-vt="prims">◎ ${tt('Geometries')}</button><button data-vg="labels" data-vt="labels">🏷 ${tt('Annotations')}</button><button data-vg="relabel" title="${tt('Reset annotation positions: dragged (pinned 🔒) annotations go back to automatic placement – the selected features only, or all if nothing is selected')}">↺ ${tt('Reset positions')}</button>
    <button data-vg="zone" title="${tt('Show the extraction zone of the feature whose dialog is open (global preference, remembered)')}">⬚ ${tt('Extraction zone')}</button><button data-vg="wire" data-vt="wire">▦ ${tt('Mesh edges')}</button><button data-vg="curves" data-vt="curves" class="on">〰 ${tt('Curves/CAD edges')}</button>
    <button data-vg="opts">⚙ ${tt('Options …')}</button></div>`;
  g.addEventListener('pointerdown', (e) => e.stopPropagation());
  g.querySelector<HTMLButtonElement>('.vg-btn')!.onclick = () => { g.classList.toggle('open'); placeGear(); };
  g.addEventListener('mouseenter', () => placeGear());
  g.querySelector('[data-vg="trans"]')!.classList.toggle('on', viewTrans.on);
  g.querySelectorAll<HTMLButtonElement>('[data-vg]').forEach((b) => (b.onclick = () => { const a = b.dataset.vg;
    if (a === 'center') centerOn(); else if (a === 'iso') viewer.view('iso'); else if (a === 'fit') { viewer.view('fit'); status(tt('Fitted to view.')); }
    else if (a === 'wire') toggleWire(); else if (a === 'prims') $('#btn-toggle-prims').click(); else if (a === 'labels') $('#btn-toggle-labels').click(); else if (a === 'relabel') resetLabelPositions(); else if (a === 'zone') setShowZone(!showZone); else if (a === 'trans') { viewTrans.on = !viewTrans.on; saveViewPrefs(); b.classList.toggle('on', viewTrans.on); renderScene(); } else if (a === 'opts') openOptions(); else toggleCurves();
    g.classList.remove('open'); }));
  window.addEventListener('pointerdown', (e) => { if (!g.contains(e.target as Node)) g.classList.remove('open'); });
  viewer.el.appendChild(g);
  const info = document.createElement('div'); info.id = 'bbox-info'; info.className = 'hidden'; viewer.el.appendChild(info);
  info.addEventListener('pointerdown', (e) => { e.stopPropagation(); info.classList.toggle('open'); });
}
/** 0.33: the ⚙ menu is always fully visible – opens upward when there is room, otherwise beside the button, shifted
 *  into the view and scrollable as the last resort (controls/annotations/dialog push the button up). */
function placeGear() {
  const g = document.getElementById('view-gear'), m = g?.querySelector<HTMLElement>('.vg-menu'); if (!g || !m) return;
  m.style.cssText = ''; g.classList.remove('vg-side');
  {
    const V = viewer.el.getBoundingClientRect(), B = g.querySelector('.vg-btn')!.getBoundingClientRect(), h = m.scrollHeight, pad = 6;
    if (!h) return; if (B.top - V.top - pad >= h + 4) return; // fits above the button
    const maxH = V.height - 2 * pad, hh = Math.min(h, maxH);
    const top = Math.max(V.top + pad, Math.min(B.bottom - hh, V.bottom - pad - hh));
    g.classList.add('vg-side');
    m.style.cssText = `position:fixed;left:${B.right + 2}px;top:${top}px;max-height:${maxH}px;overflow:auto;`;
  }
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
    <h4>${tt('Display')}</h4>
    <div class="row" title="${tt('Decimal places of all displayed values: annotations, panels, tree properties, report and CSV (lengths in mm, deviations and angles). Internal precision and input fields are not rounded; unit direction vectors keep at least 5 places. Also View ▸ Decimals.')}"><label>${tt('Decimal places')}</label> <span class="od-dec"><button class="btn" type="button" data-dec="-1" title="${tt('One decimal place less')}">−</button><input id="od-dec" type="number" min="${DEC_MIN}" max="${DEC_MAX}" step="1" value="${getDec()}" inputmode="numeric"><button class="btn" type="button" data-dec="1" title="${tt('One decimal place more')}">+</button></span> <span class="note">(${tt('default')} 2)</span></div>
    <div class="row" title="${tt('How transparent the data object is when ⚙ › Transparent is on (5–95 %)')}"><label>${tt('Transparency [%]')}</label> <input type="number" id="od-trans" min="5" max="95" step="5" value="${viewTrans.amt}" style="width:5em"> <label><input type="checkbox" id="od-trans-on" ${viewTrans.on ? 'checked' : ''}> ${tt('Data object transparent')}</label></div>
    <h4>${tt('Extraction')}</h4>
    <div class="row" title="${tt('Default search distance for extraction and re-extraction: points within ± this distance of the fitted geometry are collected. Applies to new extractions; per feature it can still be changed in the extraction parameters.')}"><label>${tt('Search distance [mm]')}</label> <input type="number" id="od-sdist" min="0.01" max="20" step="0.1" value="${REEX_DEFAULT.maxDist}" style="width:5em"></div>
    <h4>${tt('Tolerances')}</h4>
    <div class="row" title="${tt('On: new controls get their tolerance from the project general tolerance (ISO 2768-1/-2) or an ISO 286 fit code (e.g. H7); the source is shown and reported. Off (default): tolerances are entered by hand as before 0.24. Values already in a project are kept either way.')}"><label><input type="checkbox" id="od-tol" ${prefs.tolTables ? 'checked' : ''}> ${tt('Use general tolerance tables (ISO 2768 / ISO 286)')}</label></div>
    <div class="row"><button class="btn primary" data-ok>${tt('Close')}</button></div></div>`;
  const apply = () => { applyColorMode(); renderAll(); saveViewPrefs(); };
  el.querySelectorAll<HTMLInputElement>('input[name=od-cm]').forEach((r) => (r.onchange = () => { state.colorMode = r.value as any; apply(); }));
  el.querySelector<HTMLInputElement>('#od-uc')!.oninput = (e) => { state.uniformColor = parseInt((e.target as HTMLInputElement).value.slice(1), 16); apply(); };
  el.querySelector<HTMLInputElement>('#od-pts')!.onchange = (e) => { state.annot.pts = (e.target as HTMLInputElement).checked; apply(); syncViewToggles(); };
  el.querySelector<HTMLInputElement>('#od-std')!.onchange = (e) => { state.annot.std = (e.target as HTMLInputElement).checked; apply(); syncViewToggles(); };
  el.querySelectorAll<HTMLButtonElement>('[data-dec]').forEach((b) => (b.onclick = () => setDecimals(getDec() + Number(b.dataset.dec))));
  el.querySelector<HTMLInputElement>('#od-dec')!.onchange = (e) => { const v = parseInt((e.target as HTMLInputElement).value, 10); setDecimals(isFinite(v) ? v : 2); };
  el.querySelector<HTMLInputElement>('#od-trans')!.onchange = (e) => { const v = Number((e.target as HTMLInputElement).value); if (isFinite(v)) viewTrans.amt = Math.min(95, Math.max(5, v)); saveViewPrefs(); renderScene(); };
  el.querySelector<HTMLInputElement>('#od-trans-on')!.onchange = (e) => { viewTrans.on = (e.target as HTMLInputElement).checked; saveViewPrefs(); document.querySelector('#view-gear [data-vg="trans"]')?.classList.toggle('on', viewTrans.on); renderScene(); };
  el.querySelector<HTMLInputElement>('#od-sdist')!.onchange = (e) => { const v = Number((e.target as HTMLInputElement).value); if (isFinite(v) && v > 0) { setSearchDistDefault(Math.min(20, Math.max(0.01, v))); saveViewPrefs(); } };
  el.querySelector<HTMLInputElement>('#od-tol')!.onchange = (e) => { prefs.tolTables = (e.target as HTMLInputElement).checked; saveViewPrefs(); syncPrefsUI(); renderAll(); };
  el.querySelector<HTMLButtonElement>('[data-ok]')!.onclick = () => el.remove();
  el.addEventListener('pointerdown', (e) => { if (e.target === el) el.remove(); });
  document.body.appendChild(el);
}
/** Farbmodus anwenden: einheitlich bzw. Palette in Erzeugungsreihenfolge; individuell gewählte Farben bleiben. */
function applyColorMode() {
  state.features.forEach((f, i) => { if (!f.colorSet) f.color = state.colorMode === 'uniform' ? state.uniformColor : PALETTE[i % PALETTE.length]; });
}
const PREF_KEY = 'mw-view-prefs';
function saveViewPrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify({ colorMode: state.colorMode, uniformColor: state.uniformColor, annot: state.annot, tolTables: prefs.tolTables, dec: getDec(), dataTrans: viewTrans.on, transAmt: viewTrans.amt, searchDist: REEX_DEFAULT.maxDist })); } catch { /* */ } }
try { const pr = JSON.parse(localStorage.getItem(PREF_KEY) ?? 'null'); if (pr) { if (pr.searchDist > 0) setSearchDistDefault(pr.searchDist); state.colorMode = pr.colorMode ?? state.colorMode; state.uniformColor = pr.uniformColor ?? state.uniformColor; state.annot = { ...state.annot, ...pr.annot }; prefs.tolTables = !!pr.tolTables; if (pr.dec != null) setDec(+pr.dec); viewTrans.on = !!pr.dataTrans; if (pr.transAmt != null && isFinite(+pr.transAmt)) viewTrans.amt = Math.min(95, Math.max(5, +pr.transAmt)); } } catch { /* */ }
syncPrefsUI();
/** Options ▸ Decimal places / View ▸ Decimals: display only (fmt), internal values untouched */
function setDecimals(n: number) { setDec(n); saveViewPrefs(); syncPrefsUI(); renderAll(); if (state.openReport != null) renderReport(); }
function syncPrefsUI() {
  document.body.classList.toggle('tol-tables', prefs.tolTables);
  document.querySelectorAll('[data-vt="apts"]').forEach((e) => e.classList.toggle('on', state.annot.pts)); document.querySelectorAll('[data-vt="astd"]').forEach((e) => e.classList.toggle('on', state.annot.std));
  const v = document.getElementById('dec-val'); if (v) v.textContent = String(getDec());
  const m = document.getElementById('dec-minus') as HTMLButtonElement | null, p = document.getElementById('dec-plus') as HTMLButtonElement | null;
  if (m) m.disabled = getDec() <= DEC_MIN; if (p) p.disabled = getDec() >= DEC_MAX;
  const o = document.getElementById('od-dec') as HTMLInputElement | null; if (o) o.value = String(getDec());
}
$('#dec-minus').onclick = (e) => { e.stopPropagation(); setDecimals(getDec() - 1); };
$('#dec-plus').onclick = (e) => { e.stopPropagation(); setDecimals(getDec() + 1); };
$('#btn-options').onclick = () => openOptions();
$('#btn-whatsnew').onclick = () => showWhatsNew();
$('#btn-testlist').onclick = () => { window.open('test.html', '_blank', 'noopener'); };
$('#btn-toggle-zone').onclick = () => setShowZone(!showZone);
{ // dialog closed/opened (pane ✕, phone sheet) → zone visibility follows at once
  let was = dialogVisible(); new MutationObserver(() => { const v = dialogVisible(); if (v !== was) { was = v; renderScene(); } }).observe(document.body, { attributes: true, attributeFilter: ['class'] }); }
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
/** Properties of the ACTUAL geometry (read-only): type, method, points, RMS, form, max ±, position, direction, aux plane. */
function propertiesHTML(f: FeatureView): string {
  return `<h4>${tt('Actual')}</h4>${kv([[tt('Type'), typeName(f.type)], [tt('Method'), methodName(f.method)], ...(f.cons ? conRows(f.measured!) : fitRows(f.measured!, f.pointCount))])}
    ${f.aux ? `<h4>${ICON.aux} ${tt('Auxiliary plane')}</h4>${kv([[tt('Source'), auxSourceText(f.aux)], [tt('Points'), f.aux.refId ? '—' : String(f.aux.pointCount)], [tt('RMS'), fmt(f.aux.plane.rms)], [tt('Flatness'), fmt(f.aux.plane.form)],
      [tt('Point'), f.aux.plane.center.map((v) => v.toFixed(3)).join(' ')], [tt('Normal'), f.aux.plane.normal.map((v) => v.toFixed(5)).join(' ')]])}` : ''}`;
}
/** Editable feature properties = the Dialog (datum, extraction, filters, fit, aux plane / construction inputs). */
function openFeatureProps(f: FeatureView) {
  document.getElementById('props-dlg')?.remove();
  state.sel = [f.id]; state.selModel = false; setPaneOpen('dialog', true); togglePanel('dialog', true); renderAll();
}
/** Read-only properties of the ACTUAL geometry (tree: Actual › right-click › Properties…); refreshed after every recompute. */
function showProperties(f: FeatureView) {
  document.getElementById('props-dlg')?.remove();
  const el = document.createElement('div'); el.id = 'props-dlg'; el.className = 'modal-ov';
  el.innerHTML = `<div class="wn-box" role="dialog"><div class="ov-top"><h3><span style="color:${hex(f.color)}">${f.type === 'Abstand' ? ICON['Abstand 3D'] : ICON[f.type] ?? ''}</span> ${tt('Properties')}: ${f.name}</h3><button class="ov-x" data-x title="${tt('Close')}">✕</button></div>
    <p class="note">${tt('Read-only: result of the last extraction/fit. It updates automatically after every recompute. To change parameters open the feature’s Properties (double-click the feature).')}</p><div id="props-body">${propertiesHTML(f)}</div><div class="row"><button class="btn primary" data-x>${tt('Close')}</button></div></div>`;
  el.dataset.fid = String(f.id);
  const close = () => { el.remove(); document.removeEventListener('keydown', esc); }, esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  el.querySelectorAll<HTMLElement>('[data-x]').forEach((b) => (b.onclick = close));
  el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); }); document.addEventListener('keydown', esc);
  bindSwipeClose(el.querySelector('.wn-box')!, close, el.querySelector('.wn-box'));
  document.body.appendChild(el);
}
function openContext(x: number, y: number, fid: number | null) {
  const f = state.features.find((g) => g.id === fid);
  const items: ([string, () => void] | null)[] = [];
  if (f) {
    state.sel = [f.id]; state.selModel = false; state.addFeat = f.id; renderAll();
    items.push([`🛠 ${tt('Properties…')}`, () => openFeatureProps(f)]);
    if (f.measured) items.push([`ⓘ ${tt('Actual – read-only info …')}`, () => showProperties(f)]);
    items.push([`🎨 ${tt('Color …')}`, () => { setPaneOpen('dialog', true); togglePanel('dialog', true); setTimeout(() => $<HTMLInputElement>('#d-color')?.click(), 30); }]);
    items.push([`⌖ ${tt('Center')}`, () => centerOn(fid)]);
    if (f.indices?.length && f.type !== 'Abstand') { const on = state.usedPts.has(f.id); items.push([`⁘ ${on ? tt('Hide used points') : tt('Show used points')}`, () => { if (on) state.usedPts.delete(f.id); else state.usedPts.add(f.id); renderAll(); }]);
    if (f.auxIndices?.length) { const on = state.usedAux.has(f.id); items.push([`▱ ${on ? tt('Hide aux-plane points') : tt('Show aux-plane points')}`, () => { if (on) state.usedAux.delete(f.id); else state.usedAux.add(f.id); renderAll(); }]); } }
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
  const feats = state.features.map((f) => nodeToJSON(f)); // node + ist (runtime point sets go to the index blob)
  return {
    savedAt: new Date().toISOString(), app: 'MessWerk 3D', featureModel: FEATURE_MODEL,
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
  for (const f of state.features) { o['f' + f.id] = f.indices; o['a' + f.id] = f.auxIndices; o['s' + f.id] = f.src; o['z' + f.id] = f.frozenIdx; o['d' + f.id] = f.dev ? new Uint32Array(f.dev.buffer.slice(f.dev.byteOffset, f.dev.byteOffset + f.dev.byteLength)) : undefined; }
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
    // feature model 1 (≤ 0.27: flat features) is migrated to feature node + Ist; format 2 passes through
    state.features = migrateFeatures(st.features, json.featureModel).map((f: any) => { if (f.reex) f.reex = normReex(f.reex);
      f.indices = unpackIndex(idx, 'f' + f.id) ?? new Uint32Array(0); f.auxIndices = unpackIndex(idx, 'a' + f.id); f.src = unpackIndex(idx, 's' + f.id); f.frozenIdx = unpackIndex(idx, 'z' + f.id);
      f.dev = ((d) => (d ? new Float32Array(d.slice().buffer) : undefined))(unpackIndex(idx, 'd' + f.id)); return f; });
    state.controls = st.controls; state.typeCount = st.typeCount; state.nextId = st.nextId; state.nextCtrl = st.nextCtrl; state.nextReport = st.nextReport;
    state.reports = st.reports ?? []; state.hidden = new Set(st.hidden ?? []); state.modelVisible = st.modelVisible ?? true;
    state.labelOffsets = new Map(st.labelOffsets ?? []); state.showLabels = st.showLabels ?? true; state.showPrims = st.showPrims ?? true; state.colorPts = st.colorPts ?? true;
    if (st.opts) { Object.assign(state.opts, st.opts); state.opts.ex.outlierOn = false; state.opts.fill.on = true; state.opts.radius = 0; } (state.opts.ex as any).raw30 = 1; syncGenTolUI(); // ≤ 0.29 projects: outlier filter on by default → off (raw fit at creation)
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
  el.querySelectorAll<HTMLAnchorElement>('[data-doc]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); scrollWithin(el.querySelector('.rv-body')!, el.querySelector('#doc-' + a.dataset.doc), true); }));
  if (sec) setTimeout(() => scrollWithin(el.querySelector('.rv-body')!, el.querySelector('#doc-' + sec)), 50);
}
document.querySelectorAll<HTMLButtonElement>('#btn-docs, #btn-docs2').forEach((b) => (b.onclick = () => showDocs()));
$('#btn-help').onclick = () => {
  const el = $('#help-view'); el.classList.remove('hidden');
  el.innerHTML = `<div class="rv-head"><b>${tt('Help: datums and tolerances with datum')}</b><span style="flex:1"></span><button class="btn" id="hv-train">🎓 ${tt('Start training')}</button><button class="btn" id="hv-close" title="${tt('Close')}">✕</button></div>
  <div class="rv-body">${HELP_HTML}</div>`;
  ($('#hv-close') as HTMLButtonElement).onclick = () => el.classList.add('hidden');
  ($('#hv-train') as HTMLButtonElement).onclick = () => { el.classList.add('hidden'); startTraining(); };
};
const HELP_HTML = `<h3>Navigation (mouse)</h3><ul><li>Drag with the <b>left button</b>: rotate · <b>middle button</b> (wheel pressed) or right button: pan · <b>mouse wheel</b>: zoom.</li>
<li><b>Space</b> (desktop): navigation pause – in any tool the mouse only rotates/pans/zooms; Space again continues with exactly the same tool, panel and selection. Ignored while typing in a field.</li><li><b>Pick mode</b> (desktop, 0.38): while creating a feature (Auto, typed Click & grow, brush, eraser) the mouse does <b>not</b> change the view – clicks pick, the <b>mouse wheel changes the pick/brush radius</b>. Press <b>Space</b> for navigation (rotate/pan/zoom) and Space again to continue picking. On phones use the ◎ r − / ＋ stepper in the Creation Panel.</li>
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
  const c = state.controls.find((k) => k.kind === 'Position' && k.featureIds[0] === f.id)!;
  if (!c.datumIds?.length) { c.datumIds = ['A', 'B', 'C'].map((l) => state.features.find((x) => x.datum === l)?.id).filter((x): x is number => x != null); renderAll(); }
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
    { auto: ensurePosition, title: tt('Position tolerance ⌖ A|B|C'), text: tt('In <b>Control Properties</b> under “With datum” tick <b>⌖ Position</b>, then pick the datums in order: <b>A</b> in the Primary slot, then <b>B</b> (Secondary appears), then <b>C</b> (Tertiary appears).'),
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
Object.assign((window as any).__app, { setNavPause: (on: boolean) => setNavPause(on), brushCreate, brushAt, scheduleBrushFit, brushLive: () => brushLive, placeGear, clearSelection, setMethod, viewTrans, treePins, showDatumInfo, showDocs, ovm, applyExtract, setShowZone, analyze, addDerived, DERIVES, addPlaneRegion, parseNum, ensureFeature, addControl, TRAIN_FEATS, hitAt, previewByClick, setContour, trimFor, previewLoops, islandAt: (h: Hit) => islandAt(h), islSel: () => islSel, setSmoothTol, startFitMode, commitPreview, nurbsAccuracy, renderAll, togglePanel, evaluate, ctx: () => ctx, startTraining, centerOn, showProperties, openContext, renderDialog, setDatum, saveProject, openProjectFile, restoreLast, projectJSON, analyzeControl, evaluateControl: (id: number) => { const c = state.controls.find((x) => x.id === id); return c ? evaluate(c, featMap(), ctx) : null; } });
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
Object.assign((window as any).__app, { pe, peRun, peUndo });
$('#q-undo').onclick = () => peUndo(); // Quick Access Toolbar ↶ (title bar; iPhone: end of the section-chip row) – mesh edits only until the global undo
$('#btn-pe-reset').onclick = () => peResetOriginal();
function peExit() { if (pe.running) polyEngine.cancel(); pe.tool = null; peClearSel(); curveDraft = []; viewer.showCursor(null, 1); if (isPhone()) togglePanel('dialog', false); renderAll(); }

function renderPolyRibbon() {
  document.querySelectorAll<HTMLButtonElement>('[data-pe]').forEach((b) => b.classList.toggle('on', pe.tool === b.dataset.pe));
  $('#btn-curve-draw').classList.toggle('on', pe.tool === 'curve'); $('#btn-curve-layout').classList.toggle('on', state.showLayout);
  $('#btn-pe-cmp').classList.toggle('on', pe.cmp);
  document.querySelectorAll<HTMLButtonElement>('#q-undo, #q-undo-p').forEach((b) => (b.disabled = !pe.undo.length));
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
  for (const f of state.features) lists.push(f.indices ?? null, f.auxIndices ?? null, f.src ?? null, f.frozenIdx ?? null);
  const r = await busy(engine.call<any>({ op: 'setMesh', positions: positions.slice(), indices: indices.slice(), remap: lists,
    chains: state.curves.map((c) => c.chain), kinds: state.curves.map((c) => c.kind) }));
  if (r.curves) { state.curves.forEach((c, i) => Object.assign(c, r.curves[i], { kind: c.kind })); }
  state.features.forEach((f, i) => {
    const [a, b, c, z] = [r.remap[4 * i], r.remap[4 * i + 1], r.remap[4 * i + 2], r.remap[4 * i + 3]];
    if (a) f.indices = a; f.auxIndices = b ?? undefined; f.src = c ?? undefined; f.frozenIdx = z ?? undefined;
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
type CsField = 'p' | 's' | 't' | 'X' | 'Y' | 'Z';
function csFieldName(k: CsField) { return k === 'p' ? tt('Primary') : k === 's' ? tt('Secondary') : k === 't' ? tt('Tertiary') : tt('Origin {0}', k); }
const csStep = (k: CsField) => (k === 'p' ? 'primary' : k === 's' ? 'secondary' : k === 't' ? 'tertiary' : 'origin') as 'primary' | 'secondary' | 'tertiary' | 'origin';
/** mean surface normal of a feature's points (points out of the material) */
function outwardOf(fid: number): Vec3 | null { const N = featNormals(fid); if (!N?.length) return null; const s: Vec3 = [0, 0, 0]; for (const n of N) { s[0] += n[0]; s[1] += n[1]; s[2] += n[2]; } return s; }
/** a slot got a feature: smart axis defaults (+Z out of material, X, remaining axis), automatic origin, live triad */
function csSlotSet(cs: CSys, k: 'p' | 's' | 't', fid: number | null) {
  if (!cs.tertiary) cs.tertiary = { fid: null, axis: 'Y', flip: false };
  const ref = k === 'p' ? cs.primary : k === 's' ? cs.secondary : cs.tertiary; ref.fid = fid;
  const f = fid != null ? state.features.find((x) => x.id === fid) : undefined;
  if (f) smartAxis(cs, k, f, outwardOf(f.id));
  suggestOrigin(cs, featMap());
}
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
  if (sel[0] && usableAs(sel[0].type, 'primary')) csSlotSet(cs, 'p', sel[0].id);
  if (sel[1] && usableAs(sel[1].type, 'secondary')) csSlotSet(cs, 's', sel[1].id);
  if (sel[2] && usableAs(sel[2].type, 'tertiary')) csSlotSet(cs, 't', sel[2].id);
  suggestOrigin(cs, fm);
  state.csEdit = { draft: cs, orig: null, field: cs.primary.fid == null ? 'p' : cs.secondary.fid == null ? 's' : cs.tertiary?.fid == null ? 't' : null, activate: true };
  state.sel = []; state.csSel = null; setPaneOpen('dialog', true); togglePanel('dialog', !isPhone());
  renderAll();
}
function csEditStart(id: number) {
  const cs = csById(id); if (!cs) return; stopMode();
  const draft: CSys = JSON.parse(JSON.stringify(cs)); if (!draft.tertiary) draft.tertiary = { fid: null, axis: (['X', 'Y', 'Z'] as Axis[]).find((a) => a !== draft.primary.axis && a !== draft.secondary.axis)!, flip: false };
  state.csEdit = { draft, orig: cs, field: null, activate: state.activeCs === id };
  setPaneOpen('dialog', true); togglePanel('dialog', !isPhone()); renderAll();
}
function csPick(fid: number) {
  const e = state.csEdit!, f = state.features.find((x) => x.id === fid); if (!f || !e.field) return;
  if (!usableAs(f.type, csStep(e.field))) { toast(tt('{0} cannot be used as {1}.', typeName(f.type), csFieldName(e.field))); return; }
  const d = e.draft;
  if (e.field === 'p' || e.field === 's' || e.field === 't') csSlotSet(d, e.field, fid); // smart axes + auto origin; triad updates live
  else d.origin[e.field] = { ...d.origin[e.field], fid, auto: undefined };
  const nx = nextEmptyField(d, e.field); e.field = nx === 'p' || nx === 's' || nx === 't' ? nx : null; // Primary → Secondary → Tertiary
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

function featOptions(step: 'primary' | 'secondary' | 'tertiary' | 'origin', cur: number | null) {
  return `<option value="">—</option>` + state.features.filter((f) => f.type !== 'Abstand' && usableAs(f.type, step))
    .map((f) => `<option value="${f.id}" ${f.id === cur ? 'selected' : ''}>${f.name} (${typeName(f.type)})</option>`).join('');
}
const axisSel = (id: string, cur: Axis, flip: boolean) => `<select id="${id}" class="cs-ax">${(['X', 'Y', 'Z'] as Axis[]).flatMap((a) => [[a, false], [a, true]] as [Axis, boolean][])
  .map(([a, fl]) => `<option value="${fl ? '-' : '+'}${a}" ${a === cur && fl === flip ? 'selected' : ''}>${fl ? '−' : '+'}${a}</option>`).join('')}</select>`;
/** Translations a step's feature can lock (logical defaults): plane → along its own axis; axis (cylinder/cone/line) →
 *  the two axes ⟂ to it; circle/sphere/point → all three. */
function dofAllowed(cs: CSys, step: 'p' | 's' | 't'): Axis[] {
  const id = slotRef(cs, step).fid, f = state.features.find((x) => x.id === id); if (!f) return [];
  const ax = slotRef(cs, step).axis, others = (['X', 'Y', 'Z'] as Axis[]).filter((a) => a !== ax);
  if (f.type === 'Ebene') return [ax];
  if (['Zylinder', 'Kegel', 'Linie', 'Torus'].includes(f.type)) return step === 'p' ? others : others.filter((a) => a !== cs.primary.axis);
  return ['X', 'Y', 'Z'];
}
const slotRef = (cs: CSys, k: 'p' | 's' | 't') => (k === 'p' ? cs.primary : k === 's' ? cs.secondary : (cs.tertiary ??= { fid: null, axis: 'Y', flip: false }));
function dofSection(cs: CSys, step: 'p' | 's' | 't'): string {
  const id = slotRef(cs, step).fid; if (id == null) return '';
  const al = dofAllowed(cs, step), rot = step === 'p' ? tt('2 rotations (level)') : step === 's' ? tt('1 rotation (about the primary axis)') : tt('no rotation (translations only)');
  return `<details class="cs-dofs"><summary>${tt('Constrained DOF')}</summary>
    <label><input type="checkbox" ${step === 't' ? '' : 'checked'} disabled> ${rot}</label>
    ${(['X', 'Y', 'Z'] as Axis[]).map((a) => `<label title="${al.includes(a) ? tt('Lock the {0} translation with this feature (sets origin {0})', a) : tt('This feature cannot define the {0} translation', a)}"><input type="checkbox" data-dof="${step}${a}" ${cs.origin[a].fid === id ? 'checked' : ''} ${al.includes(a) ? '' : 'disabled'}> ${tt('Translation {0}', a)}</label>`).join('')}
  </details>`;
}
function renderCsEdit(d: HTMLElement) {
  const e = state.csEdit!, cs = e.draft, r = csResult(cs); slotRef(cs, 't');
  const pickBtn = (k: CsField) => `<button class="btn cs-pick ${e.field === k ? 'on' : ''}" data-pick="${k}" title="${tt('Pick in 3D view or tree')}">⌖</button>`;
  const row = (k: CsField, label: string, inner: string) => `<div class="cs-row ${e.field === k ? 'act' : ''}"><label>${label}</label>${inner}${pickBtn(k)}</div>`;
  const slot = (k: 'p' | 's' | 't', n: number, title: string, note: string) => { const ref = slotRef(cs, k);
    return `<h4>${n} · ${title}${k === 'p' ? ' <small class="req-l">' + tt('required') + '</small>' : ''}</h4>
    ${row(k, tt('Geometry'), `<select id="cs-${k}">${featOptions(csStep(k), ref.fid)}</select>`)}
    <div class="cs-row"><label title="${tt('Which axis of the new system this feature defines (sign = direction)')}">${tt('Axis')}</label>${axisSel('cs-' + k + 'a', ref.axis, ref.flip)}
      ${k !== 't' ? `<button class="btn cs-flip" data-flip="${k}" title="${tt('Flip this axis (reverse direction)')}">⇅ ${tt('Flip')}</button>` : ''}</div>
    <p class="note">${note}</p>${dofSection(cs, k)}`; };
  d.innerHTML = `<h3>${ICON.csys} ${e.orig ? tt('Edit coordinate system') : tt('New coordinate system (3-2-1)')}</h3>
    <div class="row"><label>${tt('Name')}</label><input id="cs-name" value="${cs.name.replace(/"/g, '&quot;')}"></div>
    <div class="cs-dof ${r.error ? 'err' : r.dof === 6 ? 'ok' : ''}">${tt('DOF locked')} <b>${r.error ? '—' : r.dof}/6</b>${r.error ? ` · ⚠ ${tt(r.error)}` : ''}${r.warnings.map((w) => `<div class="note">⚠ ${tt(w)}</div>`).join('')}</div>
    <p class="note">${tt('Three slots like a datum system: pick a geometry for Primary, Secondary and Tertiary (3D view, tree or list). Axes get smart defaults – primary plane normal → +Z out of the material, secondary → X, tertiary → the remaining axis; the triad in the 3D view follows after every step. Adjust with Flip / Rotate 90°.')}</p>
    ${slot('p', 1, tt('Primary'), tt('Plane: normal · cylinder, cone, line: axis. Locks 2 rotations.'))}
    ${slot('s', 2, tt('Secondary'), tt('Projected into the primary plane. Circle/sphere/point: direction from the origin feature to its center. Locks 1 rotation.'))}
    ${slot('t', 3, tt('Tertiary'), tt('Locks the remaining translation: plane → along its axis, circle/cylinder/point → the remaining free axes.'))}
    <div class="row cs-adj"><button class="btn" id="cs-rot" title="${tt('Rotate the system by 90° about the primary axis')}">⟳ ${tt('Rotate 90°')}</button><button class="btn" data-flip="p" title="${tt('Flip the primary axis')}">⇅ ${tt('Flip primary')}</button><button class="btn" data-flip="s" title="${tt('Flip the secondary axis')}">⇅ ${tt('Flip secondary')}</button></div>
    <details class="cs-origin"><summary>${tt('Origin & offsets (advanced)')}</summary>
    ${(['X', 'Y', 'Z'] as Axis[]).map((a) => row(a, a, `<select id="cs-o${a}">${featOptions('origin', cs.origin[a].fid)}</select><input id="cs-off${a}" class="cs-off" type="text" inputmode="decimal" data-num="signed" value="${cs.origin[a].off}" title="${tt('Offset [mm]')}">${cs.origin[a].auto ? `<small class="cs-auto" title="${tt(cs.origin[a].auto!)}">auto</small>` : ''}`)).join('')}
    <p class="note">${tt('Filled automatically from the three slots (“auto”); override per axis or add an offset in mm.')} <a href="#" id="cs-help">${tt('Why?')}</a></p></details>
    <div class="row"><label><input type="checkbox" id="cs-act" ${e.activate ? 'checked' : ''}> ${tt('Activate after creation')}</label></div>
    <div class="row"><button class="btn primary" id="cs-ok" ${r.error ? 'disabled' : ''}>✓ ${e.orig ? tt('Apply') : tt('Create')}</button><button class="btn" id="cs-cancel">✕ ${tt('Cancel')}</button></div>`;
  const q = <T extends HTMLElement>(sel: string) => d.querySelector<T>(sel)!;
  const fid = (v: string) => (v === '' ? null : Number(v));
  q<HTMLInputElement>('#cs-name').onchange = (ev) => { cs.name = (ev.target as HTMLInputElement).value.trim() || cs.name; renderModeBar(); renderScene(); };
  const ax = (v: string): [Axis, boolean] => [v.slice(1) as Axis, v[0] === '-'];
  for (const k of ['p', 's', 't'] as const) {
    q<HTMLSelectElement>('#cs-' + k).onchange = (ev) => { csSlotSet(cs, k, fid((ev.target as HTMLSelectElement).value)); renderAll(); };
    q<HTMLSelectElement>('#cs-' + k + 'a').onchange = (ev) => { const ref = slotRef(cs, k); [ref.axis, ref.flip] = ax((ev.target as HTMLSelectElement).value);
      if (k !== 't') { const t = slotRef(cs, 't'), rest = (['X', 'Y', 'Z'] as Axis[]).find((a) => a !== cs.primary.axis && a !== cs.secondary.axis); if (rest) t.axis = rest; }
      suggestOrigin(cs, featMap()); renderAll(); };
  }
  d.querySelectorAll<HTMLButtonElement>('[data-flip]').forEach((b) => (b.onclick = () => { const ref = slotRef(cs, b.dataset.flip as 'p' | 's'); ref.flip = !ref.flip; renderAll(); }));
  q('#cs-rot').onclick = () => { rotate90(cs); suggestOrigin(cs, featMap()); renderAll(); };
  for (const a of ['X', 'Y', 'Z'] as Axis[]) {
    q<HTMLSelectElement>('#cs-o' + a).onchange = (ev) => { cs.origin[a].fid = fid((ev.target as HTMLSelectElement).value); cs.origin[a].auto = undefined; renderAll(); };
    q<HTMLInputElement>('#cs-off' + a).onchange = (ev) => { const v = parseNum((ev.target as HTMLInputElement).value); if (v != null && isFinite(v)) cs.origin[a].off = v; renderAll(); };
  }
  d.querySelectorAll<HTMLInputElement>('[data-dof]').forEach((i) => (i.onchange = () => { const st = i.dataset.dof![0] as 'p' | 's' | 't', ax2 = i.dataset.dof![1] as Axis, id = slotRef(cs, st).fid;
    cs.origin[ax2] = i.checked ? { ...cs.origin[ax2], fid: id, auto: undefined } : { ...cs.origin[ax2], fid: null, auto: undefined }; renderAll(); }));
  d.querySelector('#cs-help')?.addEventListener('click', (ev) => { ev.preventDefault(); showDocs('csys'); });
  d.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => (b.onclick = () => { e.field = e.field === b.dataset.pick ? null : (b.dataset.pick as CsField); renderAll(); if (isPhone() && e.field) togglePanel('dialog', false); }));
  q<HTMLInputElement>('#cs-act').onchange = (ev) => { e.activate = (ev.target as HTMLInputElement).checked; };
  q('#cs-ok').onclick = () => csOk(); q('#cs-cancel').onclick = () => csCancel();
}
function csSpec(): CtxSpec {
  const e = state.csEdit!, r = csResult(e.draft);
  const chips = (['p', 's', 't'] as const).map((k) => {
    const ref = slotRef(e.draft, k), id = ref.fid;
    return `<button data-csf="${k}" class="cp-chip ${e.field === k ? 'on' : ''}" title="${csFieldName(k)}">${k === 'p' ? '1' : k === 's' ? '2' : '3'}: ${id != null ? nameOf(id) + ` <small>${ref.flip ? '−' : '+'}${ref.axis}</small>` : '…'}</button>`; }).join('')
    + `<button data-csrot class="cp-chip" title="${tt('Rotate the system by 90° about the primary axis')}">⟳ 90°</button>`;
  return {
    title: `${ICON.csys} ${e.draft.name}`,
    controls: chips,
    stats: `<span class="cp-kv"><small>${tt('DOF')}</small><b>${r.error ? '—' : r.dof}/6</b></span>${r.error ? `<span class="cp-hint">⚠ ${tt(r.error)}</span>` : e.field ? `<span class="cp-hint">${tt('Pick: {0}', csFieldName(e.field))}</span>` : ''}`,
    bind: (el) => { el.querySelectorAll<HTMLButtonElement>('[data-csf]').forEach((b) => (b.onclick = () => { e.field = e.field === b.dataset.csf ? null : (b.dataset.csf as CsField); renderAll(); }));
      el.querySelector<HTMLButtonElement>('[data-csrot]')?.addEventListener('click', () => { rotate90(e.draft); suggestOrigin(e.draft, featMap()); renderAll(); }); },
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
      cs ? eyeBtn(cs.visible, () => { cs.visible = !cs.visible; renderTree(); renderScene(); scheduleAutosave(); }) : eyeBtn(wcsVisible, () => setWcsVisible(!wcsVisible)));
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
  if (!cs) items.push([wcsVisible ? `👁 ${tt('Hide triad')}` : `👁 ${tt('Show triad')}`, () => setWcsVisible(!wcsVisible)], [`⌖ ${tt('Center on origin')}`, () => centerOnWcs()]);
  else items.push([`⌖ ${tt('Center on origin')}`, () => { const r = csResult(cs); if (r.frame) { viewer.focus(r.frame.o as [number, number, number], (state.data?.diag ?? 100) / 6); status(tt('{0}: origin centered.', cs.name)); } }]);
  if (cs) items.push(null, [`✕ ${tt('Delete')}`, () => csDelete(id)]);
  ctxMenu.className = 'ctx-menu';
  ctxMenu.innerHTML = items.map((it, i) => (it ? `<button data-i="${i}">${it[0]}</button>` : '<hr>')).join('');
  ctxMenu.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => { ctxMenu.classList.add('hidden'); items[+b.dataset.i!]![1](); }));
  ctxMenu.style.left = Math.min(x, innerWidth - ctxMenu.offsetWidth - 4) + 'px'; ctxMenu.style.top = Math.min(y, innerHeight - ctxMenu.offsetHeight - 4) + 'px';
}
/** Global coordinate system (from the scan/CAD import): triad at the origin, eye in the tree, 'Center on origin'. */
var wcsVisible = localStorage.getItem('mw3d-wcs') === '1';
function setWcsVisible(on: boolean) { wcsVisible = on; localStorage.setItem('mw3d-wcs', on ? '1' : '0'); document.getElementById('btn-toggle-wcs')?.classList.toggle('on', on); renderAll(); }
function centerOnWcs() { if (!wcsVisible) setWcsVisible(true); viewer.focus([0, 0, 0], (state.data?.diag ?? 100) / 6); status(tt('Global (WCS) origin centered.')); }
function renderCsTriads() {
  if (wcsVisible && state.showCs && !state.csEdit) viewer.addTriad([0, 0, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], tt('Global (WCS)'), state.activeCs == null);
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
renderCsIndicator();
Object.assign((window as any).__app, { setWcsVisible, centerOnWcs, csNew, csActivate, csOk, csEditStart, csResult, csPick, ensurePosition, ensureDatum, csSelect, csCancel, propsSelection, deleteSelection, selectFeature });


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
  if (state.preview && isPhone()) { togglePanel('dialog', false); togglePanel('table', false); }
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
      : `<div class="row"><label>${tt(q.label)}${q.unit ? ` [${q.unit}]` : ''}</label><input data-cpar="${q.key}" value="${m.params[q.key]}" inputmode="decimal" data-num="signed"></div>`).join('')}
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
    if (p.params) rows.push([tt('Max. angle'), fmt(p.params.maxAngleDeg ?? 0, 1) + '°'], [tt('Growth limit r'), p.params.radius ? fmt(p.params.radius, 2) + ' mm' : tt('unlimited')]);
    if (p.aux) rows.push([tt('Auxiliary plane'), `${p.aux.source} (${p.aux.points} ${tt('pts')})`]);
    if (f.fp?.zoneSrc === 'geom') rows.push([tt('Boundary from'), `${tt('Fitted geometry')} (± ${fmt(f.fp.zoneBand ?? 0, 3)} mm${f.fp.inset ? ` · ${tt('Boundary excl.')} ${fmt(f.fp.inset, 2)} mm` : ''})`]); }
  else if (p.kind === 'derived') { const d = DERIVES.find((x) => x.key === p.key); rows.push([tt('Method'), `🔗 ${tt('Derived from Analyze')}`], [tt('Derivation'), d ? tt(d.label) : p.key], [tt('Parent'), nameOf(p.parents[0])]);
    if (p.error) rows.push([tt('Error'), `⚠ ${p.error}`]); rows.push([tt('Update'), tt('recomputed automatically when the parent changes')]); }
  else if (p.kind === 'anchor') { rows.push([tt('Method'), tt('Anchor')]); p.pts.forEach((q, i) => rows.push([`P${i + 1}`, q.map((v) => fmt(v, 3)).join(' ')])); }
  else return '';
  if (f.reex) { const r = normReex(f.reex); rows.push([tt('Then: re-extraction'), tt('search distance ±{0} mm · lateral {1} mm · outliers > {2} × RMS · {3}°{4} → {5} pts ({6} before, {7} removed)', r.maxDist, fmt(lateralOf(r), 2) + (r.margin == null ? ' (' + tt('auto') + ')' : ''), r.sigma > 0 ? r.sigma : tt('off'), r.maxAngleDeg, r.fill ? ' · ' + tt('all inside boundary') : '', f.reex.points, f.reex.before, f.reex.removed)]); }
  return `<h4>${tt('Provenance')}</h4>${kv(rows)}`;
}
/** Feature dialog part for constructed features: definition, parameters (editable → recompute). */
function conDefinitionHTML(f: FeatureView): string {
  if (!f.cons) return '';
  const c = conByKey(f.cons.key);
  const refs = f.cons.refs, n = refs.length, min = c ? (c.multi ? c.slots.length + c.multi.min : c.slots.length) : n;
  const blocked = c ? dependentsOf(state.features, [f.id]) : new Set<number>();
  const optsFor = (i: number) => { const s = c ? slotFor(c, i) : null; return state.features.filter((g) => g.id !== f.id && !blocked.has(g.id) && g.measured && (!s || accepts(s, g.type))); };
  const rows = refs.map((r, i) => { const s = c ? slotFor(c, i) : null;
    return `<div class="row con-in"><label>${s ? tt(s.label) : '#' + (i + 1)}</label><select data-cin="${i}">${optsFor(i).map((g) => `<option value="${g.id}" ${g.id === r ? 'selected' : ''}>${g.name}</option>`).join('')}</select>
      <button type="button" class="btn" data-cmv="${i}" ${i ? '' : 'disabled'} title="${tt('Swap with the input above')}">↑</button>${c?.multi && n > min ? `<button type="button" class="btn" data-crm="${i}" title="${tt('Remove this input')}">✕</button>` : ''}</div>`; }).join('');
  const addable = c?.multi ? optsFor(n).filter((g) => !refs.includes(g.id)) : [];
  const add = addable.length ? `<div class="row con-in"><label>${tt('Add input')}</label><select data-cadd><option value="">＋ …</option>${addable.map((g) => `<option value="${g.id}">${g.name}</option>`).join('')}</select></div>` : '';
  return `<h4>🔗 ${tt('Construction')}</h4>${kv([[tt('Method'), c ? tt(c.label) : f.cons.key], [tt('Inputs'), `${n}${c?.multi ? ` (${tt('min. {0}', min)})` : ''}`]])}
    <div class="note">${tt('Source features – change, swap, add or remove; the feature and everything built on it (coordinate systems, controls, report) recompute at once.')}</div>${rows}${add}
    ${(c?.params ?? []).map((q) => `<div class="row"><label>${tt(q.label)}${q.unit ? ` [${q.unit}]` : ''}</label><input data-fpar="${q.key}" value="${f.cons!.params?.[q.key] ?? q.def}" inputmode="decimal" data-num="signed"></div>`).join('')}
    ${f.cons.error ? `<div class="cs-dof err">⚠ ${f.cons.error}</div>` : ''}`;
}
function setConRefs(f: FeatureView, refs: number[]) {
  f.cons!.refs = refs; f.refs = [...refs]; f.cons!.error = undefined as any;
  try { recomputeDistances(); } catch (e: any) { f.cons!.error = e.message; }
  renderAll(); scheduleAutosave();
}
function bindConDefinition(d: HTMLElement, f: FeatureView) {
  d.querySelectorAll<HTMLSelectElement>('[data-cin]').forEach((s) => (s.onchange = () => { const r = [...f.cons!.refs]; r[+s.dataset.cin!] = +s.value; setConRefs(f, r); }));
  d.querySelectorAll<HTMLButtonElement>('[data-cmv]').forEach((b) => (b.onclick = () => { const i = +b.dataset.cmv!, r = [...f.cons!.refs]; [r[i - 1], r[i]] = [r[i], r[i - 1]]; setConRefs(f, r); }));
  d.querySelectorAll<HTMLButtonElement>('[data-crm]').forEach((b) => (b.onclick = () => { const r = f.cons!.refs.filter((_, i) => i !== +b.dataset.crm!); setConRefs(f, r); }));
  const ad = d.querySelector<HTMLSelectElement>('[data-cadd]'); if (ad) ad.onchange = () => { if (ad.value) setConRefs(f, [...f.cons!.refs, +ad.value]); };
  d.querySelectorAll<HTMLInputElement>('[data-fpar]').forEach((i) => (i.onchange = () => { const v = Number(i.value.replace(',', '.')); if (!isFinite(v)) return; (f.cons!.params ??= {})[i.dataset.fpar!] = v; recomputeDistances(); renderAll(); }));
}
{
  // ONE feature list: construction-only types join the Start ribbon – Angle beside Distance, Bolt circle under ⋯ More
  for (const o of CON_OUTS.filter((o) => o.out === 'Winkel' || o.key === 'bc-pattern')) {
    const bc = o.key === 'bc-pattern', b = document.createElement('button'); b.className = bc ? 'rb-mi' : 'rb-s'; b.dataset.con = o.key ?? o.out;
    b.innerHTML = `<span class="ico">${bc ? '✲' : ICON[o.out] ?? ''}</span><span>${tt(o.label)}</span>${bc ? `<span class="hint">${tt('construction')}</span>` : ''}`;
    b.title = bc ? tt('Construct a bolt-circle pattern with pitch from holes') : tt('Construct {0} from other features', tt(o.label));
    b.onclick = () => startConstruct(o.out, o.key);
    if (bc) featMore.appendChild(b); else angleSlot.replaceWith(b);
  }
}
Object.assign((window as any).__app, { startConstruct, conPick, CONSTRUCTIONS, openFeatureProps, applyTol });
