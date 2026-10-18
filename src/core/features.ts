// Merkmale (Features) und Prüfmerkmale (Controls). Erweiterbar um Soll-Komponente (CAD).
import { FitResult, GeomType } from './fit';
import { Vec3, add, dot, norm, scale, sub, unit } from './linalg';
import { toLocal, dirLocal } from './csys';
import { DATUM_CONTROLS, DatumKindCtl, EvalCtx, datumKind, evalDatumControl, isDatumControl } from './datum';
import { medianLine, straightnessMZ } from './median';
export type { EvalCtx } from './datum';

export interface Feature {
  id: number;
  name: string;
  type: GeomType;
  measured?: FitResult;      // Ist-Komponente
  nominal?: FitResult;       // Soll-Komponente (spätere CAD-Erweiterung)
  pointCount: number;
  method: 'Klick' | 'Pinsel' | 'Konstruiert' | 'Anker' | 'Abgeleitet';
  /** derived from an analysis (Derive feature from Analyze): recomputed from the parent's points when it changes */
  derived?: { key: string; parent: number; error?: string };
  refs?: number[];           // Abstand: IDs der beiden Bezugsmerkmale
  aux?: AuxPlane;            // Hilfsebene (Projektionsebene) für Kreis/Langloch
  datum?: string;            // Bezugsbuchstabe (A, B, C …)
  /** constructed feature: construction key, parents (also in refs) and parameters */
  cons?: { key: string; refs: number[]; params?: Record<string, number>; error?: string };
  /** anchor feature: the picked points (mathematical minimum) and their surface normals */
  anchor?: { pts: Vec3[]; nrm: Vec3[] };
  /** re-extraction applied on top of the initial method (parameters + result) */
  reex?: { maxDist: number; sigma: number; maxAngleDeg: number; margin?: number | null; fill?: boolean; fillBand?: number; points: number; removed: number; before: number };
}

/** Hilfsebene: Ebene, in die die Wandpunkte projiziert werden (Kreis/Langloch). */
export interface AuxPlane {
  plane: FitResult;          // gefittete Ebene (Ist)
  pointCount: number;
  source: string;            // 'automatisch (angrenzende Fläche)' oder Name einer vorhandenen Ebene
  refId?: number;            // ID der verwendeten vorhandenen Ebene
}

export type ControlKind =
  | 'Durchmesser' | 'Radius' | 'X' | 'Y' | 'Z' | 'Länge' | 'Breite' | 'Kegelwinkel'
  | 'Form' | 'Winkel X' | 'Winkel Y' | 'Winkel Z' | 'Std.-Abw.'
  | 'Rohrdurchmesser' | 'Rohrradius'
  | 'Abstand 3D' | 'Abstand X' | 'Abstand Y' | 'Abstand Z' | 'Winkelwert' | 'Teilung' | 'Geradheit Achse' | DatumKindCtl;

export interface Control {
  id: number;
  kind: ControlKind;
  featureIds: number[];       // ein Merkmal (Abstände sind eigene Merkmale)
  nominal: number | null;     // Sollwert (von Hand)
  tolUp: number;
  tolLo: number;              // negativ, z. B. -0.1
  datumIds?: number[];        // Bezüge (Merkmal-IDs) in Reihenfolge primär|sekundär|tertiär
  /** orientation of an axis: Ø (cylindrical) zone; false = zone between two parallel planes; undefined = default of the case (see zoneIsDia) */
  dia?: boolean;
  /** material modifier on the tolerance (ISO 2692): Ⓜ maximum / Ⓛ least material requirement */
  mod?: 'M' | 'L';
  /** material modifiers on the datums (same order as datumIds) → datum shift */
  datumMods?: ('M' | 'L' | null)[];
  /** pattern: common zone (CZ, default) or separate zones */
  cz?: boolean;
  basic?: (number | null)[];  // TED (theoretically exact dimensions): position X/Y/Z in the DRF or angularity angle; null = not entered yet (never prefilled)
}

