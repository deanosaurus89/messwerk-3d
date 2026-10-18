// "Capture all points inside outer boundary" for planes (and generally faces): region growing only decides the OUTER
// contour of the face; then every mesh point inside that contour and within a generous distance band of the plane is
// taken – regardless of normal angle, curvature or σ filter. Bumps, spatter rings, craters and burrs on the face are
// kept (exactly the points flatness needs). Only TRUE openings stay out: they have no surface in the band, and their
// walls/chamfers are rejected where the surface leaves the plane steeply/sloped right at the opening or continues
// deeper than the band (real bores, steps). The opposite side of the part is rejected by its normal.
// Raised features (surface rising above the band: boss, sphere, high weld bead) are NOT excluded by default – their
// points in the band are reported separately (`raised`, shown in a distinct colour) and dropped only with
// `excludeRaised`.
//
// Outer contour: occupancy grid of the seed points in the plane, closed by `closeMm`, flood fill from the border;
// everything not reached from outside is inside (gaps left by region growing around bumps are inside). The contour is
// returned as 3D loops for display.
import type { FitResult } from './fit';
import { Vec3, basis, dot, unit } from './linalg';

export interface FillParams {
  /** distance band ± around the plane (mm) */
  band: number;
  /** wall rejection: steep = normal more than this angle from the plane normal (default 75°) */
  maxWallDeg?: number;
  /** morphological closing of the contour in mm (bridges narrow strips the region growing missed; default 2) */
  closeMm?: number;
  /** drop raised features (surface rising above the band, incl. their base) – default false */
  excludeRaised?: boolean;
  /** elevations higher than this (mm) count as raised features even with gentle flanks (default 2.5) */
  maxBump?: number;
}
export const FILL_DEFAULT: FillParams = { band: 2, maxWallDeg: 75, closeMm: 2, excludeRaised: false };
export interface FillResult { indices: Uint32Array; added: number; cell: number; insideCells: number;
  /** points belonging to raised features (in the result unless excludeRaised, else the excluded ones) */
  raised: Uint32Array; raisedCount: number;
  /** outer contour as closed 3D loops (in the plane) */
  contour: number[][][] }

/** box dilation by rr cells (separable running max, O(cells)) */
function dilateBox(a: Uint8Array, W: number, H: number, rr: number): Uint8Array {
  if (rr <= 0) return a; const t = new Uint8Array(W * H), o = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) { let last = -1e9; for (let i = 0; i < W; i++) { if (a[j * W + i]) last = i; if (i - last <= rr) t[j * W + i] = 1; }
    last = 1e9; for (let i = W - 1; i >= 0; i--) { if (a[j * W + i]) last = i; if (last - i <= rr) t[j * W + i] = 1; } }
  for (let i = 0; i < W; i++) { let last = -1e9; for (let j = 0; j < H; j++) { if (t[j * W + i]) last = j; if (j - last <= rr) o[j * W + i] = 1; }
    last = 1e9; for (let j = H - 1; j >= 0; j--) { if (t[j * W + i]) last = j; if (last - j <= rr) o[j * W + i] = 1; } }
  return o;
}
/** boundary of a cell mask as closed loops of grid vertices (CCW around inside), lightly smoothed */
function maskLoops(m: Uint8Array, W: number, H: number): [number, number][][] {
  const nx = new Map<number, number[]>(), V = W + 1, key = (i: number, j: number) => j * V + i;
  const add = (a: number, b: number) => { const l = nx.get(a); if (l) l.push(b); else nx.set(a, [b]); };
  const ins = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && !!m[j * W + i];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { if (!m[j * W + i]) continue;
    if (!ins(i, j - 1)) add(key(i, j), key(i + 1, j)); if (!ins(i + 1, j)) add(key(i + 1, j), key(i + 1, j + 1));
    if (!ins(i, j + 1)) add(key(i + 1, j + 1), key(i, j + 1)); if (!ins(i - 1, j)) add(key(i, j + 1), key(i, j)); }
  const loops: [number, number][][] = [];
  for (const [s0] of nx) { let a = s0; const L: [number, number][] = [];
    while (true) { const l = nx.get(a); if (!l || !l.length) break; const b = l.pop()!; if (!l.length) nx.delete(a); L.push([a % V, Math.floor(a / V)]); a = b; if (a === s0) break; }
    if (L.length >= 4) loops.push(L); }
  // smooth the staircase (3 passes of neighbour averaging) and thin out
  return loops.map((L) => { let P = L; for (let it = 0; it < 3; it++) P = P.map((p, k) => { const a = P[(k + P.length - 1) % P.length], b = P[(k + 1) % P.length]; return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4] as [number, number]; });
    const step = Math.max(1, Math.floor(P.length / 400)); return P.filter((_, k) => k % step === 0); });
}

