// Fit criteria beyond least squares (ISO 5459 / ISO 12181 terminology):
//   'lsq' Gauss (least squares) – the existing fits in fit.ts
//   'mz'  minimum zone (Chebyshev): the two concentric/parallel boundaries with the smallest separation
//   'mcc' tangential circumscribed (minimum circumscribed): smallest element that has all points inside
//   'mic' tangential inscribed (maximum inscribed): largest element that has all points outside
// For a plane, circumscribed/inscribed are the outer/inner tangent planes (minimum-zone orientation, shifted to the
// outermost/innermost point). The orientation/position parameters are optimized with Nelder–Mead on an active set of
// extremal points (verified against all points, violators added) starting from the least-squares fit; the size
// parameter (radius, tube radius, width, plane offset) follows in closed form from the extreme residual.
import { Vec3, add, basis, cross, dot, scale, sub, unit } from './linalg';
import { FitResult, signedDistance } from './fit';

export type FitCrit = 'lsq' | 'mz' | 'mcc' | 'mic';
export const FIT_CRITS: FitCrit[] = ['lsq', 'mz', 'mcc', 'mic'];
/** types that support the tangential (inscribed/circumscribed) criteria; minimum zone works for all except Punkt */
export const critSupported = (type: string, c: FitCrit): boolean => {
  if (c === 'lsq') return true;
  if (type === 'Punkt' || type === 'Linienzug' || type === 'Freiformfläche' || type === 'Abstand' || type === 'Winkel') return false;
  if (type === 'Linie') return c === 'mz';
  return true;
};

type Model = { dim: number; make: (x: number[]) => FitResult; steps: number[]; bound: (x: number[]) => number };

