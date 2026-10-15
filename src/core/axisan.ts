// Axis-based analysis of cylinders (and cones): instead of surface points, the AXIS is analysed against a
// nominal axis (from the datum of an orientation/position control, else the fitted axis itself).
// Section centres: the wall points are cut into slices along the axis; each slice gets a LSQ circle centre in the
// plane ⟂ nominal direction (an approximation of the derived median line, ISO 1101 / ISO 12180 – the exact derived
// median line is planned later).
import { FitResult, fitCircle2D } from './fit';
import { Vec3, add, basis, cross, dot, norm, scale, sub, unit } from './linalg';

export interface AxisAnalysis {
  dir: Vec3; origin: Vec3;              // nominal axis (direction, point on it at the feature centre)
  actualDir: Vec3; actualTop: Vec3; actualBot: Vec3; // fitted axis segment
  centers: Vec3[]; devs: number[];      // section centres and their distance from the nominal axis
  tiltDeg: number;                      // angle actual ↔ nominal
  zone: number;                         // required zone diameter = 2·max distance (axis endpoints and section centres)
  tol: number | null;                   // tolerance t (diameter zone) of the control, if any
  label: string; length: number; radius: number;
}
const orth = (v: Vec3, d: Vec3): Vec3 => sub(v, scale(d, dot(v, d)));

export function analyzeAxis(fit: FitResult, pts: Vec3[], nominal?: { dir: Vec3; point?: Vec3 }, tol: number | null = null, sections = 8, label = ''): AxisAnalysis {
  const a = unit(fit.normal); let d = nominal ? unit(nominal.dir) : a; if (dot(d, a) < 0) d = scale(d, -1);
  const o = nominal?.point ?? fit.center;
  const L = fit.length || 2 * (fit.radius ?? 1);
  // fitted axis endpoints (centre ± L/2 along the actual axis)
  const top = add(fit.center, scale(a, L / 2)), bot = add(fit.center, scale(a, -L / 2));
  // slices along the nominal direction
  const [u, v] = basis(d); const ts = pts.map((p) => dot(sub(p, o), d)); let t0 = Infinity, t1 = -Infinity; for (const t of ts) { if (t < t0) t0 = t; if (t > t1) t1 = t; }
  const bins: [number, number][][] = Array.from({ length: sections }, () => []), tb: number[][] = Array.from({ length: sections }, () => []);
  ts.forEach((t, i) => { const k = Math.min(sections - 1, Math.max(0, Math.floor(((t - t0) / Math.max(1e-9, t1 - t0)) * sections))); const q = sub(pts[i], o); bins[k].push([dot(q, u), dot(q, v)]); tb[k].push(t); });
  const centers: Vec3[] = [], devs: number[] = [];
  bins.forEach((b, k) => { if (b.length < 8) return; try { const c = fitCircle2D(b); const tm = tb[k].reduce((s, x) => s + x, 0) / tb[k].length;
    const C = add(o, add(scale(d, tm), add(scale(u, c.cx), scale(v, c.cy)))); centers.push(C); devs.push(norm(orth(sub(C, o), d))); } catch { /* skip slice */ } });
  let mx = 0; for (const e of [top, bot]) mx = Math.max(mx, norm(orth(sub(e, o), d))); for (const x of devs) mx = Math.max(mx, x);
  const tilt = Math.acos(Math.min(1, Math.abs(dot(a, d)))) * 180 / Math.PI;
  void cross;
  return { dir: d, origin: o, actualDir: a, actualTop: top, actualBot: bot, centers, devs, tiltDeg: tilt, zone: 2 * mx, tol, label, length: L, radius: fit.radius ?? 1 };
}
/** Exaggerated display position: foot on the nominal axis + exag × radial offset. */
export function exaggerate(an: AxisAnalysis, p: Vec3, exag: number): Vec3 {
  const q = sub(p, an.origin), along = dot(q, an.dir), r = orth(q, an.dir);
  return add(an.origin, add(scale(an.dir, along), scale(r, exag)));
}