export function fillOuterBoundary(pos: ArrayLike<number>, nrm: ArrayLike<number> | null, seed: ArrayLike<number>, fit: FitResult, p: FillParams = FILL_DEFAULT): FillResult {
  const N = pos.length / 3, n0 = unit(fit.normal), c = fit.center, [u, v] = basis(n0);
  if (seed.length < 3) throw new Error('Too few points selected');
  const P = (i: number): Vec3 => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
  // outward side of the face from the seed normals (material below)
  let s = 0; if (nrm) for (let k = 0; k < seed.length; k++) { const i = seed[k]; s += nrm[3 * i] * n0[0] + nrm[3 * i + 1] * n0[1] + nrm[3 * i + 2] * n0[2]; }
  const n: Vec3 = s < 0 ? [-n0[0], -n0[1], -n0[2]] : n0;
  // 2D seed coordinates and grid
  const xs = new Float64Array(seed.length), ys = new Float64Array(seed.length);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k < seed.length; k++) { const q = P(seed[k]), d: Vec3 = [q[0] - c[0], q[1] - c[1], q[2] - c[2]]; const x = dot(d, u), y = dot(d, v); xs[k] = x; ys[k] = y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const area = Math.max(1e-12, (x1 - x0) * (y1 - y0));
  let h = 2.5 * Math.sqrt(area / seed.length);
  while (((x1 - x0) / h + 60) * ((y1 - y0) / h + 60) > 4e6) h *= 1.5; // ≤ ~4 M cells
  const r = Math.min(25, Math.max(2, Math.ceil((p.closeMm ?? 2) / h))), M = r + 2 + Math.min(40, Math.ceil(5 / h));
  const W = Math.ceil((x1 - x0) / h) + 2 * M, H = Math.ceil((y1 - y0) / h) + 2 * M;
  const cx = (x: number) => Math.floor((x - x0) / h) + M, cy = (y: number) => Math.floor((y - y0) / h) + M;
  const dil = (a: Uint8Array, rr: number) => dilateBox(a, W, H, rr);
  const occ = new Uint8Array(W * H);
  for (let k = 0; k < seed.length; k++) occ[cy(ys[k]) * W + cx(xs[k])] = 1;
  // the region growing may have missed coplanar parts of the face at its border (narrow strip next to a slot, edge
  // zones): extend the occupancy over cells with flat, in-plane surface connected to it before taking the contour
  const tolE = Math.max(0.15, 1.5 * (fit.form ?? 0)), flat = new Uint8Array(W * H);
  for (let i = 0; i < N; i++) {
    const dx = pos[3 * i] - c[0], dy = pos[3 * i + 1] - c[1], dz = pos[3 * i + 2] - c[2], d = dx * n[0] + dy * n[1] + dz * n[2]; if (d > tolE || d < -tolE) continue;
    if (nrm && nrm[3 * i] * n[0] + nrm[3 * i + 1] * n[1] + nrm[3 * i + 2] * n[2] < 0.94) continue;
    const ii = cx(dx * u[0] + dy * u[1] + dz * u[2]), jj = cy(dx * v[0] + dy * v[1] + dz * v[2]); if (ii >= 0 && jj >= 0 && ii < W && jj < H) flat[jj * W + ii] = 1;
  }
  { const q: number[] = []; for (let k = 0; k < W * H; k++) if (occ[k]) q.push(k);
    while (q.length) { const k = q.pop()!, i = k % W, j = (k - i) / W; for (const kk of [i + 1 < W ? k + 1 : -1, i > 0 ? k - 1 : -1, j + 1 < H ? k + W : -1, j > 0 ? k - W : -1]) if (kk >= 0 && flat[kk] && !occ[kk]) { occ[kk] = 1; q.push(kk); } } }
  const closed = dil(occ, r);
  // flood fill the outside over empty cells
  const out = new Uint8Array(W * H), st: number[] = [];
  const push = (i: number, j: number) => { if (i < 0 || j < 0 || i >= W || j >= H) return; const k = j * W + i; if (out[k] || closed[k]) return; out[k] = 1; st.push(k); };
  for (let i = 0; i < W; i++) { push(i, 0); push(i, H - 1); } for (let j = 0; j < H; j++) { push(0, j); push(W - 1, j); }
  while (st.length) { const k = st.pop()!, i = k % W, j = (k - i) / W; push(i + 1, j); push(i - 1, j); push(i, j + 1); push(i, j - 1); }
  // inside = complement of the dilated outside (undo the closing at the outer contour); the seed is always inside
  const outD = dil(out, r), inside = new Uint8Array(W * H); let insideCells = 0;
  for (let k = 0; k < W * H; k++) if (!outD[k]) inside[k] = 1;
  for (let k = 0; k < W * H; k++) if (occ[k]) inside[k] = 1;
  for (let k = 0; k < W * H; k++) insideCells += inside[k];
  // one pass over the mesh: candidates in the band, cells with surface in the band, deep wall cells, raised cells
  const cosW = Math.cos(((p.maxWallDeg ?? 75) * Math.PI) / 180), band = p.band, sel = new Uint8Array(N);
  for (let k = 0; k < seed.length; k++) sel[seed[k]] = 1;
  const cand: number[] = [], cd: number[] = [], cdn: number[] = [], ccell: number[] = [];
  const hc: number[] = [], hd: number[] = [], hdn: number[] = [], hcell: number[] = [];
  const has = new Uint8Array(W * H), deep = new Uint8Array(W * H), high = new Uint8Array(W * H);
  for (let k = 0; k < seed.length; k++) has[cy(ys[k]) * W + cx(xs[k])] = 1;
  for (let i = 0; i < N; i++) {
    const dx = pos[3 * i] - c[0], dy = pos[3 * i + 1] - c[1], dz = pos[3 * i + 2] - c[2];
    const d = dx * n[0] + dy * n[1] + dz * n[2]; if (d < -4 * band - 1) continue;
    const ii = cx(dx * u[0] + dy * u[1] + dz * u[2]), jj = cy(dx * v[0] + dy * v[1] + dz * v[2]);
    if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue; const cell = jj * W + ii; if (!inside[cell]) continue;
    const dn = nrm ? nrm[3 * i] * n[0] + nrm[3 * i + 1] * n[1] + nrm[3 * i + 2] * n[2] : 1;
    if (d < -band) { if (Math.abs(dn) < 0.5) deep[cell] = 1; continue; }   // wall continuing below the band: real bore/step
    if (d > band) { if (dn > -0.2 && d < 50) { high[cell] = 1; hc.push(i); hd.push(d); hdn.push(dn); hcell.push(cell); } continue; } // above the band: bump tip or raised feature
    has[cell] = 1; if (sel[i]) continue; cand.push(i); cd.push(d); cdn.push(dn); ccell.push(cell);
  }
  // real openings: inside cells without any surface in the band (and the outside); their edge zone
  const voids = new Uint8Array(W * H); for (let k = 0; k < W * H; k++) if (!inside[k] || !has[k]) voids[k] = 1;
  const nearOpen = dil(voids, 2), nearDeep = dil(deep, 1);
  // elevations above the band: connected components of 'high' cells. A component is a RAISED FEATURE (boss, sphere,
  // high bead) if it is higher than maxBump or has a substantial share of steep (wall-like) surface; otherwise it is a
  // tall bump/spatter and its tip is captured too (band adapts to the data)
  const hcomp = new Int32Array(W * H).fill(-1); let nh = 0;
  for (let k0 = 0; k0 < W * H; k0++) { if (!high[k0] || hcomp[k0] >= 0) continue; const q = [k0]; hcomp[k0] = nh;
    while (q.length) { const k = q.pop()!, i = k % W, j = (k - i) / W; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue; const kk = jj * W + ii; if (high[kk] && hcomp[kk] < 0) { hcomp[kk] = nh; q.push(kk); } } }
    nh++; }
  // steep: wall share; plateau: flat surface above the band (pad, boss top) – bumps/spatter are rounded
  const maxBump = p.maxBump ?? 2.5, hMax = new Float64Array(nh), hN = new Float64Array(nh), hSteep = new Float64Array(nh), hFlat = new Float64Array(nh);
  for (let t = 0; t < hc.length; t++) { const k = hcomp[hcell[t]]; hMax[k] = Math.max(hMax[k], hd[t]); hN[k]++; if (Math.abs(hdn[t]) < cosW) hSteep[k]++; if (hdn[t] > 0.995) hFlat[k]++; }
  const isRaised = (k: number) => hMax[k] > maxBump || hSteep[k] > Math.max(6, 0.1 * hN[k]) || (hN[k] >= 30 && hFlat[k] > 0.4 * hN[k]);
  const rcell = new Uint8Array(W * H); for (let k = 0; k < W * H; k++) if (hcomp[k] >= 0 && isRaised(hcomp[k])) rcell[k] = 1;
  const raisedZone = dil(rcell, 2);
  const cosSlope = Math.cos((20 * Math.PI) / 180);
  let added = 0; const raised: number[] = [];
  for (let t = 0; t < cand.length; t++) {
    const i = cand[t], d = cd[t], dn = cdn[t], cell = ccell[t];
    if (nrm && dn < -0.2) continue;                                         // facing away: opposite side / overhang
    if (d < 0 && nrm) {
      if (Math.abs(dn) < cosW && (nearDeep[cell] || nearOpen[cell])) continue; // bore/step wall going down
      if (dn < cosSlope && nearOpen[cell]) continue;                        // chamfer / edge rounding at an opening or the outer edge
    }
    if (raisedZone[cell]) { raised.push(i); if (p.excludeRaised) continue; }
    sel[i] = 1; added++;
  }
  for (let t = 0; t < hc.length; t++) { const i = hc[t]; if (sel[i]) continue;
    if (rcell[hcell[t]]) { raised.push(i); continue; } // raised feature above the band: shown, not captured
    sel[i] = 1; added++; }                                                    // tip of a tall bump / spatter
  const idx: number[] = []; for (let i = 0; i < N; i++) if (sel[i]) idx.push(i);
  // outer contour loops in 3D (slightly above the plane)
  const lift = 0;
  const contour = maskLoops(inside, W, H).map((L) => L.map(([gi, gj]) => { const x = (gi - M) * h + x0, y = (gj - M) * h + y0;
    return [c[0] + u[0] * x + v[0] * y + n[0] * lift, c[1] + u[1] * x + v[1] * y + n[1] * lift, c[2] + u[2] * x + v[2] * y + n[2] * lift]; }));
  return { indices: Uint32Array.from(idx), added, cell: h, insideCells, raised: Uint32Array.from(raised), raisedCount: raised.length, contour };
}
