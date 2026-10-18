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
import { lsqLine, medianLine, minCircle, orientNominal, orientZone, straightnessMZ } from './median';
export { medianLine, minCircle };
import type { Feature } from './features';

export interface AxisAnalysis {
  /** nominal location (TED) missing: no zone value / verdict shown */
  missing?: boolean;
  /** orientation zone between two parallel planes (normal) instead of a cylinder Ø */
  planeN?: Vec3;
  dir: Vec3; origin: Vec3;              // nominal axis (direction, point on it)
  actualDir: Vec3; actualTop: Vec3; actualBot: Vec3; // fitted axis segment
  centers: Vec3[]; devs: number[];      // derived median line points and their distance from the nominal axis
  tiltDeg: number;                      // angle actual ↔ nominal
  zone: number;                         // required Ø zone (see mode)
  straightness: number;                 // Ø zone of the median line straightness – minimum zone (floating + tilted)
  straightnessLSQ: number;              // same, zone direction fixed to the LSQ line (for comparison)
  mlPoint: Vec3; mlDir: Vec3;           // LSQ line through the median line (its own axis)
  offset: Vec3; offsetLen: number;      // location offset of the median line (centroid) from the nominal axis, ⟂ nominal (position mode)
  mode: 'position' | 'orientation' | 'fit';
  tol: number | null;
  label: string; length: number; radius: number;
}
const orth = (v: Vec3, d: Vec3): Vec3 => sub(v, scale(d, dot(v, d)));

export const floatingZone = (C: Vec3[], d: Vec3) => { const [u, v] = basis(d); return 2 * minCircle(C.map((c) => [dot(c, u), dot(c, v)] as [number, number])).r; };

export function analyzeAxis(fit: FitResult, pts: Vec3[], nominal?: { dir: Vec3; point?: Vec3; planeN?: Vec3 }, tol: number | null = null, sections = 0, label = ''): AxisAnalysis {
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
  const zone = centers.length ? (mode === 'position' ? 2 * Math.max(...devs) : nominal?.planeN ? orientZone(centers, nominal) : floatingZone(centers, d)) : 0;
  const st = straightnessMZ(centers, a), ml = centers.length >= 2 ? lsqLine(centers, a) : { p: fit.center, d: a };
  const off = mode === 'position' ? orth(sub(ml.p, o), d) : [0, 0, 0] as Vec3;
  const tilt = Math.acos(Math.min(1, Math.abs(dot(a, d)))) * 180 / Math.PI;
  return { dir: d, origin: o, actualDir: a, actualTop: top, actualBot: bot, centers, devs, tiltDeg: tilt, zone, straightness: st.dia, straightnessLSQ: st.diaLSQ, mlPoint: ml.p, mlDir: ml.d, offset: off, offsetLen: norm(off), mode, tol, label, planeN: nominal?.planeN, length: L, radius: fit.radius ?? 1 };
}
/**
 * Display position of a median-line point: the line stays at its REAL location. Only its deviation from its own
 * LSQ axis (bend/form) is scaled by `formEx`; `locEx` > 1 additionally scales the location offset from the nominal
 * axis (shown with a label, 1 = true location).
 */
export function displayPoint(an: AxisAnalysis, p: Vec3, formEx: number, locEx = 1): Vec3 {
  const foot = add(an.mlPoint, scale(an.mlDir, dot(sub(p, an.mlPoint), an.mlDir)));
  const disp = add(foot, scale(sub(p, foot), formEx));
  return locEx === 1 ? disp : add(disp, scale(orth(sub(foot, an.origin), an.dir), locEx - 1));
}
/** Display position of a point on the nominal axis/zone: real, or with the location exaggeration around the nominal axis. */
export const nominalFoot = (an: AxisAnalysis, p: Vec3): Vec3 => add(an.origin, scale(an.dir, dot(sub(p, an.origin), an.dir)));
/** Nominal axis for a control: Position → through the basic dimensions in the full DRF (A|B|C), direction = the
 *  DRF axis closest to the actual axis; orientation → direction only (zone floats); coaxiality → datum axis. */
export function axisNominal(kind: string, DS: Feature[], basic: Vec3 | undefined, a: Vec3): { dir: Vec3; point?: Vec3; planeN?: Vec3 } | undefined {
  const D = DS[0]?.measured; if (!D) return undefined;
  const g = D.normal;
  if (kind === 'Position') {
    const F = buildDRF(DS), al = [F.x, F.y, F.z], k = [0, 1, 2].reduce((q, i) => (Math.abs(dot(a, al[i])) > Math.abs(dot(a, al[q])) ? i : q), 0);
    const b = basic ?? [0, 0, 0];
    return { dir: al[k], point: add(F.o, add(scale(F.x, b[0]), add(scale(F.y, b[1]), scale(F.z, b[2])))) };
  }
  if (kind === 'Koaxialität') return { dir: g, point: D.center };
  return orientNominal(kind, D.type === 'Ebene', g, a, kind === 'Neigung' ? (basic?.[0] ?? 0) : 0);
}
