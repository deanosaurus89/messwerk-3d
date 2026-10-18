// Datum feature simulation (ISO 5459:2011) – the datum is not the least-squares (Gauss) fit of the datum feature but the
// associated ideal feature in CONTACT with it, from outside the material:
//  - plane: tangent plane, minimax (Chebyshev) constrained outside the material → the outer plane of the minimum zone;
//  - cylinder / circle (hole): maximum inscribed cylinder / circle;  (shaft): minimum circumscribed cylinder / circle;
//  - secondary / tertiary datums are constrained in orientation to the previous ones (ISO 5459 §6.4):
//    a secondary plane nominally ⟂ the primary may only rotate about the primary direction, a tertiary plane ⟂ both
//    is fixed in orientation; a secondary axis nominally ∥ (or ⟂) the primary is kept exactly ∥ (⟂) to it.
// Cones, spheres, tori and points stay least squares (documented as a simplification).
import type { Feature } from './features';
import type { FitResult } from './fit';
import { Vec3, add, basis, cross, dot, norm, scale, sub, unit } from './linalg';
import { minCircle } from './median';

export type DatumAssoc = 'iso' | 'lsq';
export interface SimCtx { points?: (id: number) => Vec3[] | null; normals?: (id: number) => Vec3[] | null; datumAssoc?: DatumAssoc; /** ignore single spikes > 3σ before the contact association (default true) */ datumFilter?: boolean; }
export interface SimInfo { method: string; shift: number; tilt: number; }

/** Minimal Nelder–Mead (n-dim); returns best x and value. */
export function nelderMead(f: (x: number[]) => number, x0: number[], step: number[], iters = 300, tol = 1e-13): { x: number[]; v: number } {
  const n = x0.length; let S = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[i] : v)))].map((x) => ({ x, v: f(x) }));
  for (let it = 0; it < iters; it++) {
    S.sort((a, b) => a.v - b.v); const b = S[0], w = S[n];
    if (Math.abs(w.v - b.v) <= tol * Math.max(1, Math.abs(b.v)) && S.every((p) => p.x.every((v, i) => Math.abs(v - b.x[i]) <= Math.abs(step[i]) * 1e-7 + 1e-15))) break;
    const m = x0.map((_, i) => S.slice(0, n).reduce((s, p) => s + p.x[i], 0) / n), at = (t: number) => m.map((v, i) => v + t * (w.x[i] - v));
    const r = at(-1), fr = f(r);
    if (fr < b.v) { const e = at(-2), fe = f(e); S[n] = fe < fr ? { x: e, v: fe } : { x: r, v: fr }; }
    else if (fr < S[n - 1].v) S[n] = { x: r, v: fr };
    else { const c = at(fr < w.v ? -0.5 : 0.5), fc = f(c); if (fc < Math.min(fr, w.v)) S[n] = { x: c, v: fc }; else S = S.map((p, k) => { if (k === 0) return p; const x = p.x.map((v, i) => (v + b.x[i]) / 2); return { x, v: f(x) }; }); }
  }
  S.sort((a, b) => a.v - b.v); return S[0];
}

const proj2 = (P: Vec3[], d: Vec3): [number, number][] => { const [u, v] = basis(d); return P.map((q) => [dot(q, u), dot(q, v)]); };
/** Maximum inscribed circle of 2-D points (centre start c0): maximises the smallest distance (NM with restarts). */
export function maxInscribed(Q: [number, number][], c0: [number, number], r0: number): { x: number; y: number; r: number } {
  const f = (x: number[]) => { let m = Infinity; for (const q of Q) { const d = Math.hypot(q[0] - x[0], q[1] - x[1]); if (d < m) m = d; } return -m; };
  let best = nelderMead(f, [c0[0], c0[1]], [r0 * 0.02, r0 * 0.02], 300);
  for (let k = 0; k < 3; k++) { const s = r0 * 0.005 / (k + 1), nb = nelderMead(f, best.x, [s, -s], 300); if (nb.v < best.v) best = nb; }
  return { x: best.x[0], y: best.x[1], r: -best.v };
}
const sample = <T>(P: T[], n: number) => (P.length <= n ? P : P.filter((_, i) => i % Math.ceil(P.length / n) === 0));