export interface ControlResult { measured: number | null; deviation: number | null; status: 'IO' | 'NIO' | '—'; flag?: string; detail?: string; /** Ⓜ/Ⓛ bonus tolerance */ bonus?: number; /** position: per member (hole) values */ members?: import('./datum').PosMemberInfo[]; worst?: number; }

export const FORM_NAME: Record<GeomType, string> = {
  Ebene: 'Flatness', Kreis: 'Roundness', Zylinder: 'Cylindricity', Langloch: 'Profile',
  Kegel: 'Cone form', Kugel: 'Sphere form', Torus: 'Torus form', Punkt: 'Form', Linie: 'Straightness', Linienzug: 'Form', Freiformfläche: 'Surface profile', Abstand: 'Form', Winkel: 'Form',
};

/** ISO-1101-Symbol der Formtoleranz je Merkmalstyp. */
export const FORM_SYMBOL: Record<GeomType, string> = {
  Ebene: '⏥', Kreis: '○', Zylinder: '⌭', Langloch: '⌒', Kegel: '⌓', Kugel: '⌓', Torus: '⌓', Punkt: '', Linie: '⏤', Linienzug: '', Abstand: '',
 Freiformfläche: '⌓', Winkel: '',
};

export interface CatalogItem { kind: ControlKind; label: string; symbol: string; note?: string; }
export interface CatalogGroup { group: string; items: CatalogItem[]; }

/**
 * Prüfmerkmal-Katalog je Merkmalstyp, gegliedert nach DIN EN ISO 1101 (Form, Richtung, Ort) plus Maße.
 * Richtungs- und Ortstoleranzen mit Bezug (Parallelität, Rechtwinkligkeit, Neigung, Position) benötigen
 * ein Bezugssystem; v3 bietet dafür die Winkel der Achse/Normalen zu den Koordinatenachsen und X/Y/Z an.
 */
