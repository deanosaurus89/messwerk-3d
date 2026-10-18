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

/** Least-squares line through points: centroid + principal direction (oriented like `hint`). */
export function lsqLine(P: Vec3[], hint: Vec3): { p: Vec3; d: Vec3 } {
  const n = P.length, c: Vec3 = [0, 0, 0]; for (const q of P) for (let k = 0; k < 3; k++) c[k] += q[k] / n;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const q of P) { const w = sub(q, c); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += w[i] * w[j]; }
  let d: Vec3 = unit(hint); for (let it = 0; it < 60; it++) { const nd: Vec3 = [0, 1, 2].map((i) => C[i][0] * d[0] + C[i][1] * d[1] + C[i][2] * d[2]) as Vec3; const l = Math.hypot(...nd); if (l < 1e-300) break; d = scale(nd, 1 / l); }
  if (dot(d, hint) < 0) d = scale(d, -1);
  return { p: c, d };
}
/** Floating cylindrical zone along direction d: diameter of the smallest circle enclosing the projected points. */
export function floatZone(P: Vec3[], d: Vec3): { dia: number; centre: Vec3 } {
  const [u, v] = basis(d), mc = minCircle(P.map((c) => [dot(c, u), dot(c, v)] as [number, number]));
  return { dia: 2 * mc.r, centre: add(scale(u, mc.x), scale(v, mc.y)) };
}
/**
 * Straightness of a derived median line, minimum zone (ISO 12780 / ISO 1101): the cylindrical zone may float AND
 * tilt. Minimises the floating-zone diameter over the zone direction (two tilt angles around the LSQ line direction,
 * Nelder–Mead). Returns the zone diameter and the optimal direction; never worse than the LSQ direction.
 */
export function straightnessMZ(P: Vec3[], hint: Vec3): { dia: number; dir: Vec3; diaLSQ: number } {
  if (P.length < 2) return { dia: 0, dir: unit(hint), diaLSQ: 0 };
  const L = lsqLine(P, hint), [u, v] = basis(L.d);
  let ext = 0; for (const q of P) ext = Math.max(ext, Math.abs(dot(sub(q, L.p), L.d)));
  const dirOf = (x: number[]) => unit(add(L.d, add(scale(u, x[0]), scale(v, x[1]))));
  const f = (x: number[]) => floatZone(P, dirOf(x)).dia;
  const diaLSQ = f([0, 0]);
  // simplex step ≈ angle that moves the line ends by the LSQ zone radius
  const s = Math.max(1e-9, diaLSQ / Math.max(1e-9, 2 * ext));
  let S = [[0, 0], [s, 0], [0, s]].map((x) => ({ x, v: f(x) }));
  for (let it = 0; it < 200; it++) {
    S.sort((a, b) => a.v - b.v); const [b, g, w] = S;
    if (Math.abs(w.v - b.v) <= 1e-12 * Math.max(1, b.v) && Math.hypot(w.x[0] - b.x[0], w.x[1] - b.x[1]) < s * 1e-6) break;
    const m = [(b.x[0] + g.x[0]) / 2, (b.x[1] + g.x[1]) / 2], at = (t: number) => [m[0] + t * (w.x[0] - m[0]), m[1] + t * (w.x[1] - m[1])];
    const r = at(-1), fr = f(r);
    if (fr < b.v) { const e = at(-2), fe = f(e); S[2] = fe < fr ? { x: e, v: fe } : { x: r, v: fr }; }
    else if (fr < g.v) S[2] = { x: r, v: fr };
    else { const c = at(fr < w.v ? -0.5 : 0.5), fc = f(c); if (fc < Math.min(fr, w.v)) S[2] = { x: c, v: fc }; else S = S.map((p, i) => (i === 0 ? p : { x: [(p.x[0] + b.x[0]) / 2, (p.x[1] + b.x[1]) / 2], v: f([(p.x[0] + b.x[0]) / 2, (p.x[1] + b.x[1]) / 2]) })); }
  }
  S.sort((a, b) => a.v - b.v);
  return S[0].v < diaLSQ ? { dia: S[0].v, dir: dirOf(S[0].x), diaLSQ } : { dia: diaLSQ, dir: L.d, diaLSQ };
}

/**
 * Nominal direction and zone type for an orientation control of a derived median line (ISO 1101):
 * - axis ⟂ plane, axis ∥ axis, angularity: cylindrical zone Ø around `dir` (floats);
 * - axis ∥ plane, axis ⟂ axis: zone between two parallel planes with normal `planeN` (= datum direction);
 *   `dir` is then the actual axis projected into those planes (for drawing).
 * `g` = datum direction (plane normal or axis), `a` = actual axis direction, `alphaDeg` = TED angle (angularity:
 * angle to the datum plane resp. datum axis).
 */
export function orientNominal(kind: string, datumIsPlane: boolean, g: Vec3, a: Vec3, alphaDeg = 0): { dir: Vec3; planeN?: Vec3 } {
  g = unit(g); a = unit(a); const sg = dot(a, g) < 0 ? -1 : 1;
  const pr = sub(a, scale(g, dot(a, g))), w = Math.hypot(...pr) > 1e-9 ? unit(pr) : basis(g)[0];
  if (kind === 'Neigung') { const th = ((datumIsPlane ? 90 - alphaDeg : alphaDeg) * Math.PI) / 180; return { dir: unit(add(scale(g, sg * Math.cos(th)), scale(w, Math.sin(th)))) }; }
  const planar = (kind === 'Parallelität') === datumIsPlane; // ∥ plane or ⟂ axis
  return planar ? { dir: w, planeN: g } : { dir: g };
}
/** Zone value of a median line for an orientation nominal: Ø of the floating cylinder, or width between planes. */
export function orientZone(ML: Vec3[], nom: { dir: Vec3; planeN?: Vec3 }): number {
  if (!ML.length) return 0;
  if (nom.planeN) { const t = ML.map((p) => dot(p, nom.planeN!)); return Math.max(...t) - Math.min(...t); }
  return floatZone(ML, nom.dir).dia;
}