/** Tangent plane (minimax outside material). `out` = outward normal start; `axis` = constraint: rotate only about it (1 DOF); `fixed` → 0 DOF. */
export function tangentPlane(P: Vec3[], out: Vec3, cons: { about?: Vec3; fixed?: boolean } = {}): { n: Vec3; c: number; width: number } {
  const n0 = unit(out), [u, v] = basis(n0);
  const dirOf = (x: number[]): Vec3 => {
    if (cons.fixed) return n0;
    if (cons.about) { const a = unit(cons.about), w = unit(cross(a, n0)); return unit(add(scale(n0, Math.cos(x[0])), scale(w, Math.sin(x[0])))); }
    return unit(add(n0, add(scale(u, x[0]), scale(v, x[1])))); };
  const width = (n: Vec3) => { let mn = Infinity, mx = -Infinity; for (const q of P) { const t = dot(q, n); if (t < mn) mn = t; if (t > mx) mx = t; } return mx - mn; };
  let ext = 0; const c0 = P.reduce((s, q) => add(s, q), [0, 0, 0] as Vec3).map((x) => x / P.length) as Vec3; for (const q of P) ext = Math.max(ext, norm(sub(q, c0)));
  let n = n0;
  if (!cons.fixed) { const s = Math.max(1e-7, width(n0) / Math.max(1e-9, ext)), x0 = cons.about ? [0] : [0, 0];
    const r = nelderMead((x) => width(dirOf(x)), x0, x0.map(() => s), 300); if (r.v < width(n0)) n = dirOf(r.x); }
  let mx = -Infinity; for (const q of P) mx = Math.max(mx, dot(q, n));
  return { n, c: mx, width: width(n) };
}
/** Inscribed (hole) / circumscribed (shaft) cylinder. dir fixed (cons.fixed) or free (2 tilt angles). */
export function contactCylinder(P: Vec3[], m: FitResult, hole: boolean, cons: { dir?: Vec3 } = {}): { dir: Vec3; centre: Vec3; r: number } {
  const a0 = unit(cons.dir ?? m.normal), [u, v] = basis(a0), R0 = m.radius ?? 1;
  const solve = (d: Vec3, Q: Vec3[]) => { const Q2 = proj2(Q, d), [du, dv] = basis(d), c2: [number, number] = [dot(m.center, du), dot(m.center, dv)];
    const c = hole ? maxInscribed(Q2, c2, R0) : minCircle(Q2); return { c, du, dv }; };
  let d = a0;
  if (!cons.dir) {
    const S = sample(P, 1500), L = m.length || 2 * R0;
    const cost = (x: number[]) => { const dd = unit(add(a0, add(scale(u, x[0]), scale(v, x[1])))), r = solve(dd, S).c.r; return hole ? -r : r; };
    const base = cost([0, 0]), res = nelderMead(cost, [0, 0], [(m.form || R0 * 1e-3) / L, (m.form || R0 * 1e-3) / L], 120, 1e-10);
    if (res.v < base) d = unit(add(a0, add(scale(u, res.x[0]), scale(v, res.x[1]))));
  }
  const { c, du, dv } = solve(d, P);
  const foot = add(scale(du, c.x), scale(dv, c.y)), centre = add(foot, scale(d, dot(m.center, d)));
  return { dir: dot(d, m.normal) < 0 ? scale(d, -1) : d, centre, r: c.r };
}