export function controlCatalog(t: GeomType): CatalogGroup[] {
  const form = (note: string): CatalogGroup => ({ group: 'Form (ISO 1101)', items: [{ kind: 'Form', label: FORM_NAME[t], symbol: FORM_SYMBOL[t], note },
    { kind: 'Std.-Abw.', label: 'Standard deviation', symbol: 'σ', note: 'RMS of the distances to the best-fit element' }] });
  const pos: CatalogGroup = { group: 'Location (coordinates)', items: (['X', 'Y', 'Z'] as const).map((k) => ({ kind: k, label: `Position ${k}`, symbol: '⌖' })) };
  const dir = (what: string): CatalogGroup => ({ group: 'Orientation', items: (['X', 'Y', 'Z'] as const).map((k) => ({ kind: `Winkel ${k}` as ControlKind, label: `Angle of ${what} to ${k} axis`, symbol: '∠' })) });
  const dia: CatalogItem[] = [{ kind: 'Durchmesser', label: 'Diameter', symbol: '⌀' }, { kind: 'Radius', label: 'Radius', symbol: 'R' }];
  const axForm = (g: CatalogGroup): CatalogGroup => ({ ...g, items: [...g.items, { kind: 'Geradheit Achse', label: 'Straightness of axis', symbol: '⏤', note: 'Ø zone of the derived median line (section centres), minimum zone incl. tilt – ISO 1101' }] });
  const D = (kinds: DatumKindCtl[]): CatalogGroup => ({ group: 'With datum (ISO 1101 / ISO 5459)', items: kinds.map((k) => DATUM_ITEM[k]) });
  switch (t) {
    case 'Ebene': return [form('two parallel planes'), pos, dir('normal'), D(['Parallelität', 'Rechtwinkligkeit', 'Neigung', 'Position', 'Symmetrie', 'Profil (Bezug)'])];
    case 'Kreis': return [form('two concentric circles'), { group: 'Size', items: dia }, { group: 'Bolt-circle pattern', items: [{ kind: 'Teilung', label: 'Pitch deviation [°]', symbol: '✲', note: 'largest angular deviation from equal division (bolt-circle patterns only)' }] }, pos, dir('normal'), D(['Position', 'Konzentrizität', 'Rundlauf', 'Parallelität', 'Rechtwinkligkeit'])];
    case 'Zylinder': return [axForm(form('two coaxial cylinders')), { group: 'Size', items: dia }, pos, dir('axis'), D(['Position', 'Koaxialität', 'Parallelität', 'Rechtwinkligkeit', 'Neigung', 'Rundlauf', 'Gesamtrundlauf'])];
    case 'Kugel': return [form('surface profile (two spherical shells)'), { group: 'Size', items: dia }, pos, D(['Position', 'Konzentrizität', 'Profil (Bezug)'])];
    case 'Kegel': return [axForm(form('surface profile')), { group: 'Size', items: [{ kind: 'Kegelwinkel', label: 'Cone angle', symbol: '∢' }, ...dia] }, pos, dir('axis'), D(['Position', 'Koaxialität', 'Rundlauf', 'Parallelität', 'Rechtwinkligkeit', 'Neigung', 'Profil (Bezug)'])];
    case 'Langloch': return [form('line profile of the contour'), { group: 'Size', items: [{ kind: 'Länge', label: 'Length', symbol: '↔' }, { kind: 'Breite', label: 'Width', symbol: '↕' }] }, pos, dir('normal'), D(['Position', 'Symmetrie', 'Parallelität', 'Rechtwinkligkeit'])];
    case 'Torus': return [form('surface profile (torus form)'), { group: 'Size', items: [
      { kind: 'Durchmesser', label: 'Center circle Ø (2R)', symbol: '⌀', note: 'Diameter of the circle through the tube centers' }, { kind: 'Radius', label: 'Major radius R', symbol: 'R' },
      { kind: 'Rohrdurchmesser', label: 'Tube Ø (2r)', symbol: '⌀', note: 'Minor diameter' }, { kind: 'Rohrradius', label: 'Tube radius r', symbol: 'r' }] },
      pos, dir('axis'), D(['Position', 'Koaxialität', 'Rundlauf', 'Parallelität', 'Rechtwinkligkeit', 'Profil (Bezug)'])];
    case 'Punkt': return [pos, D(['Position'])];
    case 'Linienzug': return [{ group: 'Size', items: [{ kind: 'Länge', label: 'Length', symbol: '⟷', note: 'total length of all segments' }] }];
    case 'Linie': return [form('two parallel lines in the auxiliary plane'), { group: 'Size', items: [{ kind: 'Länge', label: 'Length', symbol: '↔' }] }, pos, dir('direction'), D(['Parallelität', 'Rechtwinkligkeit', 'Neigung', 'Position'])];
    case 'Freiformfläche': return [form('Surface profile without datum: deviation to the fitted B-spline surface (max − min)')];
    case 'Winkel': return [{ group: 'Angle', items: [{ kind: 'Winkelwert', label: 'Angle [°]', symbol: '∠' }] }];
    case 'Abstand': return [{ group: 'Distance', items: (['3D', 'X', 'Y', 'Z'] as const).map((k) => ({ kind: `Abstand ${k}` as ControlKind, label: `Distance ${k}`, symbol: '↔' })) }];
  }
}