function model(F: FitResult, tight: boolean): Model | null {
  const n = unit(F.normal), [u, v] = basis(n), c = F.center, s0 = Math.max(F.form || 0, 4 * (F.rms || 0), 1e-3);
  const L = Math.max(F.radius ?? 0, (F.length ?? 0) / 2, F.width ?? 0, 1);
  const tilt = (ta: number, tb: number) => unit(add(n, add(scale(u, ta), scale(v, tb))));
  const shift = (du: number, dv: number) => add(c, add(scale(u, du), scale(v, dv)));
  const lim = (x: number[], pos: number[], ang: number[]) => { // penalty outside a sane box (maximum inscribed on partial arcs is unbounded)
    if (!tight) return 0; let p = 0; const R = 0.3 * L; for (const i of pos) p += Math.max(0, Math.abs(x[i]) - R); for (const i of ang) p += Math.max(0, Math.abs(x[i]) - 0.15) * L; return p * 1e3; };
  switch (F.type) {
    case 'Ebene': return { dim: 2, make: (x) => ({ ...F, normal: tilt(x[0], x[1]) }), steps: [s0 / L, s0 / L], bound: () => 0 };
    case 'Kugel': return { dim: 3, make: (x) => ({ ...F, center: add(c, [x[0], x[1], x[2]]) }), steps: [s0, s0, s0], bound: (x) => lim(x, [0, 1, 2], []) };
    case 'Kreis': return { dim: 2, make: (x) => ({ ...F, center: shift(x[0], x[1]) }), steps: [s0, s0], bound: (x) => lim(x, [0, 1], []) };
    case 'Zylinder': case 'Linie': return { dim: 4, make: (x) => ({ ...F, center: shift(x[0], x[1]), normal: tilt(x[2], x[3]), ...(F.type === 'Linie' && F.direction ? { direction: tilt(x[2], x[3]) } : {}) }), steps: [s0, s0, s0 / L, s0 / L], bound: (x) => lim(x, [0, 1], [2, 3]) };
    case 'Torus': return { dim: 5, make: (x) => ({ ...F, center: shift(x[0], x[1]), normal: tilt(x[2], x[3]), radius: (F.radius ?? 0) + x[4] }), steps: [s0, s0, s0 / L, s0 / L, s0], bound: (x) => lim(x, [0, 1, 4], [2, 3]) };
    case 'Kegel': {
      if (F.halfAngle == null || !F.apex) return null;
      const s = Math.sign(dot(sub(c, F.apex), n)) || 1, r0 = F.radius ?? Math.abs(dot(sub(c, F.apex), n)) * Math.tan(F.halfAngle);
      const cone = (cc: Vec3, a: Vec3, ha: number, r: number): FitResult => ({ ...F, center: cc, normal: a, halfAngle: ha, radius: r, apex: sub(cc, scale(a, s * (r / Math.tan(ha)))) });
      return { dim: 5, make: (x) => cone(shift(x[0], x[1]), tilt(x[2], x[3]), Math.min(1.5, Math.max(0.005, F.halfAngle! + x[4])), r0), steps: [s0, s0, s0 / L, s0 / L, s0 / L], bound: (x) => lim(x, [0, 1], [2, 3]) };
    }
    case 'Langloch': {
      const d0 = unit(F.direction ?? u), e0 = unit(cross(n, d0));
      return { dim: 4, make: (x) => ({ ...F, center: add(c, add(scale(d0, x[0]), scale(e0, x[1]))), direction: unit(add(scale(d0, Math.cos(x[2])), scale(e0, Math.sin(x[2])))), length: (F.length ?? 0) + 2 * x[3] }), steps: [s0, s0, s0 / L, s0], bound: (x) => lim(x, [0, 1], [2]) };
    }
    default: return null;
  }
}
/** apply a constant offset c to the residuals (size parameter) */
function offset(F: FitResult, c: number): FitResult {
  switch (F.type) {
    case 'Ebene': return { ...F, center: add(F.center, scale(unit(F.normal), c)) };
    case 'Kugel': case 'Kreis': case 'Zylinder': { const r = (F.radius ?? 0) + c; return { ...F, radius: r, diameter: 2 * r }; }
    case 'Torus': return { ...F, minorRadius: (F.minorRadius ?? 0) + c };
    case 'Kegel': { const ha = F.halfAngle!, n = unit(F.normal), s = Math.sign(dot(sub(F.center, F.apex!), n)) || 1, r = (F.radius ?? 0) + c / Math.cos(ha);
      return { ...F, radius: r, diameter: 2 * r, apex: sub(F.center, scale(n, s * (r / Math.tan(ha)))) }; }
    case 'Langloch': { const w = (F.width ?? 2 * (F.radius ?? 0)) + 2 * c; return { ...F, width: w, radius: w / 2, length: (F.length ?? 0) + 2 * c }; }
    default: return F;
  }
}

function nelderMead(f: (x: number[]) => number, x0: number[], steps: number[], maxIt: number): number[] {
  const n = x0.length; let S = [x0.slice()]; for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += steps[i]; S.push(x); }
  let V = S.map(f);
  for (let it = 0; it < maxIt; it++) {
    const o = V.map((_, i) => i).sort((a, b) => V[a] - V[b]); S = o.map((i) => S[i]); V = o.map((i) => V[i]);
    if (Math.abs(V[n] - V[0]) <= 1e-12 * (1 + Math.abs(V[0])) && it > 2 * n) break;
    const cen = new Array(n).fill(0); for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) cen[k] += S[i][k] / n;
    const at = (t: number) => cen.map((cv, k) => cv + t * (S[n][k] - cv));
    const xr = at(-1), fr = f(xr);
    if (fr < V[0]) { const xe = at(-2), fe = f(xe); if (fe < fr) { S[n] = xe; V[n] = fe; } else { S[n] = xr; V[n] = fr; } }
    else if (fr < V[n - 1]) { S[n] = xr; V[n] = fr; }
    else { const xc = fr < V[n] ? at(-0.5) : at(0.5), fc = f(xc);
      if (fc < Math.min(fr, V[n])) { S[n] = xc; V[n] = fc; }
      else { for (let i = 1; i <= n; i++) { S[i] = S[i].map((sv, k) => S[0][k] + 0.5 * (sv - S[0][k])); V[i] = f(S[i]); } } }
  }
  let b = 0; for (let i = 1; i <= n; i++) if (V[i] < V[b]) b = i; return S[b];
}