/** Signed residual of a point to the least-squares feature (plane: along the normal; cylinder/circle: radial). */
function resid(f: Feature, q: Vec3): number {
  const m = f.measured!, d = sub(q, m.center), a = unit(m.normal);
  if (f.type === 'Ebene') return dot(d, a);
  return norm(sub(d, scale(a, dot(d, a)))) - (m.radius ?? 0);
}
/** Outward direction of a plane / material side of a cylinder from vertex normals (if available). */
function outward(f: Feature, N: Vec3[] | null | undefined, P: Vec3[]): { planeOut: Vec3; hole: boolean | null } {
  const m = f.measured!; let s = 0;
  if (!N || !N.length) return { planeOut: unit(m.normal), hole: null };
  if (f.type === 'Ebene') { for (const n of N) s += dot(n, m.normal); return { planeOut: s < 0 ? scale(unit(m.normal), -1) : unit(m.normal), hole: null }; }
  const a = unit(m.normal); for (let i = 0; i < N.length; i++) { const r = sub(P[i], m.center), rad = sub(r, scale(a, dot(r, a))); if (norm(rad) > 1e-9) s += dot(N[i], unit(rad)); }
  return { planeOut: a, hole: s < 0 };
}

const cache = new Map<string, { refs: unknown[]; out: Feature[]; info: SimInfo[] }>();
/**
 * Simulated datum features for a datum sequence (primary | secondary | tertiary). Returns copies whose `measured`
 * is the associated (contact) feature; features that cannot be simulated stay least squares (info.method says so).
 */
export function simulateDatums(ds: Feature[], ctx: SimCtx = {}): { feats: Feature[]; info: SimInfo[] } {
  const assoc = ctx.datumAssoc ?? 'iso';
  if (assoc === 'lsq' || !ctx.points) return { feats: ds, info: ds.map(() => ({ method: 'least squares (Gauss)', shift: 0, tilt: 0 })) };
  // cache: valid while the fits, point and normal arrays are the same objects
  const refs = ds.flatMap((d) => [d.measured, ctx.points!(d.id), ctx.normals?.(d.id) ?? null]);
  const key = assoc + (ctx.datumFilter === false ? '!' : '') + ':' + ds.map((d) => d.id).join('|'), hit = cache.get(key);
  if (hit && hit.refs.length === refs.length && hit.refs.every((r, i) => r === refs[i])) return { feats: hit.out, info: hit.info };
  const out: Feature[] = [], info: SimInfo[] = []; const dirs: Vec3[] = [];
  for (const D of ds) {
    const m = D.measured!, P0 = ctx.points(D.id), lsq = (why: string) => { out.push(D); info.push({ method: `least squares (${why})`, shift: 0, tilt: 0 }); dirs.push(unit(m.normal)); };
    if (!P0 || P0.length < 8) { lsq('no points'); continue; }
    const N0 = ctx.normals?.(D.id), side = outward(D, N0, P0);
    // scan data: drop single spikes (> 3σ from the least-squares feature) before the contact association
    const res = P0.map((q) => resid(D, q)), mu = res.reduce((a, b) => a + b, 0) / res.length, sd = Math.sqrt(res.reduce((a, b) => a + (b - mu) ** 2, 0) / res.length);
    const keep = res.map((r) => ctx.datumFilter === false || Math.abs(r - mu) <= 3 * sd + 1e-12), P = P0.filter((_, i) => keep[i]), dropped = P0.length - P.length;
    const tagN = dropped ? `, ${dropped} spike point(s) > 3σ ignored` : '';
    if (D.type === 'Ebene') {
      let n0 = side.planeOut; const cons: { about?: Vec3; fixed?: boolean } = {};
      // orientation constraints to previous datum directions: nominally ⟂ → keep exactly ⟂; nominally ∥ → keep ∥
      const perp = dirs.filter((g) => Math.abs(dot(g, n0)) < Math.sin((10 * Math.PI) / 180)), par = dirs.find((g) => Math.abs(dot(g, n0)) > Math.cos((10 * Math.PI) / 180));
      if (par) { n0 = dot(par, n0) < 0 ? scale(par, -1) : par; cons.fixed = true; }
      else if (perp.length >= 2) { const c = unit(cross(perp[0], perp[1])); n0 = dot(c, n0) < 0 ? scale(c, -1) : c; cons.fixed = true; }
      else if (perp.length === 1) { n0 = unit(sub(n0, scale(perp[0], dot(n0, perp[0])))); cons.about = perp[0]; }
      const t = tangentPlane(P, n0, cons), c = add(m.center, scale(t.n, t.c - dot(m.center, t.n)));
      const nm = dot(t.n, m.normal) < 0 ? scale(t.n, -1) : t.n;
      out.push({ ...D, measured: { ...m, center: c, normal: nm } });
      info.push({ method: `tangent plane, minimax outside material${cons.fixed ? ', orientation fixed by previous datums' : cons.about ? ', constrained ⟂ previous datum' : ''}${tagN}`, shift: t.c - dot(m.center, t.n), tilt: Math.acos(Math.min(1, Math.abs(dot(t.n, m.normal)))) * 180 / Math.PI });
      dirs.push(t.n); continue;
    }
    if (D.type === 'Zylinder' || D.type === 'Kreis') {
      if (side.hole == null) { lsq('no normals – material side unknown'); continue; }
      const a = unit(m.normal); let dir: Vec3 | undefined = D.type === 'Kreis' ? a : undefined;
      const par = dirs.find((g) => Math.abs(dot(g, a)) > Math.cos((10 * Math.PI) / 180)); if (par) dir = dot(par, a) < 0 ? scale(par, -1) : par;
      const c = contactCylinder(P, m, side.hole, { dir });
      const shift = norm(sub(sub(c.centre, m.center), scale(c.dir, dot(sub(c.centre, m.center), c.dir))));
      out.push({ ...D, measured: { ...m, center: c.centre, normal: c.dir, radius: c.r, diameter: 2 * c.r } });
      info.push({ method: `${side.hole ? 'maximum inscribed' : 'minimum circumscribed'} ${D.type === 'Kreis' ? 'circle' : 'cylinder'}${dir && D.type !== 'Kreis' ? ', ∥ previous datum' : ''}${tagN}`, shift, tilt: Math.acos(Math.min(1, Math.abs(dot(c.dir, a)))) * 180 / Math.PI });
      dirs.push(c.dir); continue;
    }
    lsq(`${D.type}: no ISO 5459 simulation yet`);
  }
  cache.set(key, { refs, out, info }); if (cache.size > 64) cache.delete(cache.keys().next().value!);
  return { feats: out, info };
}