export const DATUM_ITEM: Record<DatumKindCtl, CatalogItem> = {
  Parallelität: { kind: 'Parallelität', label: 'Parallelism', symbol: '∥' },
  Rechtwinkligkeit: { kind: 'Rechtwinkligkeit', label: 'Perpendicularity', symbol: '⟂' },
  Neigung: { kind: 'Neigung', label: 'Angularity', symbol: '∠', note: 'theoretically exact angle adjustable' },
  Position: { kind: 'Position', label: 'Position', symbol: '⌖', note: 'nominal location in datum system A|B|C; axes: cylindrical zone Ø' },
  Koaxialität: { kind: 'Koaxialität', label: 'Coaxiality', symbol: '◎' },
  Konzentrizität: { kind: 'Konzentrizität', label: 'Concentricity', symbol: '◎' },
  Symmetrie: { kind: 'Symmetrie', label: 'Symmetry', symbol: '⌯' },
  Rundlauf: { kind: 'Rundlauf', label: 'Circular run-out', symbol: '↗' },
  Gesamtrundlauf: { kind: 'Gesamtrundlauf', label: 'Total run-out', symbol: '⌰' },
  'Profil (Bezug)': { kind: 'Profil (Bezug)', label: 'Surface profile with datum', symbol: '⌓' },
};
export { DATUM_CONTROLS, isDatumControl, datumKind };
/** Bezugsbuchstaben eines Prüfmerkmals als Rahmen-Text, z. B. "A|B|C". */
export const MOD_SYM = { M: 'Ⓜ', L: 'Ⓛ' } as const;
export const datumText = (c: Control, feats: Map<number, Feature>) => (c.datumIds ?? []).map((id, i) => (feats.get(id)?.datum ?? '?') + (c.datumMods?.[i] ? MOD_SYM[c.datumMods[i]!] : '')).join('|');
/** Parse a datum reference like "A|B(M)|C" or "A|BⓂ|C" → letters + modifiers. */
export function parseDatumText(txt: string): { letters: string[]; mods: ('M' | 'L' | null)[] } {
  const toks = txt.toUpperCase().replace(/Ⓜ/g, '(M)').replace(/Ⓛ/g, '(L)').split(/[|,; ]+/).filter(Boolean);
  const letters: string[] = [], mods: ('M' | 'L' | null)[] = [];
  for (const t of toks) { const m = /^(.+?)\(([ML])\)$/.exec(t); letters.push(m ? m[1] : t); mods.push(m ? (m[2] as 'M' | 'L') : null); }
  return { letters, mods };
}

const KIND_EN: Partial<Record<ControlKind, string>> = { 'Geradheit Achse': 'Straightness of axis', Winkelwert: 'Angle', Teilung: 'Pitch deviation', Durchmesser: 'Diameter', Länge: 'Length', Breite: 'Width', Kegelwinkel: 'Cone angle', 'Std.-Abw.': 'Std. dev.', Rohrdurchmesser: 'Tube Ø', Rohrradius: 'Tube radius' };
export function controlLabel(c: Control, f?: Feature): string {
  if (isDatumControl(c.kind)) return DATUM_ITEM[c.kind].label;
  if (f?.type === 'Torus' && c.kind === 'Durchmesser') return 'Center circle Ø';
  if (c.kind === 'Form' && f) return FORM_NAME[f.type];
  if (c.kind === 'X' || c.kind === 'Y' || c.kind === 'Z') return 'Position ' + c.kind;
  if (c.kind.startsWith('Winkel ')) return `Angle to ${c.kind.slice(7)} axis`;
  if (c.kind.startsWith('Abstand ')) return 'Distance ' + c.kind.slice(8);
  return KIND_EN[c.kind] ?? c.kind;
}

/** Welche Prüfmerkmale sind für einen Merkmalstyp verfügbar? */
export function availableControls(t: GeomType): ControlKind[] {
  return controlCatalog(t).flatMap((g) => g.items.map((i) => i.kind));
}

export const DEG = 180 / Math.PI;
const axisAngle = (n: Vec3, k: number) => Math.acos(Math.min(1, Math.abs(n[k]) / (norm(n) || 1))) * DEG;

/**
 * Abstand zwischen zwei Merkmalen (Ist). Regel:
 *  - Ebene ↔ Ebene: Mittelpunkt von B senkrecht auf Ebene A projiziert (Punkt-Ebene-Abstand).
 *  - Ebene ↔ anderes Merkmal: Mittelpunkt des anderen Merkmals senkrecht auf die Ebene (Punkt-Ebene).
 *  - sonst: Mittelpunkt ↔ Mittelpunkt (bei Zylinder/Kegel/Kreis/Langloch liegt der Mittelpunkt auf der Achse).
 * X/Y/Z sind die Beträge der Komponenten von p2 − p1 im Koordinatensystem des Bauteils.
 */
