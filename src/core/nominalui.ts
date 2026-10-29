// Feature Builder labels, CAD nominal create policy, and orientation (2026.0.46).
// User-facing words are measured / nominal. Internal roles stay 'ist' / 'soll'.
import type { FitResult } from './fit';
import type { SollState } from './featuremodel';
import { t, typeName } from '../i18n';
import { unit, type Vec3 } from './linalg';

export function roleWord(role: 'soll' | 'ist' | null | undefined): string {
  if (role === 'soll') return t('nominal');
  if (role === 'ist') return t('measured');
  return '';
}

/** English geometry name shown by Smart Detect (plane, circle, cylinder, …). */
export function smartDetectLabel(type: string): string {
  return type ? typeName(type) : '';
}

export function detectBadge(type: string): string {
  if (!type) return '';
  return `<span class="cp-detected" data-detected="${type}">${smartDetectLabel(type)}</span>`;
}

const CURVE = new Set(['Kreis', 'Langloch', 'Linie', 'Linienzug']);
const SURFACE = new Set(['Ebene', 'Zylinder', 'Kegel', 'Kugel', 'Torus', 'Freiformfläche']);

export function featureClass(type: string): 'curve' | 'surface' | 'other' {
  if (CURVE.has(type)) return 'curve';
  if (SURFACE.has(type)) return 'surface';
  return 'other';
}

export function featureClassWord(type: string): string {
  const c = featureClass(type);
  return c === 'curve' ? t('curve') : c === 'surface' ? t('surface') : '';
}

/** ✓ / Create nominal is available once a nominal preview or a live CAD fit exists. Surfaces and curves share this gate. */
export function nominalCanConfirm(preview: { role?: string } | null | undefined, hoverFit: unknown): boolean {
  return preview?.role === 'soll' || !!hoverFit;
}

export type NominalMethodKey = 'mesh' | 'con' | 'anchor' | 'cad' | 'derive';
/**
 * Create-menu rows. Circle, slot and line share one row. Polyline uses the same rows;
 * polygon / construction / anchor stay off (no mesh nominal) and From CAD stays on.
 * Derive is the scan path for a polyline.
 */
export function nominalMethodRow(type: string, avail: { con: boolean; anchor: boolean }): { key: NominalMethodKey; enabled: boolean }[] {
  const poly = type === 'Linienzug';
  const blocked = type === 'Abstand' || type === 'Winkel';
  const row: { key: NominalMethodKey; enabled: boolean }[] = [
    { key: 'mesh', enabled: !poly && type !== 'Winkel' },
    { key: 'con', enabled: !poly && avail.con },
    { key: 'anchor', enabled: !poly && avail.anchor },
    { key: 'cad', enabled: !blocked },
  ];
  if (poly) row.push({ key: 'derive', enabled: true });
  return row;
}

/** Sticky Nominal / Measured. The presence of a data object does not change it. */
export function stickySide(choice: 'soll' | 'ist', _hasDataObject = false): 'soll' | 'ist' {
  return choice;
}

export type FbLayout = 'compact' | 'classic';
/** Approved compact Feature Builder is the default. 'classic' is the previous panel. */
export function featureBuilderLayout(stored: string | null | undefined): FbLayout {
  return stored === 'classic' ? 'classic' : 'compact';
}
/** Compact lives in the right-hand dialog. Classic keeps the bottom dock, on desktop and on a phone. */
export function featureBuilderHost(stored: string | null | undefined): 'dialog' | 'dock' {
  return featureBuilderLayout(stored) === 'classic' ? 'dock' : 'dialog';
}
/** One strong highlight. After Smart Detect, Add region (multi) is that highlight.
 *  Choosing Smart Detect again lights only Smart Detect. */
export function fbActionOn(hasPreview: boolean, multi: boolean): { smart: boolean; add: boolean } {
  if (hasPreview && multi) return { smart: false, add: true };
  if (hasPreview) return { smart: true, add: false };
  return { smart: !multi, add: false };
}
/** Boundary exclusion is a nominal control. Measured hides it. */
export function boundaryExclusionFor(nominal: boolean): 'enabled' | 'hidden' {
  return nominal ? 'enabled' : 'hidden';
}
/** Nominal uses the system cursor. Measured keeps the pick/brush ring. */
export function showPickRing(nominal: boolean): boolean {
  return !nominal;
}

