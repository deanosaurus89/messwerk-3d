// Re-extraction: the existing actual geometry is the start; scan points are re-collected inside a SEARCH REGION that is
// built from the geometry (not a bounding box), with the usual industry criteria (search distance, normal angle, outlier removal).
// ONE search region: ± search distance normal to the fitted surface/curve (also the band of 'All inside boundary'),
// laterally extended beyond the actual contour by the lateral extension (Advanced; default derived = search distance, ≥ 0.5 mm).
// Regions:
//  plane (trimmed)  → prism over its contour (occupancy grid of the current points in the plane, + edge margin)
//  plane (no points, e.g. anchor) → rectangular box over the anchor points + margin
//  cylinder / cone  → hollow shell over the trimmed height (+ margin)
//  sphere           → spherical shell
//  circle / slot    → band along the curve (in-plane distance to the contour, over the current height + margin)
//  line             → tube along the line (over its extent + margin)
import { FitResult, GeomType, fitType, modelNormal, signedDistance } from './fit';
import { Vec3, basis, cross, dot, norm, scale, sub, unit } from './linalg';
import { fillOuterBoundary, insetPlane } from './fillplane';

export interface ReexParams {
  /** search distance ± [mm]: normal thickness of the search region (and band for All inside boundary) */
  maxDist: number;
  /** outlier removal: exclude points beyond n × RMS (std. dev.) of the residuals; 0 = off (keep all) */
  sigma: number; maxAngleDeg: number;
  /** lateral extension beyond the actual contour [mm]; null/undefined = automatic (see lateralOf) */
  margin?: number | null; iterations?: number;
  /** planes: then capture all points inside the outer boundary within ± search distance */
  fill?: boolean;
  /** with fill: drop raised features (boss, sphere, step) as a whole */
  excludeRaised?: boolean;
  /** with fill: include detected islands inside the outer contour (default true) */
  islands?: boolean;
  /** planes: boundary exclusion distance [mm] (inset from the outer contour / openings / excluded islands) */
  inset?: number;
  /** normal angle criterion on/off (default on) */
  angleOn?: boolean;
  /** outlier removal on/off (default on); off = nothing removed regardless of sigma */
  sigmaOn?: boolean;
  /** @deprecated pre-0.19 projects: separate band of All inside boundary (migrated by normReex) */
  fillBand?: number;
}
export const REEX_DEFAULT: ReexParams = { maxDist: 0.1, sigma: 3, maxAngleDeg: 30, margin: null, iterations: 3 };
/** automatic lateral extension: = search distance, at least 0.5 mm */
export const lateralAuto = (p: { maxDist: number }) => Math.max(0.5, p.maxDist);
export const lateralOf = (p: ReexParams) => (p.margin != null && isFinite(p.margin) ? p.margin : lateralAuto(p));
/** Migrate old parameter sets (max. distance + search margin + separate fill band) to the unified search region. */
export function normReex<T extends Partial<ReexParams>>(p: T): T & ReexParams {
  const q: any = { ...REEX_DEFAULT, ...p };
  if (p.fillBand != null) { if (p.fillBand > 0) { q.fill = true; q.maxDist = Math.max(q.maxDist, p.fillBand); } delete q.fillBand; }
  if (q.margin === undefined) q.margin = null;
  return q;
}
export interface ReexResult { fit: FitResult; indices: Uint32Array; removedSigma: number; candidates: number; iterations: number; region: SearchRegion }

/** Geometry of the search region – also used for the transparent preview body. */
export type SearchRegion =
  | { kind: 'prism'; o: Vec3; n: Vec3; u: Vec3; v: Vec3; h: number; i0: number; j0: number; w: number; hgt: number; cells: Uint8Array; d: number }
  | { kind: 'box'; o: Vec3; n: Vec3; u: Vec3; v: Vec3; u0: number; u1: number; v0: number; v1: number; d: number }
  | { kind: 'shell'; type: 'Zylinder' | 'Kegel'; c: Vec3; a: Vec3; t0: number; t1: number; d: number; fit: FitResult }
  | { kind: 'sphere'; c: Vec3; r: number; d: number }
  | { kind: 'torus'; fit: FitResult; d: number }   // toroidal shell (tube radius ± d)
  | { kind: 'band'; type: 'Kreis' | 'Langloch'; fit: FitResult; t0: number; t1: number; d: number }
  | { kind: 'tube'; c: Vec3; a: Vec3; t0: number; t1: number; d: number };