export function computeDistance(a: FitResult, b: FitResult): FitResult {
  let p1: Vec3, p2: Vec3, rule: string;
  const proj = (pl: FitResult, q: Vec3): Vec3 => sub(q, scale(pl.normal, dot(sub(q, pl.center), pl.normal)));
  if (a.type === 'Ebene' && b.type === 'Ebene') { p2 = b.center; p1 = proj(a, b.center); rule = 'point (B) – plane (A)'; }
  else if (a.type === 'Ebene') { p2 = b.center; p1 = proj(a, b.center); rule = 'point (B) – plane (A)'; }
  else if (b.type === 'Ebene') { p1 = a.center; p2 = proj(b, a.center); rule = 'point (A) – plane (B)'; }
  else { p1 = a.center; p2 = b.center; rule = 'center – center'; }
  const delta = sub(p2, p1), d = norm(delta);
  return {
    type: 'Abstand', center: scale(add(p1, p2), 0.5), normal: d > 0 ? unit(delta) : [0, 0, 1],
    distance: d, delta, p1, p2, rule, rms: 0, form: 0, maxPos: 0, maxNeg: 0, n: 0,
  };
}

export function measuredValue(c: Control, feats: Map<number, Feature>, ctx: EvalCtx = {}): number | null {
  const f = feats.get(c.featureIds[0])?.measured;
  if (!f) return null;
  if (isDatumControl(c.kind)) return evalDatumControl(c, feats, ctx).value;
  const fr = ctx.frame;
  const C = fr ? toLocal(fr, f.center) : f.center, N = fr ? dirLocal(fr, f.normal) : f.normal, D = f.delta ? (fr ? dirLocal(fr, f.delta) : f.delta) : null;
  switch (c.kind) {
    case 'Durchmesser': return f.diameter ?? null;
    case 'Radius': return f.radius ?? null;
    case 'X': return C[0];
    case 'Y': return C[1];
    case 'Z': return C[2];
    case 'Länge': return f.length ?? null;
    case 'Breite': return f.width ?? null;
    case 'Kegelwinkel': return f.halfAngle != null ? 2 * f.halfAngle * DEG : null;
    case 'Form': return f.form;
    case 'Std.-Abw.': return f.rms;
    case 'Winkel X': return axisAngle(N, 0);
    case 'Winkel Y': return axisAngle(N, 1);
    case 'Winkel Z': return axisAngle(N, 2);
    case 'Rohrdurchmesser': return f.minorRadius != null ? 2 * f.minorRadius : null;
    case 'Rohrradius': return f.minorRadius ?? null;
    case 'Abstand 3D': return f.distance ?? null;
    case 'Abstand X': return D ? Math.abs(D[0]) : null;
    case 'Abstand Y': return D ? Math.abs(D[1]) : null;
    case 'Abstand Z': return D ? Math.abs(D[2]) : null;
    case 'Winkelwert': return f.angle ?? null;
    case 'Teilung': return f.pattern ? f.pattern.pitchDev : null;
    case 'Geradheit Achse': { // derived median line, minimum zone (floating + tilted Ø zone)
      const P = ctx.points?.(c.featureIds[0]); if (!P || P.length < 64) return null;
      const ML = medianLine(f, P); return ML.length >= 2 ? straightnessMZ(ML, f.normal).dia : null; }
  }
}

export function evaluate(c: Control, feats: Map<number, Feature>, ctx: EvalCtx = {}): ControlResult {
  if (isDatumControl(c.kind)) {
    const r = evalDatumControl(c, feats, ctx);
    if (r.value == null) return { measured: null, deviation: null, status: '—', flag: r.flag, detail: r.detail };
    const ok = r.value <= c.tolUp + (r.bonus ?? 0) + 1e-12;
    return { measured: r.value, deviation: r.value, status: ok ? 'IO' : 'NIO', detail: r.detail, bonus: r.bonus, flag: r.flag, members: r.members, worst: r.worst };
  }
  const m = measuredValue(c, feats, ctx);
  if (m == null) return { measured: null, deviation: null, status: '—' };
  if (isZoneControl(c.kind)) { const ok = m <= c.tolUp + 1e-12; return { measured: m, deviation: m, status: ok ? 'IO' : 'NIO' }; }
  if (c.nominal == null) return { measured: m, deviation: null, status: '—' };
  const dev = m - c.nominal;
  const ok = dev <= c.tolUp + 1e-12 && dev >= c.tolLo - 1e-12;
  return { measured: m, deviation: dev, status: ok ? 'IO' : 'NIO' };
}