/** Add Region is offered as soon as Smart Detect has a preview and the feature is not confirmed yet. */
export function addRegionSuggested(hasPreview: boolean, multi: boolean): boolean {
  return hasPreview && !multi;
}

/**
 * Bottom line of the compact Feature Builder: role word, type icon only, form, standard deviation.
 * The geometry name (Plane, …) is not written beside the role.
 */
export function compactStatHtml(role: 'soll' | 'ist', roleLabel: string, icon: string, formLabel: string, form: string, stdLabel: string, std: string): string {
  return `<span class="cp-side ${role}" data-side="${role}" data-label="${roleLabel}">${roleLabel}</span>`
    + `<span class="cp-type">${icon}</span>`
    + `<span class="cp-kv" data-kv="form"><small>${formLabel}</small><b>${form}</b></span>`
    + `<span class="cp-kv" data-kv="std"><small>${stdLabel}</small><b>${std}</b></span>`;
}

/** Top-level tree. No parent group. Pin only Data and Reference. Every group has an eye. */
export const TREE_GROUPS: { id: 'data' | 'ref' | 'feat' | 'cs'; name: string; pin: boolean; eye: true }[] = [
  { id: 'data', name: 'Data', pin: true, eye: true },
  { id: 'ref', name: 'Reference', pin: true, eye: true },
  { id: 'feat', name: 'Features', pin: false, eye: true },
  { id: 'cs', name: 'Coordinate Systems', pin: false, eye: true },
];

/** Selected CAD surface: opaque enough to read as a face, not a faint wireframe. */
export const SURFACE_HIGHLIGHT = { color: 0xff6a00, opacity: 0.86, emissive: 0xe65100 };

/** CAD nominal is pointer-only: no brush, no fit criterion, no normal angle. Measured keeps all three. */
export function scanControls(nominal: boolean): { fitCriterion: boolean; normalAngle: boolean; brushRadius: boolean } {
  return nominal
    ? { fitCriterion: false, normalAngle: false, brushRadius: false }
    : { fitCriterion: true, normalAngle: true, brushRadius: true };
}

/** Advanced fields for a nominal create. Fit criterion and the normal angle are absent. */
export function nominalAdvancedControls(brushMm: number): string {
  const pol = scanControls(true);
  const brush = pol.brushRadius
    ? `<label title="${t('Brush radius [mm]')}">r <input id="cp-brush" data-num="abs" type="number" min="0.05" step="0.1" value="${brushMm}" inputmode="decimal"> mm</label>`
    : '';
  const fit = pol.fitCriterion ? `<label>${t('Fit criterion')}</label>` : '';
  const ang = pol.normalAngle ? `<label>${t('Normal angle')}</label>` : '';
  return brush + fit + ang;
}

/** Axis or plane normal stored on the fit and shown as Orientation. */
export function orientationOf(fit: FitResult): Vec3 {
  const d = (fit.type === 'Linie' || fit.type === 'Langloch') && fit.direction ? fit.direction : fit.normal;
  return unit(d);
}

export function orientationText(fit: FitResult, digits = 4): string {
  return orientationOf(fit).map((v) => v.toFixed(digits)).join(' ');
}

/** Nominal component written into the tree when the user confirms a CAD hit. No measured fit yet. */
export function nominalRecord(fit: FitResult, faceId?: number, seed?: Vec3[]): SollState {
  const { residuals: _r, ...rest } = fit;
  void _r;
  return { source: 'cad', fit: rest, method: 'aus CAD', faceId, seed };
}

export function nominalDraft(fit: FitResult, faceId?: number) {
  return { type: fit.type, class: featureClass(fit.type), measured: undefined as undefined, soll: nominalRecord(fit, faceId), orientation: orientationOf(fit) };
}