const P3 = (pos: ArrayLike<number>, v: number): Vec3 => [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]];
const along = (pos: ArrayLike<number>, idx: ArrayLike<number>, c: Vec3, a: Vec3, extra: Vec3[]): [number, number] => {
  let t0 = Infinity, t1 = -Infinity; const f = (q: Vec3) => { const t = dot(sub(q, c), a); if (t < t0) t0 = t; if (t > t1) t1 = t; };
  for (let i = 0; i < idx.length; i++) f(P3(pos, idx[i])); extra.forEach(f); return [t0, t1];
};
/** in-plane distance from 2D point (x,y) to the slot contour (stadium, centre line along x, half length hl, radius r) */
const stadiumDist = (x: number, y: number, hl: number, r: number) => { const cx = Math.max(-hl, Math.min(hl, x)); return Math.hypot(x - cx, y) - r; };

export function buildRegion(fit: FitResult, pos: ArrayLike<number>, current: Uint32Array, p0: ReexParams, seedPts: Vec3[] = []): SearchRegion {
  const p = normReex(p0);
  const d = p.maxDist, m = lateralOf(p), n = unit(fit.normal), c = fit.center;
  if (!current.length && !seedPts.length) throw new Error('No start points');
  switch (fit.type) {
    case 'Ebene': {
      const [u, v] = basis(n);
      if (current.length < 3) { // rectangular box over the anchor/start points
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (const q of seedPts) { const w = sub(q, c), a = dot(w, u), b = dot(w, v); u0 = Math.min(u0, a); u1 = Math.max(u1, a); v0 = Math.min(v0, b); v1 = Math.max(v1, b); }
        return { kind: 'box', o: c, n, u, v, u0: u0 - m, u1: u1 + m, v0: v0 - m, v1: v1 + m, d };
      }
      // occupancy grid of the projected points (cell ≈ 1.5× mean spacing), dilated by the margin
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity; const uv: number[] = [];
      for (let i = 0; i < current.length; i++) { const w = sub(P3(pos, current[i]), c), a = dot(w, u), b = dot(w, v); uv.push(a, b); a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
      const area = Math.max(1e-6, (a1 - a0) * (b1 - b0)), h = Math.max(0.05, 1.5 * Math.sqrt(area / current.length));
      const pad = Math.ceil(m / h) + 1, i0 = Math.floor(a0 / h) - pad, j0 = Math.floor(b0 / h) - pad, W = Math.ceil(a1 / h) + pad - i0 + 1, H = Math.ceil(b1 / h) + pad - j0 + 1;
      let cells = new Uint8Array(W * H);
      for (let k = 0; k < uv.length; k += 2) cells[(Math.floor(uv[k + 1] / h) - j0) * W + (Math.floor(uv[k] / h) - i0)] = 1;
      // close small gaps (1 cell), then dilate by the margin
      const dil = (src: Uint8Array, r: number) => { const out = new Uint8Array(src.length);
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (src[j * W + i]) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < W && jj < H && di * di + dj * dj <= r * r + 0.5) out[jj * W + ii] = 1; }
        return out; };
      cells = dil(cells, Math.max(1, Math.round(m / h))); // closes 1-cell gaps and adds the edge margin
      return { kind: 'prism', o: c, n, u, v, h, i0, j0, w: W, hgt: H, cells, d };
    }
    case 'Zylinder': case 'Kegel': { const [t0, t1] = along(pos, current, c, n, seedPts); return { kind: 'shell', type: fit.type, c, a: n, t0: t0 - m, t1: t1 + m, d, fit }; }
    case 'Kugel': return { kind: 'sphere', c, r: fit.radius!, d };
    case 'Torus': return { kind: 'torus', fit, d };
    case 'Kreis': case 'Langloch': { const [t0, t1] = along(pos, current, c, n, seedPts); return { kind: 'band', type: fit.type, fit, t0: t0 - m, t1: t1 + m, d }; }
    case 'Linie': { const a = unit(fit.direction ?? n), L = (fit.length || 0) / 2; const [t0, t1] = current.length ? along(pos, current, c, a, seedPts) : [-L, L]; return { kind: 'tube', c, a, t0: t0 - m, t1: t1 + m, d }; }
    default: throw new Error('Re-extraction not available for this type');
  }
}
export function inRegion(R: SearchRegion, q: Vec3): boolean {
  switch (R.kind) {
    case 'prism': { const w = sub(q, R.o); if (Math.abs(dot(w, R.n)) > R.d) return false; const i = Math.floor(dot(w, R.u) / R.h) - R.i0, j = Math.floor(dot(w, R.v) / R.h) - R.j0; return i >= 0 && j >= 0 && i < R.w && j < R.hgt && R.cells[j * R.w + i] === 1; }
    case 'box': { const w = sub(q, R.o), a = dot(w, R.u), b = dot(w, R.v); return Math.abs(dot(w, R.n)) <= R.d && a >= R.u0 && a <= R.u1 && b >= R.v0 && b <= R.v1; }
    case 'shell': { const t = dot(sub(q, R.c), R.a); return t >= R.t0 && t <= R.t1 && Math.abs(signedDistance(R.fit, q)) <= R.d; }
    case 'sphere': return Math.abs(norm(sub(q, R.c)) - R.r) <= R.d;
    case 'torus': return Math.abs(signedDistance(R.fit, q)) <= R.d;
    case 'band': { const f = R.fit, a = unit(f.normal), w = sub(q, f.center), t = dot(w, a); if (t < R.t0 || t > R.t1) return false;
      const r = sub(w, scale(a, t));
      if (R.type === 'Kreis') return Math.abs(norm(r) - f.radius!) <= R.d;
      const dx = unit(f.direction!), y = unit(cross(a, dx));
      return Math.abs(stadiumDist(dot(r, dx), dot(r, y), f.length! / 2 - f.radius!, f.radius!)) <= R.d; }
    case 'tube': { const w = sub(q, R.c), t = dot(w, R.a); return t >= R.t0 && t <= R.t1 && norm(sub(w, scale(R.a, t))) <= R.d; }
  }
}