/** Form-/Lage-Prüfmerkmale (Toleranzzone 0..t, nur ein Toleranzwert) – im Gegensatz zu Maßen mit Soll + oberem/unterem Abmaß. */
export const isZoneControl = (k: ControlKind) => k === 'Teilung' || k === 'Form' || k === 'Geradheit Achse' || k === 'Std.-Abw.' || isDatumControl(k);
export function defaultTolerance(kind: ControlKind): { nominal: number | null; up: number; lo: number } {
  if (kind === 'Position' || kind === 'Profil (Bezug)') return { nominal: 0, up: 0.1, lo: 0 };
  if (isDatumControl(kind)) return { nominal: 0, up: 0.05, lo: 0 };
  if (kind === 'Form' || kind === 'Std.-Abw.' || kind === 'Geradheit Achse') return { nominal: 0, up: 0.05, lo: 0 };
  if (kind === 'Teilung') return { nominal: 0, up: 0.1, lo: 0 };
  if (kind.startsWith('Winkel')) return { nominal: null, up: 0.5, lo: -0.5 };
  if (kind === 'Kegelwinkel') return { nominal: null, up: 0.5, lo: -0.5 };
  return { nominal: null, up: 0.1, lo: -0.1 };
}

const fmt = (v: number | null | undefined, d = 4) => (v == null ? '' : v.toFixed(d));

/** CSV (Semikolon, deutsches Dezimalkomma) für Excel. */
export function controlsCSV(controls: Control[], feats: Map<number, Feature>, ctx: EvalCtx = {}): string {
  const head = ['Feature', 'Control', 'Datum', 'Nominal', 'Actual', 'Deviation', 'Tol +', 'Tol -', 'Status'];
  const rows = controls.map((c) => {
    const r = evaluate(c, feats, ctx), f = feats.get(c.featureIds[0]);
    return [f?.name ?? '?', controlLabel(c, f), datumText(c, feats), fmt(c.nominal), fmt(r.measured), fmt(r.deviation),
      fmt(c.tolUp), isZoneControl(c.kind) ? '' : fmt(c.tolLo), r.flag ? r.flag : r.status === 'IO' ? 'OK' : r.status === 'NIO' ? 'NOK' : r.status].map((s) => String(s).replace('.', ',').replace(/;/g, ','));
  });
  return '\ufeff' + [head, ...rows].map((r) => r.join(';')).join('\r\n') + '\r\n';
}

export function featureCSV(feats: Feature[], ctx: EvalCtx = {}): string {
  const head = ['Name', 'Type', 'Datum', 'X', 'Y', 'Z', 'I', 'J', 'K', 'Diameter', 'Length', 'Width', 'Cone angle', 'Tube Ø', 'Distance 3D', 'Form', 'RMS', 'Points'];
  const rows = feats.map((f) => {
    const m = f.measured!;
    const fr = ctx.frame, C = fr ? toLocal(fr, m.center) : m.center, N = fr ? dirLocal(fr, m.normal) : m.normal;
    return [f.name, f.type, f.datum ?? '', ...C.map((v) => fmt(v)), ...N.map((v) => fmt(v, 6)), fmt(m.diameter),
      fmt(m.length), fmt(m.width), fmt(m.halfAngle != null ? 2 * m.halfAngle * DEG : null), fmt(m.minorRadius != null ? 2 * m.minorRadius : null), fmt(m.distance), fmt(m.form), fmt(m.rms), String(f.pointCount)]
      .map((s) => String(s).replace('.', ','));
  });
  return '\ufeff' + [head, ...rows].map((r) => r.join(';')).join('\r\n') + '\r\n';
}
