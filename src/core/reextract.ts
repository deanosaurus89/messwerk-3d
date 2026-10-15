// Re-extraction: use the existing actual geometry as start and re-collect scan points with the usual industry criteria
// (PolyWorks/Calypso-style): max distance to the geometry, normal angle criterion, then an n·σ outlier filter; refit and
// repeat until the point set is stable. Search region: bounding box of the current points + margin.
import { FitResult, GeomType, fitType, modelNormal, signedDistance } from './fit';
import { Vec3, dot } from './linalg';

export interface ReexParams { maxDist: number; sigma: number; maxAngleDeg: number; margin: number; iterations?: number }
export const REEX_DEFAULT: ReexParams = { maxDist: 0.1, sigma: 3, maxAngleDeg: 30, margin: 1, iterations: 3 };
export interface ReexResult { fit: FitResult; indices: Uint32Array; removedSigma: number; candidates: number; iterations: number }

export function reextract(fit0: FitResult, pos: ArrayLike<number>, nrm: ArrayLike<number> | null, current: Uint32Array, p: ReexParams, seedPts: Vec3[] = []): ReexResult {
  const type = fit0.type as GeomType;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of current) for (let k = 0; k < 3; k++) { const x = pos[3 * v + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
  for (const q of seedPts) for (let k = 0; k < 3; k++) { if (q[k] < lo[k]) lo[k] = q[k]; if (q[k] > hi[k]) hi[k] = q[k]; }
  if (!isFinite(lo[0])) throw new Error('No start points');
  const m = p.margin + p.maxDist; lo = lo.map((x) => x - m); hi = hi.map((x) => x + m);
  const cosA = Math.cos((p.maxAngleDeg * Math.PI) / 180), N = pos.length / 3;
  let fit = fit0, idx = current, removed = 0, cand = 0, it = 0;
  for (it = 0; it < (p.iterations ?? 3); it++) {
    const sel: number[] = [];
    for (let v = 0; v < N; v++) {
      const x = pos[3 * v], y = pos[3 * v + 1], z = pos[3 * v + 2];
      if (x < lo[0] || x > hi[0] || y < lo[1] || y > hi[1] || z < lo[2] || z > hi[2]) continue;
      const q: Vec3 = [x, y, z]; if (Math.abs(signedDistance(fit, q)) > p.maxDist) continue;
      if (nrm) { const n: Vec3 = [nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]]; if (Math.abs(dot(n, modelNormal(fit, q))) < cosA) continue; }
      sel.push(v);
    }
    cand = sel.length; if (sel.length < 5) throw new Error('Too few points within the distance/angle criteria');
    // n·σ filter around the mean deviation
    const d = sel.map((v) => signedDistance(fit, [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]]));
    const mu = d.reduce((a, b) => a + b, 0) / d.length, sd = Math.sqrt(d.reduce((a, b) => a + (b - mu) ** 2, 0) / d.length);
    const keep = sel.filter((_, i) => Math.abs(d[i] - mu) <= p.sigma * sd || sd === 0); removed = sel.length - keep.length;
    const P: Vec3[] = keep.map((v) => [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]]), Nn: Vec3[] = nrm ? keep.map((v) => [nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]]) : [];
    const nf = fitType(type, P, Nn.length ? Nn : P.map(() => fit.normal), false);
    const nIdx = Uint32Array.from(keep); const same = nIdx.length === idx.length && nIdx.every((v, i) => v === idx[i]);
    fit = { ...nf, type }; idx = nIdx; if (same) break;
  }
  return { fit, indices: idx, removedSigma: removed, candidates: cand, iterations: it + 1 };
}
