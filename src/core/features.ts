// Merkmale (Features) und Prüfmerkmale (Controls). Erweiterbar um Soll-Komponente (CAD).
import { FitResult, GeomType } from './fit';
import { Vec3, sub } from './linalg';

export interface Feature {
  id: number;
  name: string;
  type: GeomType;
  measured?: FitResult;      // Ist-Komponente
  nominal?: FitResult;       // Soll-Komponente (spätere CAD-Erweiterung)
  pointCount: number;
  method: 'Klick' | 'Pinsel';
}

export type ControlKind =
  | 'Durchmesser' | 'Radius' | 'X' | 'Y' | 'Z' | 'Länge' | 'Breite' | 'Kegelwinkel'
  | 'Form' | 'Abstand X' | 'Abstand Y' | 'Abstand Z' | 'Abstand 3D';

export interface Control {
  id: number;
  kind: ControlKind;
  featureIds: number[];       // 1 Merkmal oder 2 bei Abstand
  nominal: number | null;     // Sollwert (von Hand)
  tolUp: number;
  tolLo: number;              // negativ, z. B. -0.1
}

export interface ControlResult {
  measured: number | null;
  deviation: number | null;
  status: 'IO' | 'NIO' | '—';
}

export const FORM_NAME: Record<GeomType, string> = {
  Ebene: 'Ebenheit', Kreis: 'Rundheit', Zylinder: 'Zylindrizität', Langloch: 'Profilform',
  Kegel: 'Kegelform', Kugel: 'Kugelform', Punkt: 'Form',
};

export function controlLabel(c: Control, f?: Feature): string {
  if (c.kind === 'Form' && f) return FORM_NAME[f.type];
  return c.kind;
}

/** Welche Prüfmerkmale sind für einen Merkmalstyp verfügbar? */
export function availableControls(t: GeomType): ControlKind[] {
  const pos: ControlKind[] = ['X', 'Y', 'Z'];
  switch (t) {
    case 'Ebene': return ['Form', ...pos];
    case 'Kreis': case 'Zylinder': case 'Kugel': return ['Durchmesser', 'Radius', ...pos, 'Form'];
    case 'Langloch': return ['Länge', 'Breite', ...pos, 'Form'];
    case 'Kegel': return ['Kegelwinkel', 'Durchmesser', ...pos, 'Form'];
    case 'Punkt': return pos;
  }
}

export function defaultControls(t: GeomType): ControlKind[] {
  switch (t) {
    case 'Ebene': return ['Form'];
    case 'Kreis': case 'Zylinder': return ['Durchmesser', 'X', 'Y'];
    case 'Kugel': return ['Durchmesser', 'X', 'Y', 'Z'];
    case 'Langloch': return ['Länge', 'Breite', 'X', 'Y'];
    case 'Kegel': return ['Kegelwinkel', 'X', 'Y'];
    case 'Punkt': return ['X', 'Y', 'Z'];
  }
}

export const DEG = 180 / Math.PI;

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
    default: {
      const g = feats.get(c.featureIds[1])?.measured;
      if (!g) return null;
      const d: Vec3 = sub(g.center, f.center);
      if (c.kind === 'Abstand X') return Math.abs(d[0]);
      if (c.kind === 'Abstand Y') return Math.abs(d[1]);
      if (c.kind === 'Abstand Z') return Math.abs(d[2]);
      return Math.hypot(d[0], d[1], d[2]);
    }
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
  if (kind === 'Form') return { nominal: 0, up: 0.05, lo: 0 };
  if (kind === 'Kegelwinkel') return { nominal: null, up: 0.5, lo: -0.5 };
  return { nominal: null, up: 0.1, lo: -0.1 };
}

const fmt = (v: number | null, d = 4) => (v == null ? '' : v.toFixed(d));

/** CSV (Semikolon, deutsches Dezimalkomma) für Excel. */
export function controlsCSV(controls: Control[], feats: Map<number, Feature>): string {
  const head = ['Merkmal', 'Prüfmerkmal', 'Soll', 'Ist', 'Abweichung', 'Tol +', 'Tol -', 'Status'];
  const rows = controls.map((c) => {
    const r = evaluate(c, feats);
    const names = c.featureIds.map((id) => feats.get(id)?.name ?? '?').join(' → ');
    return [names, controlLabel(c, feats.get(c.featureIds[0])), fmt(c.nominal), fmt(r.measured), fmt(r.deviation),
      fmt(c.tolUp), fmt(c.tolLo), r.status].map((s) => String(s).replace('.', ',').replace(/;/g, ','));
  });
  return '\ufeff' + [head, ...rows].map((r) => r.join(';')).join('\r\n') + '\r\n';
}

export function featureCSV(feats: Feature[]): string {
  const head = ['Name', 'Typ', 'X', 'Y', 'Z', 'I', 'J', 'K', 'Durchmesser', 'Länge', 'Breite', 'Kegelwinkel', 'Form', 'RMS', 'Punkte'];
  const rows = feats.map((f) => {
    const m = f.measured!;
    return [f.name, f.type, ...m.center.map((v) => fmt(v)), ...m.normal.map((v) => fmt(v, 6)), fmt(m.diameter ?? null),
      fmt(m.length ?? null), fmt(m.width ?? null), fmt(m.halfAngle != null ? 2 * m.halfAngle * DEG : null), fmt(m.form), fmt(m.rms), String(f.pointCount)]
      .map((s) => String(s).replace('.', ','));
  });
  return '\ufeff' + [head, ...rows].map((r) => r.join(';')).join('\r\n') + '\r\n';
}