/** Nominal is available when a CAD reference or a nominal feature exists. Measured needs a scan or a measured feature. */
export function sideChoices(hasCad: boolean, hasMesh: boolean, hasSoll = false, hasIst = false): { soll: boolean; ist: boolean } {
  return { soll: hasCad || hasSoll, ist: hasMesh || hasIst };
}
/** Sticky choice, kept only when that side can actually be built. */
export function resolveSide(choice: 'soll' | 'ist', hasCad: boolean, hasMesh: boolean, hasSoll = false, hasIst = false): 'soll' | 'ist' {
  const a = sideChoices(hasCad, hasMesh, hasSoll, hasIst);
  if (choice === 'soll' && a.soll) return 'soll';
  if (choice === 'ist' && a.ist) return 'ist';
  if (a.ist) return 'ist';
  if (a.soll) return 'soll';
  return choice;
}
/** Interactive create needs the raw data (CAD or the scan). Construct needs an existing feature of that side. */
export function pathEnabled(side: 'soll' | 'ist', path: 'interactive' | 'construct', src: { cad: boolean; mesh: boolean; soll: boolean; ist: boolean }): boolean {
  if (path === 'interactive') return side === 'soll' ? src.cad : src.mesh;
  return side === 'soll' ? src.soll : src.ist;
}
/** Two-parent constructions read as From / To. Any other slot keeps its own name. */
export function slotCaption(index: number, count: number, label: string): string {
  if (count === 2 && index === 0) return 'From';
  if (count === 2 && index === 1) return 'To';
  return label;
}
const CURVE_TREE = new Set(['Kreis', 'Langloch', 'Linie', 'Linienzug']);
/**
 * Auxiliary plane of a circle, slot or line on a CAD nominal (Soll).
 * The plane is an Ist aid (scan wall ∩ face). A nominal curve does not show it.
 */
export function attachCadAux<T>(role: 'soll' | 'ist' | null | undefined, fitType: string, aux: T | null | undefined): T | undefined {
  if (!aux) return undefined;
  if (role === 'soll' && CURVE_TREE.has(fitType)) return undefined;
  return aux;
}
/** ✓ keeps Create or Construct. Only an explicit leave (Cancel / Esc) drops the mode. */
export function modeAfterConfirm<T>(mode: T, leave: boolean): T | null {
  return leave ? null : mode;
}
/**
 * Tree children of one feature: nominal, then measured, then the auxiliary plane
 * under the measured part of a curve. A nominal-only or measured-only feature
 * lists just the part it has. The auxiliary plane is not shown under nominal.
 */
export function featureTreeParts(f: { type: string; measured?: unknown; soll?: { fit?: unknown } | null; aux?: unknown }): ('soll' | 'ist' | 'aux')[] {
  const out: ('soll' | 'ist' | 'aux')[] = [];
  if (f.soll?.fit) out.push('soll');
  if (f.measured) out.push('ist');
  if (f.measured && f.aux && CURVE_TREE.has(f.type)) out.push('aux');
  return out;
}
/** How each component of a feature was created, for the properties dialog. */
export function creationLines(f: {
  measured?: unknown;
  method?: string;
  soll?: { source?: string; fit?: unknown } | null;
  cons?: { side?: 'soll' | 'ist' } | null;
}): { role: 'soll' | 'ist'; method: string }[] {
  const out: { role: 'soll' | 'ist'; method: string }[] = [];
  const constructedSoll = f.soll?.source === 'constructed' || f.cons?.side === 'soll';
  if (f.soll?.fit) out.push({ role: 'soll', method: constructedSoll ? 'Construction' : 'From CAD' });
  if (f.measured) {
    const istIsConstruction = !!f.cons && f.cons.side !== 'soll' && f.method === 'Konstruiert';
    let method = 'Click & grow';
    if (istIsConstruction || (f.method === 'Konstruiert' && !f.soll?.fit)) method = 'Construction';
    else if (f.method === 'Pinsel') method = 'Brush';
    else if (f.method === 'Anker') method = 'Anchor';
    else if (f.method === 'Abgeleitet') method = 'Derived from Analyze';
    else if (f.method === 'aus Soll') method = 'From nominal';
    out.push({ role: 'ist', method });
  }
  return out;
}
