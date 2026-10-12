// Merkmale (Features) und Prüfmerkmale (Controls). Erweiterbar um Soll-Komponente (CAD).
import { FitResult, GeomType } from './fit';
import { Vec3, add, dot, norm, scale, sub, unit } from './linalg';

export interface Feature {
  id: number;
  name: string;
  type: GeomType;
  measured?: FitResult;      // Ist-Komponente
  nominal?: FitResult;       // Soll-Komponente (spätere CAD-Erweiterung)
  pointCount: number;
  method: 'Klick' | 'Pinsel' | 'Konstruiert';
  refs?: number[];           // Abstand: IDs der beiden Bezugsmerkmale
  aux?: AuxPlane;            // Hilfsebene (Projektionsebene) für Kreis/Langloch
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
  | 'Abstand 3D' | 'Abstand X' | 'Abstand Y' | 'Abstand Z';

export interface Control {
  id: number;
  kind: ControlKind;
  featureIds: number[];       // ein Merkmal (Abstände sind eigene Merkmale)
  nominal: number | null;     // Sollwert (von Hand)
  tolUp: number;
  tolLo: number;              // negativ, z. B. -0.1
}

export interface ControlResult { measured: number | null; deviation: number | null; status: 'IO' | 'NIO' | '—'; }

export const FORM_NAME: Record<GeomType, string> = {
  Ebene: 'Ebenheit', Kreis: 'Rundheit', Zylinder: 'Zylindrizität', Langloch: 'Profil',
  Kegel: 'Kegelform', Kugel: 'Kugelform', Punkt: 'Form', Abstand: 'Form',
};

/** ISO-1101-Symbol der Formtoleranz je Merkmalstyp. */
export const FORM_SYMBOL: Record<GeomType, string> = {
  Ebene: '⏥', Kreis: '○', Zylinder: '⌭', Langloch: '⌒', Kegel: '⌓', Kugel: '⌓', Punkt: '', Abstand: '',
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
    { kind: 'Std.-Abw.', label: 'Standardabweichung', symbol: 'σ', note: 'RMS der Abstände zum Ausgleichselement' }] });
  const pos: CatalogGroup = { group: 'Ort (Koordinaten)', items: (['X', 'Y', 'Z'] as const).map((k) => ({ kind: k, label: `Position ${k}`, symbol: '⌖' })) };
  const dir = (what: string): CatalogGroup => ({ group: 'Richtung', items: (['X', 'Y', 'Z'] as const).map((k) => ({ kind: `Winkel ${k}` as ControlKind, label: `Winkel ${what} zur ${k}-Achse`, symbol: '∠' })) });
  const dia: CatalogItem[] = [{ kind: 'Durchmesser', label: 'Durchmesser', symbol: '⌀' }, { kind: 'Radius', label: 'Radius', symbol: 'R' }];
  switch (t) {
    case 'Ebene': return [form('zwei parallele Ebenen'), pos, dir('Normale')];
    case 'Kreis': return [form('zwei konzentrische Kreise'), { group: 'Maß', items: dia }, pos, dir('Normale')];
    case 'Zylinder': return [form('zwei koaxiale Zylinder'), { group: 'Maß', items: dia }, pos, dir('Achse')];
    case 'Kugel': return [form('Flächenprofil (zwei Kugelschalen)'), { group: 'Maß', items: dia }, pos];
    case 'Kegel': return [form('Flächenprofil'), { group: 'Maß', items: [{ kind: 'Kegelwinkel', label: 'Kegelwinkel', symbol: '∢' }, ...dia] }, pos, dir('Achse')];
    case 'Langloch': return [form('Linienprofil der Kontur'), { group: 'Maß', items: [{ kind: 'Länge', label: 'Länge', symbol: '↔' }, { kind: 'Breite', label: 'Breite', symbol: '↕' }] }, pos, dir('Normale')];
    case 'Punkt': return [pos];
    case 'Abstand': return [{ group: 'Abstand', items: (['3D', 'X', 'Y', 'Z'] as const).map((k) => ({ kind: `Abstand ${k}` as ControlKind, label: `Abstand ${k}`, symbol: '↔' })) }];
  }
}

