// Axis-based analysis of cylinders (and cones): the AXIS is analysed against a nominal axis (from the datum
// reference frame of an orientation/position control, else the fitted axis itself).
// Derived median line (ISO 12180-1 / ISO 1101): the wall is cut by planes ⟂ to the associated (LSQ) axis; each
// section gets an LSQ circle; the circle centres form the derived median line. Zone values are evaluated from
// these centres:
//  - position (nominal point given): Ø zone = 2·max distance of the centres from the nominal axis
//  - orientation (direction only): the zone may float sideways → Ø = diameter of the smallest circle enclosing the
//    centres projected along the nominal direction
//  - straightness of the median line: same as orientation, but with the fitted direction.
import { FitResult, fitCircle2D } from './fit';
import { Vec3, add, basis, dot, norm, scale, sub, unit } from './linalg';
import { buildDRF } from './datum';
import { medianLine, minCircle } from './median';
export { medianLine, minCircle };
import type { Feature } from './features';

export interface AxisAnalysis {
  dir: Vec3; origin: Vec3;              // nominal axis (direction, point on it)
  actualDir: Vec3; actualTop: Vec3; actualBot: Vec3; // fitted axis segment
  centers: Vec3[]; devs: number[];      // derived median line points and their distance from the nominal axis
  tiltDeg: number;                      // angle actual ↔ nominal
  zone: number;                         // required Ø zone (see mode)
  straightness: number;                 // Ø zone of the median line straightness (fitted direction, floating)
  mode: 'position' | 'orientation' | 'fit';
  tol: number | null;
  label: string; length: number; radius: number;
}
const orth = (v: Vec3, d: Vec3): Vec3 => sub(v, scale(d, dot(v, d)));

const floatingZone = (C: Vec3[], d: Vec3) => { const [u, v] = basis(d); return 2 * minCircle(C.map((c) => [dot(c, u), dot(c, v)] as [number, number])).r; };

export function analyzeAxis(fit: FitResult, pts: Vec3[], nominal?: { dir: Vec3; point?: Vec3 }, tol: number | null = null, sections = 0, label = ''): AxisAnalysis {
  const a = unit(fit.normal); let d = nominal ? unit(nominal.dir) : a; if (dot(d, a) < 0) d = scale(d, -1);
  const L = fit.length || 2 * (fit.radius ?? 1);
  const top = add(fit.center, scale(a, L / 2)), bot = add(fit.center, scale(a, -L / 2));
  const centers = medianLine(fit, pts, sections);
  const mode: AxisAnalysis['mode'] = nominal?.point ? 'position' : nominal ? 'orientation' : 'fit';
  // nominal axis point: given (position) or the centre of the floating zone (orientation / fit)
  let o = nominal?.point ?? fit.center;
  if (!nominal?.point && centers.length) { const [u, v] = basis(d), mc = minCircle(centers.map((c) => [dot(c, u), dot(c, v)] as [number, number]));
    const along = dot(fit.center, d); o = add(scale(d, along), add(scale(u, mc.x), scale(v, mc.y))); }
  const devs = centers.map((C) => norm(orth(sub(C, o), d)));
  const zone = centers.length ? (mode === 'position' ? 2 * Math.max(...devs) : floatingZone(centers, d)) : 0;
  const straightness = centers.length ? floatingZone(centers, a) : 0;
  const tilt = Math.acos(Math.min(1, Math.abs(dot(a, d)))) * 180 / Math.PI;
  return { dir: d, origin: o, actualDir: a, actualTop: top, actualBot: bot, centers, devs, tiltDeg: tilt, zone, straightness, mode, tol, label, length: L, radius: fit.radius ?? 1 };
}
/** Exaggerated display position: foot on the nominal axis + exag × radial offset. */
export function exaggerate(an: AxisAnalysis, p: Vec3, exag: number): Vec3 {
  const q = sub(p, an.origin), along = dot(q, an.dir), r = orth(q, an.dir);
  return add(an.origin, add(scale(an.dir, along), scale(r, exag)));
}
/** Nominal axis for a control: Position → through the basic dimensions in the full DRF (A|B|C), direction = the
 *  DRF axis closest to the actual axis; orientation → direction only (zone floats); coaxiality → datum axis. */
export function axisNominal(kind: string, DS: Feature[], basic: Vec3 | undefined, a: Vec3): { dir: Vec3; point?: Vec3 } | undefined {
  const D = DS[0]?.measured; if (!D) return undefined;
  const g = D.normal;
  if (kind === 'Position') {
    const F = buildDRF(DS), al = [F.x, F.y, F.z], k = [0, 1, 2].reduce((q, i) => (Math.abs(dot(a, al[i])) > Math.abs(dot(a, al[q])) ? i : q), 0);
    const b = basic ?? [0, 0, 0];
    return { dir: al[k], point: add(F.o, add(scale(F.x, b[0]), add(scale(F.y, b[1]), scale(F.z, b[2])))) };
  }
  if (D.type === 'Ebene') {
    if (kind === 'Parallelität') { const pr = sub(a, scale(g, dot(a, g))); return { dir: norm(pr) > 1e-9 ? pr : a }; }
    return { dir: g }; // perpendicularity / angularity to a plane: nominal ⟂ plane (floating)
  }
  return { dir: g, point: kind === 'Koaxialität' ? D.center : undefined };
}