/** Actual size for a material modifier (ISO 2692): Ⓜ → mating size (hole: max. inscribed, shaft: min. circumscribed),
 *  Ⓛ → minimum-material size (hole: min. circumscribed, shaft: max. inscribed). Null if no points/normals. */
export function matingSize(f: Feature, ctx: SimCtx, mod: 'M' | 'L'): { d: number; hole: boolean } | null {
  const m = f.measured, P0 = ctx.points?.(f.id); if (!m || !P0 || P0.length < 8 || (f.type !== 'Zylinder' && f.type !== 'Kreis')) return null;
  const N0 = ctx.normals?.(f.id), key = `${mod}|${ctx.datumFilter !== false}|${f.type}`;
  const cm = msCache.get(P0)?.get(key); if (cm && cm.m === m && cm.N === N0) return cm.r;
  const r = matingSize0(f, m, P0, N0, ctx, mod);
  if (!msCache.has(P0)) msCache.set(P0, new Map()); msCache.get(P0)!.set(key, { m, N: N0, r }); return r;
}
const msCache = new WeakMap<Vec3[], Map<string, { m: unknown; N: unknown; r: { d: number; hole: boolean } | null }>>();
function matingSize0(f: Feature, m: NonNullable<Feature['measured']>, P0: Vec3[], N0: Vec3[] | null | undefined, ctx: SimCtx, mod: 'M' | 'L'): { d: number; hole: boolean } | null {
  const side = outward(f, N0, P0); if (side.hole == null) return null;
  const res = P0.map((q) => resid(f, q)), mu = res.reduce((a, b) => a + b, 0) / res.length, sd = Math.sqrt(res.reduce((a, b) => a + (b - mu) ** 2, 0) / res.length);
  const P = P0.filter((_, i) => ctx.datumFilter === false || Math.abs(res[i] - mu) <= 3 * sd + 1e-12);
  const c = contactCylinder(P, m, (mod === 'M') === side.hole, f.type === 'Kreis' ? { dir: unit(m.normal) } : {});
  return { d: 2 * c.r, hole: side.hole };
}