export function controlLabel(c: Control, f?: Feature): string {
  if (c.kind === 'Form' && f) return FORM_NAME[f.type];
  if (c.kind === 'X' || c.kind === 'Y' || c.kind === 'Z') return 'Position ' + c.kind;
  if (c.kind.startsWith('Winkel ')) return `Winkel zur ${c.kind.slice(7)}-Achse`;
  return c.kind;
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
  if (a.type === 'Ebene' && b.type === 'Ebene') { p2 = b.center; p1 = proj(a, b.center); rule = 'Punkt (B) – Ebene (A)'; }
  else if (a.type === 'Ebene') { p2 = b.center; p1 = proj(a, b.center); rule = 'Punkt (B) – Ebene (A)'; }
  else if (b.type === 'Ebene') { p1 = a.center; p2 = proj(b, a.center); rule = 'Punkt (A) – Ebene (B)'; }
  else { p1 = a.center; p2 = b.center; rule = 'Mittelpunkt – Mittelpunkt'; }
  const delta = sub(p2, p1), d = norm(delta);
  return {
    type: 'Abstand', center: scale(add(p1, p2), 0.5), normal: d > 0 ? unit(delta) : [0, 0, 1],
    distance: d, delta, p1, p2, rule, rms: 0, form: 0, maxPos: 0, maxNeg: 0, n: 0,
  };
}

export function measuredValue(c: Control, feats: Map<number, Feature>): number | null {
  const f = feats.get(c.featureIds[0])?.measured;
  if (!f) return null;
  switch (c.kind) {
    case 'Durchmesser': return f.diameter ?? null;
    case 'Radius': return f.radius ?? null;
    case 'X': return f.center[0];
    case 'Y': return f.center[1];
    case 'Z': return f.center[2];
    case 'Länge': return f.length ?? null;
    case 'Breite': return f.width ?? null;
    case 'Kegelwinkel': return f.halfAngle != null ? 2 * f.halfAngle * DEG : null;
    case 'Form': return f.form;
    case 'Std.-Abw.': return f.rms;
    case 'Winkel X': return axisAngle(f.normal, 0);
    case 'Winkel Y': return axisAngle(f.normal, 1);
    case 'Winkel Z': return axisAngle(f.normal, 2);
    case 'Abstand 3D': return f.distance ?? null;
    case 'Abstand X': return f.delta ? Math.abs(f.delta[0]) : null;
    case 'Abstand Y': return f.delta ? Math.abs(f.delta[1]) : null;
    case 'Abstand Z': return f.delta ? Math.abs(f.delta[2]) : null;
  }
}

export function evaluate(c: Control, feats: Map<number, Feature>): ControlResult {
  const m = measuredValue(c, feats);
  if (m == null) return { measured: null, deviation: null, status: '—' };
  if (c.nominal == null) return { measured: m, deviation: null, status: '—' };
  const dev = m - c.nominal;
  const ok = dev <= c.tolUp + 1e-12 && dev >= c.tolLo - 1e-12;
  return { measured: m, deviation: dev, status: ok ? 'IO' : 'NIO' };
}

export function defaultTolerance(kind: ControlKind): { nominal: number | null; up: number; lo: number } {
  if (kind === 'Form' || kind === 'Std.-Abw.') return { nominal: 0, up: 0.05, lo: 0 };
  if (kind.startsWith('Winkel')) return { nominal: null, up: 0.5, lo: -0.5 };
  if (kind === 'Kegelwinkel') return { nominal: null, up: 0.5, lo: -0.5 };
  return { nominal: null, up: 0.1, lo: -0.1 };
}

const fmt = (v: number | null | undefined, d = 4) => (v == null ? '' : v.toFixed(d));

/** CSV (Semikolon, deutsches Dezimalkomma) für Excel. */
export function controlsCSV(controls: Control[], feats: Map<number, Feature>): string {
  const head = ['Merkmal', 'Prüfmerkmal', 'Soll', 'Ist', 'Abweichung', 'Tol +', 'Tol -', 'Status'];
  const rows = controls.map((c) => {
    const r = evaluate(c, feats), f = feats.get(c.featureIds[0]);
    return [f?.name ?? '?', controlLabel(c, f), fmt(c.nominal), fmt(r.measured), fmt(r.deviation),
      fmt(c.tolUp), fmt(c.tolLo), r.status].map((s) => String(s).replace('.', ',').replace(/;/g, ','));
  });
  return '\ufeff' + [head, ...rows].map((r) => r.join(';')).join('\r\n') + '\r\n';
}

export function featureCSV(feats: Feature[]): string {
  const head = ['Name', 'Typ', 'X', 'Y', 'Z', 'I', 'J', 'K', 'Durchmesser', 'Länge', 'Breite', 'Kegelwinkel', 'Abstand 3D', 'Form', 'RMS', 'Punkte'];
  const rows = feats.map((f) => {
    const m = f.measured!;
    return [f.name, f.type, ...m.center.map((v) => fmt(v)), ...m.normal.map((v) => fmt(v, 6)), fmt(m.diameter),
      fmt(m.length), fmt(m.width), fmt(m.halfAngle != null ? 2 * m.halfAngle * DEG : null), fmt(m.distance), fmt(m.form), fmt(m.rms), String(f.pointCount)]
      .map((s) => String(s).replace('.', ','));
  });
  return '\ufeff' + [head, ...rows].map((r) => r.join(';')).join('\r\n') + '\r\n';
}
