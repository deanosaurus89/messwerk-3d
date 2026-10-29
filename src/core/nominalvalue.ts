// Nominal column of a control: the value computed from the Soll (CAD / construction)
// geometry, overridable by hand, with a way back to that computed value.
import type { FitResult } from './fit';

const DEG = 180 / Math.PI;

/** Characteristic controls filled when a nominal geometry is created. */
export function nominalControlKinds(type: string): string[] {
  switch (type) {
    case 'Ebene': return ['X', 'Y', 'Z'];
    case 'Kugel': return ['Durchmesser', 'X', 'Y', 'Z'];
    case 'Zylinder': return ['Durchmesser', 'Länge', 'Winkel X', 'Winkel Y', 'Winkel Z'];
    case 'Kegel': return ['Durchmesser', 'Kegelwinkel', 'Länge'];
    case 'Kreis': return ['Durchmesser'];
    case 'Torus': return ['Durchmesser', 'Rohrdurchmesser'];
    case 'Linie': return ['Länge'];
    case 'Langloch': return ['Länge', 'Breite'];
    case 'Abstand': return ['Abstand 3D'];
    case 'Winkel': return ['Winkelwert'];
    default: return [];
  }
}

const axisAngle = (n: number[], k: number) => Math.acos(Math.min(1, Math.abs(n[k]) / (Math.hypot(n[0], n[1], n[2]) || 1))) * DEG;

/** Nominal number a control shows for an analytic or constructed fit. */
export function nominalOfFit(kind: string, fit: FitResult): number | null {
  const C = fit.center, N = fit.normal, D = fit.delta ?? null;
  switch (kind) {
    case 'Durchmesser': return fit.diameter ?? (fit.radius != null ? 2 * fit.radius : null);
    case 'Radius': return fit.radius ?? null;
    case 'X': return C[0];
    case 'Y': return C[1];
    case 'Z': return C[2];
    case 'Länge': return fit.length ?? null;
    case 'Breite': return fit.width ?? null;
    case 'Kegelwinkel': return fit.halfAngle != null ? 2 * fit.halfAngle * DEG : null;
    case 'Rohrdurchmesser': return fit.minorRadius != null ? 2 * fit.minorRadius : null;
    case 'Rohrradius': return fit.minorRadius ?? null;
    case 'Abstand 3D': return fit.distance ?? null;
    case 'Abstand X': return D ? Math.abs(D[0]) : null;
    case 'Abstand Y': return D ? Math.abs(D[1]) : null;
    case 'Abstand Z': return D ? Math.abs(D[2]) : null;
    case 'Winkelwert': return fit.angle ?? null;
    case 'Winkel X': return axisAngle(N, 0);
    case 'Winkel Y': return axisAngle(N, 1);
    case 'Winkel Z': return axisAngle(N, 2);
    default: return null;
  }
}

export interface NominalSlot {
  nominal: number | null;
  /** last value computed from the Soll geometry */
  nominalFrom?: number | null;
  /** user typed a different nominal */
  nominalEdited?: boolean;
}

const same = (a: number | null | undefined, b: number | null | undefined) =>
  a != null && b != null && Math.abs(a - b) <= 1e-6;

/** Write the computed Soll value. A hand edit is left alone. */
export function applyComputedNominal(c: NominalSlot, computed: number | null): void {
  c.nominalFrom = computed;
  if (!c.nominalEdited) c.nominal = computed;
}

/** Hand edit. Matching the computed value clears the modified flag. */
export function editNominal(c: NominalSlot, typed: number | null): void {
  c.nominal = typed;
  c.nominalEdited = !same(typed, c.nominalFrom ?? null) && (typed != null || c.nominalFrom != null);
  if (same(typed, c.nominalFrom ?? null)) c.nominalEdited = false;
}

export function resetNominal(c: NominalSlot): void {
  c.nominal = c.nominalFrom ?? null;
  c.nominalEdited = false;
}

export function nominalIsModified(c: NominalSlot): boolean {
  return !!c.nominalEdited && !same(c.nominal, c.nominalFrom ?? null);
}