const range = (r: Float64Array) => { let mn = Infinity, mx = -Infinity; for (const x of r) { if (x < mn) mn = x; if (x > mx) mx = x; } return { mn, mx }; };
function resid(F: FitResult, P: Vec3[], idx?: number[]): Float64Array {
  const m = idx ? idx.length : P.length, r = new Float64Array(m);
  for (let i = 0; i < m; i++) r[i] = signedDistance(F, P[idx ? idx[i] : i]); return r;
}
function withStats(F: FitResult, P: Vec3[]): FitResult {
  const r = resid(F, P); let s = 0; for (const x of r) s += x * x; const { mn, mx } = range(r);
  return { ...F, rms: r.length ? Math.sqrt(s / r.length) : 0, form: mx - mn, maxPos: mx, maxNeg: mn, n: P.length };
}

/** Fit with criterion c, starting from the least-squares fit F of the points P. */
export function applyCrit(F: FitResult, P: Vec3[], c: FitCrit): FitResult {
  if (c === 'lsq' || !critSupported(F.type, c) || P.length < 3) return F;
  const plane = F.type === 'Ebene', line = F.type === 'Linie';
  const goal: FitCrit = plane || line ? 'mz' : c; // plane: tangent planes share the minimum-zone orientation
  const M = model(F, goal === 'mic'); if (!M) return F;
  const obj = (r: Float64Array) => { const { mn, mx } = range(r); return line ? mx : goal === 'mz' ? mx - mn : goal === 'mcc' ? mx : -mn; };
  // active set: extremal points of the LS residuals + a sparse sample; grown by violators until all points are inside
  const r0 = resid(F, P), ord = Array.from(r0.keys()).sort((a, b) => r0[a] - r0[b]);
  const k = Math.min(P.length, Math.max(60, Math.ceil(P.length * 0.03)));
  const act = new Set<number>([...ord.slice(0, k), ...ord.slice(-k)]); const stride = Math.max(1, Math.floor(P.length / 400)); for (let i = 0; i < P.length; i += stride) act.add(i);
  let x = new Array(M.dim).fill(0), steps = M.steps.slice();
  for (let round = 0; round < 8; round++) {
    const A = [...act]; const f = (y: number[]) => obj(resid(M.make(y), P, A)) + M.bound(y);
    for (let rs = 0; rs < 4; rs++) { x = nelderMead(f, x, steps, 150 * M.dim); steps = steps.map((s) => s * 0.3); }
    steps = M.steps.map((s) => s * 0.1);
    // verify on all points
    const G = M.make(x), ra = resid(G, P, A), { mn, mx } = range(ra), rr = resid(G, P); let added = 0;
    for (let i = 0; i < rr.length; i++) if ((rr[i] > mx + 1e-9 || (!line && rr[i] < mn - 1e-9)) && !act.has(i)) { act.add(i); added++; }
    if (!added) break;
  }
  const G = M.make(x), rr = resid(G, P), { mn, mx } = range(rr);
  const shift = line ? 0 : plane ? (c === 'mcc' ? mx : c === 'mic' ? mn : (mx + mn) / 2) : c === 'mz' ? (mx + mn) / 2 : c === 'mcc' ? mx : mn;
  const out = withStats(offset(G, shift), P);
  if (F.radius && out.radius != null && !(Math.abs(out.radius - F.radius) <= 0.5 * F.radius)) throw new Error('Fit criterion did not converge (partial arc?) – use Gauss');
  return { ...out, residuals: undefined };
}

/** form (roundness / flatness / cylindricity …) of the same points under every supported criterion */
export function formByCrit(F: FitResult, P: Vec3[]): Partial<Record<FitCrit, number>> {
  const o: Partial<Record<FitCrit, number>> = { lsq: withStats(F, P).form };
  for (const c of ['mz', 'mcc', 'mic'] as FitCrit[]) if (critSupported(F.type, c)) { try { o[c] = applyCrit(F, P, c).form; } catch { /* skip */ } }
  return o;
}