export function reextract(fit0: FitResult, pos: ArrayLike<number>, nrm: ArrayLike<number> | null, current: Uint32Array, p0: ReexParams, seedPts: Vec3[] = [], tris: ArrayLike<number> | null = null): ReexResult {
  const p = normReex(p0);
  const type = fit0.type as GeomType;
  const R0 = buildRegion(fit0, pos, current, p, seedPts);
  const cosA = p.angleOn === false ? -2 : Math.cos((p.maxAngleDeg * Math.PI) / 180), N = pos.length / 3, outl = p.sigmaOn !== false && p.sigma > 0;
  // candidates of the region (region fixed from the start geometry; the distance test is part of the region)
  const cands: number[] = []; for (let v = 0; v < N; v++) if (inRegion(R0, P3(pos, v))) cands.push(v);
  let fit = fit0, idx = current, removed = 0, cand = 0, it = 0;
  for (it = 0; it < (p.iterations ?? 3); it++) {
    const sel: number[] = [];
    for (const v of cands) { const q = P3(pos, v); if (Math.abs(signedDistance(fit, q)) > p.maxDist) continue;
      if (nrm && cosA > -1) { const nn: Vec3 = [nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]]; if (Math.abs(dot(nn, modelNormal(fit, q))) < cosA) continue; } sel.push(v); }
    cand = sel.length; if (sel.length < 5) throw new Error('Too few points within the distance/angle criteria');
    const dv = sel.map((v) => signedDistance(fit, P3(pos, v)));
    const mu = dv.reduce((a, b) => a + b, 0) / dv.length, sd = Math.sqrt(dv.reduce((a, b) => a + (b - mu) ** 2, 0) / dv.length);
    const keep = outl ? sel.filter((_, i) => Math.abs(dv[i] - mu) <= p.sigma * sd || sd === 0) : sel; removed = sel.length - keep.length;
    const Pp: Vec3[] = keep.map((v) => P3(pos, v)), Nn: Vec3[] = nrm ? keep.map((v) => [nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]]) : [];
    const nf = fitType(type, Pp, Nn.length ? Nn : Pp.map(() => fit.normal), false);
    const nIdx = Uint32Array.from(keep); const same = nIdx.length === idx.length && nIdx.every((v, i) => v === idx[i]);
    fit = { ...nf, type }; idx = nIdx; if (same) break;
  }
  if (p.fill && type === 'Ebene') {
    // region from the re-extraction gives the outer contour; then all points inside it within the band (no σ/angle filter)
    const fr = fillOuterBoundary(pos, nrm, idx, fit, { band: p.maxDist, excludeRaised: !!p.excludeRaised, islands: p.islands !== false, inset: p.inset ?? 0 }, tris);
    const Pp: Vec3[] = Array.from(fr.indices, (v) => P3(pos, v)), Nn: Vec3[] = nrm ? Array.from(fr.indices, (v) => [nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]] as Vec3) : Pp.map(() => fit.normal);
    fit = { ...fitType(type, Pp, Nn, false), type }; idx = fr.indices; removed = 0;
  }
  else if (type === 'Ebene' && (p.inset ?? 0) > 0) {
    idx = insetPlane(pos, idx, fit, p.inset!, tris); if (idx.length < 5) throw new Error('Boundary exclusion distance removes all points');
    const Pp: Vec3[] = Array.from(idx, (v) => P3(pos, v)), Nn: Vec3[] = nrm ? Array.from(idx, (v) => [nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]] as Vec3) : Pp.map(() => fit.normal);
    fit = { ...fitType(type, Pp, Nn, false), type };
  }
  return { fit, indices: idx, removedSigma: removed, candidates: cand, iterations: it + 1, region: R0 };
}
