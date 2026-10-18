// "Capture all points inside outer boundary" for planes (and generally faces): region growing only decides the OUTER
// contour of the face; then every mesh point inside that contour and within a generous distance band of the plane is
// taken – regardless of normal angle, curvature or σ filter. Bumps, spatter, craters and burrs on the face are kept
// (exactly the points flatness needs); real openings stay out because they have no points in the band, and bore walls
// are rejected by their wall-like normal below the surface; the opposite side of the part is rejected by its normal.
//
// Outer contour: occupancy grid of the seed points in the plane, closed by `closeCells`, flood fill from the border;
// everything not reached from outside is inside (gaps left by region growing around bumps are inside).
import type { FitResult } from './fit';
import { Vec3, basis, dot, unit } from './linalg';

export interface FillParams {
  /** distance band ± around the plane (mm) */
  band: number;
  /** wall rejection: points below the surface whose normal is more than this angle from the plane normal (default 75°) */
  maxWallDeg?: number;
  /** morphological closing of the contour, in grid cells (default 2) */
  closeCells?: number;
}
export const FILL_DEFAULT: FillParams = { band: 1, maxWallDeg: 75, closeCells: 2 };
export interface FillResult { indices: Uint32Array; added: number; cell: number; insideCells: number }

export function fillOuterBoundary(pos: ArrayLike<number>, nrm: ArrayLike<number> | null, seed: ArrayLike<number>, fit: FitResult, p: FillParams = FILL_DEFAULT): FillResult {
  const N = pos.length / 3, n0 = unit(fit.normal), c = fit.center, [u, v] = basis(n0);
  const P = (i: number): Vec3 => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
  // outward side of the face from the seed normals (material below)
  let s = 0; if (nrm) for (let k = 0; k < seed.length; k++) { const i = seed[k]; s += nrm[3 * i] * n0[0] + nrm[3 * i + 1] * n0[1] + nrm[3 * i + 2] * n0[2]; }
  const n: Vec3 = s < 0 ? [-n0[0], -n0[1], -n0[2]] : n0;
  // 2D seed coordinates and grid
  const xs = new Float64Array(seed.length), ys = new Float64Array(seed.length);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k < seed.length; k++) { const q = P(seed[k]), d: Vec3 = [q[0] - c[0], q[1] - c[1], q[2] - c[2]]; const x = dot(d, u), y = dot(d, v); xs[k] = x; ys[k] = y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (seed.length < 3) throw new Error('Too few points selected');
  const area = Math.max(1e-12, (x1 - x0) * (y1 - y0));
  let h = 2.5 * Math.sqrt(area / seed.length);
  const r = p.closeCells ?? 2, M = r + 2;
  // limit the grid size (≤ ~4 M cells)
  while (((x1 - x0) / h + 2 * M) * ((y1 - y0) / h + 2 * M) > 4e6) h *= 1.5;
  const W = Math.ceil((x1 - x0) / h) + 2 * M, H = Math.ceil((y1 - y0) / h) + 2 * M;
  const cx = (x: number) => Math.floor((x - x0) / h) + M, cy = (y: number) => Math.floor((y - y0) / h) + M;
  const occ = new Uint8Array(W * H);
  for (let k = 0; k < seed.length; k++) occ[cy(ys[k]) * W + cx(xs[k])] = 1;
  const dilate = (a: Uint8Array, rr: number) => { if (rr <= 0) return a; const o = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (a[j * W + i]) for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < W && jj < H && di * di + dj * dj <= rr * rr) o[jj * W + ii] = 1; }
    return o; };
  const closed = dilate(occ, r);
  // flood fill the outside over empty cells
  const out = new Uint8Array(W * H), st: number[] = [];
  const push = (i: number, j: number) => { if (i < 0 || j < 0 || i >= W || j >= H) return; const k = j * W + i; if (out[k] || closed[k]) return; out[k] = 1; st.push(k); };
  for (let i = 0; i < W; i++) { push(i, 0); push(i, H - 1); } for (let j = 0; j < H; j++) { push(0, j); push(W - 1, j); }
  while (st.length) { const k = st.pop()!, i = k % W, j = (k - i) / W; push(i + 1, j); push(i - 1, j); push(i, j + 1); push(i, j - 1); }
  // inside = not outside, eroded by r (undo the dilation at the outer contour) = complement of dilated outside
  const outD = dilate(out, r), inside = new Uint8Array(W * H); let insideCells = 0;
  for (let k = 0; k < W * H; k++) if (!outD[k]) { inside[k] = 1; insideCells++; }
  for (let k = 0; k < seed.length; k++) inside[cy(ys[k]) * W + cx(xs[k])] = 1; // the seed itself is always inside
  // candidates: inside the outer contour and within the band
  const cosW = Math.cos(((p.maxWallDeg ?? 75) * Math.PI) / 180), band = p.band, sel = new Uint8Array(N);
  for (let k = 0; k < seed.length; k++) sel[seed[k]] = 1;
  const cand: number[] = [], cd: number[] = [], ccell: number[] = [], has = new Uint8Array(W * H);
  for (let k = 0; k < seed.length; k++) has[cy(ys[k]) * W + cx(xs[k])] = 1;
  for (let i = 0; i < N; i++) {
    const dx = pos[3 * i] - c[0], dy = pos[3 * i + 1] - c[1], dz = pos[3 * i + 2] - c[2];
    const d = dx * n[0] + dy * n[1] + dz * n[2]; if (d > band || d < -band) continue;
    const x = dx * u[0] + dy * u[1] + dz * u[2], y = dx * v[0] + dy * v[1] + dz * v[2];
    const ii = cx(x), jj = cy(y); if (ii < 0 || jj < 0 || ii >= W || jj >= H || !inside[jj * W + ii]) continue;
    has[jj * W + ii] = 1; if (sel[i]) continue; cand.push(i); cd.push(d); ccell.push(jj * W + ii);
  }
  // real openings: inside cells without any point in the band; points BELOW the surface right at an opening are its
  // edge (chamfer, bore wall) and not part of the face – burrs above the surface stay
  const voids = new Uint8Array(W * H); for (let k = 0; k < W * H; k++) if (inside[k] && !has[k]) voids[k] = 1;
  const nearOpen = dilate(voids, 2);
  let added = 0;
  for (let t = 0; t < cand.length; t++) {
    const i = cand[t], d = cd[t];
    if (d < 0 && nearOpen[ccell[t]]) continue;
    if (nrm) { const dn = nrm[3 * i] * n[0] + nrm[3 * i + 1] * n[1] + nrm[3 * i + 2] * n[2];
      if (dn < -0.5) continue;                       // opposite side of the part
      if (d < 0 && Math.abs(dn) < cosW) continue; }  // wall going into the material (bore, step) – not part of the face
    sel[i] = 1; added++;
  }
  const idx: number[] = []; for (let i = 0; i < N; i++) if (sel[i]) idx.push(i);
  return { indices: Uint32Array.from(idx), added, cell: h, insideCells };
}
