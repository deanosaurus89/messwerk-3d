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

/** Smallest enclosing circle (Welzl, iterative), returns centre and radius. */
export function minCircle(P: [number, number][]): { x: number; y: number; r: number } {
  const p = P.slice(); for (let i = p.length - 1; i > 0; i--) { const j = (i * 7919 + 13) % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  const inC = (c: { x: number; y: number; r: number }, q: [number, number]) => Math.hypot(q[0] - c.x, q[1] - c.y) <= c.r * (1 + 1e-12) + 1e-12;
  const two = (a: [number, number], b: [number, number]) => ({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, r: Math.hypot(a[0] - b[0], a[1] - b[1]) / 2 });
  const three = (a: [number, number], b: [number, number], c: [number, number]) => {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])); if (Math.abs(d) < 1e-18) { const cs = [two(a, b), two(a, c), two(b, c)]; return cs.reduce((m, x) => (x.r > m.r ? x : m)); }
    const A = a[0] ** 2 + a[1] ** 2, B = b[0] ** 2 + b[1] ** 2, C = c[0] ** 2 + c[1] ** 2;
    const x = (A * (b[1] - c[1]) + B * (c[1] - a[1]) + C * (a[1] - b[1])) / d, y = (A * (c[0] - b[0]) + B * (a[0] - c[0]) + C * (b[0] - a[0])) / d;
    return { x, y, r: Math.hypot(a[0] - x, a[1] - y) }; };
  if (!p.length) return { x: 0, y: 0, r: 0 };
  let c = { x: p[0][0], y: p[0][1], r: 0 };
  for (let i = 1; i < p.length; i++) if (!inC(c, p[i])) { c = { x: p[i][0], y: p[i][1], r: 0 };
    for (let j = 0; j < i; j++) if (!inC(c, p[j])) { c = two(p[i], p[j]);
      for (let k = 0; k < j; k++) if (!inC(c, p[k])) c = three(p[i], p[j], p[k]); } }
  return c;
}
/** Derived median line: section centres in planes ⟂ the fitted axis. `sections` 0 = automatic (≈ 1 per 60 points, 8…40). */
export function medianLine(fit: FitResult, pts: Vec3[], sections = 0): Vec3[] {
  const a = unit(fit.normal), [u, v] = basis(a), o = fit.center;
  const n = sections > 0 ? sections : Math.max(8, Math.min(40, Math.floor(pts.length / 60)));
  const ts = pts.map((p) => dot(sub(p, o), a)); let t0 = Infinity, t1 = -Infinity; for (const t of ts) { if (t < t0) t0 = t; if (t > t1) t1 = t; }
  const bins: [number, number][][] = Array.from({ length: n }, () => []), tb: number[][] = Array.from({ length: n }, () => []);
  ts.forEach((t, i) => { const k = Math.min(n - 1, Math.max(0, Math.floor(((t - t0) / Math.max(1e-9, t1 - t0)) * n))); const q = sub(pts[i], o); bins[k].push([dot(q, u), dot(q, v)]); tb[k].push(t); });
  const out: Vec3[] = [];
  bins.forEach((b, k) => { if (b.length < 8) return; try { const c = fitCircle2D(b); const tm = tb[k].reduce((s, x) => s + x, 0) / tb[k].length;
    out.push(add(o, add(scale(a, tm), add(scale(u, c.cx), scale(v, c.cy))))); } catch { /* skip section */ } });
  return out;
}
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
