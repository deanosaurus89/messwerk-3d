// Derived median line (ISO 12180-1 / ISO 1101) and smallest enclosing circle – shared by the axis analysis and
// the Position evaluation of the control table.
import { FitResult, fitCircle2D } from './fit';
import { Vec3, add, basis, dot, scale, sub, unit } from './linalg';

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
