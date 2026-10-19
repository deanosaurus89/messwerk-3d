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
  /** include detected islands: interior regions inside the outer contour that region growing did not reach (bump
   *  patches, spatter rings) – default true; false = only the grown region (its gaps closed) */
  islands?: boolean;
  /** boundary exclusion distance [mm]: points closer than this to the outer contour, to openings (holes) and – with
   *  islands excluded – to island edges are dropped (fixed inset; default 0) */
  inset?: number;
  /** per-island choice (0.31, creation): when present, every detected island – an enclosed area inside the outer contour
   *  that is not plain face (opening, bump/raised rim/spatter the region growing did not reach, raised feature) – is
   *  EXCLUDED unless listed with inc = true (“not an island”); m refines its extent (mm: + grows, − shrinks the excluded
   *  zone). Supersedes `islands`. Choices are matched to islands by centre (≤ max(1 mm, ½ island radius)). */
  isl?: IslandChoice[];
}
export interface IslandChoice { c: number[]; inc?: boolean; m?: number }
export interface Island { id: number; kind: 'hole' | 'bump' | 'raised'; /** hole with a raised rim/spatter around it */ rim?: boolean;
  c: number[]; /** equivalent radius (mm) */ r: number; area: number; /** max height above the plane (mm) */ h: number; /** mesh points in it */ n: number;
  inc: boolean; m: number; loops: number[][][] }
export const FILL_DEFAULT: FillParams = { band: 2, maxWallDeg: 75, closeMm: 2, excludeRaised: false, islands: true, inset: 0 };
export interface FillResult { indices: Uint32Array; added: number; cell: number; insideCells: number;
  /** points belonging to raised features (in the result unless excludeRaised, else the excluded ones) */
  raised: Uint32Array; raisedCount: number;
  /** outer contour as closed 3D loops (in the plane) */
  contour: number[][][]; islandCells?: number; insetDropped?: number; islands?: Island[] }

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


/** Rasterize mesh triangles whose three vertices are all marked into a grid (cells whose centre lies in the projected
 *  triangle). Gives closed coverage even where the mesh is coarse (large flat triangles = sparse vertices). */
export function rasterTris(pos: ArrayLike<number>, tris: ArrayLike<number>, mark: Uint8Array, c: Vec3, u: Vec3, v: Vec3,
  x0: number, y0: number, h: number, M: number, W: number, H: number, out: Uint8Array) {
  const px = (i: number) => (pos[3 * i] - c[0]) * u[0] + (pos[3 * i + 1] - c[1]) * u[1] + (pos[3 * i + 2] - c[2]) * u[2];
  const py = (i: number) => (pos[3 * i] - c[0]) * v[0] + (pos[3 * i + 1] - c[1]) * v[1] + (pos[3 * i + 2] - c[2]) * v[2];
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], d = tris[t + 2]; if (!mark[a] || !mark[b] || !mark[d]) continue;
    const ax = (px(a) - x0) / h + M, ay = (py(a) - y0) / h + M, bx = (px(b) - x0) / h + M, by = (py(b) - y0) / h + M, dx = (px(d) - x0) / h + M, dy = (py(d) - y0) / h + M;
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx, dx))), i1 = Math.min(W - 1, Math.floor(Math.max(ax, bx, dx)));
    const j0 = Math.max(0, Math.floor(Math.min(ay, by, dy))), j1 = Math.min(H - 1, Math.floor(Math.max(ay, by, dy)));
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 250000) continue;
    const den = (by - dy) * (ax - dx) + (dx - bx) * (ay - dy); if (Math.abs(den) < 1e-12) continue;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const qx = i + 0.5, qy = j + 0.5, l1 = ((by - dy) * (qx - dx) + (dx - bx) * (qy - dy)) / den, l2 = ((dy - ay) * (qx - dx) + (ax - dx) * (qy - dy)) / den;
      if (l1 >= -1e-6 && l2 >= -1e-6 && l1 + l2 <= 1 + 1e-6) out[j * W + i] = 1;
    }
  }
}

export function fillOuterBoundary(pos: ArrayLike<number>, nrm: ArrayLike<number> | null, seed: ArrayLike<number>, fit: FitResult, p: FillParams = FILL_DEFAULT, tris?: ArrayLike<number> | null): FillResult {
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
  let h = 1.6 * Math.sqrt(area / seed.length);
  while (((x1 - x0) / h + 60) * ((y1 - y0) / h + 60) > 4e6) h *= 1.5; // ≤ ~4 M cells
  const r = Math.min(25, Math.max(2, Math.ceil((p.closeMm ?? 2) / h))), M = r + 2 + Math.min(40, Math.ceil(5 / h));
  const W = Math.ceil((x1 - x0) / h) + 2 * M, H = Math.ceil((y1 - y0) / h) + 2 * M;
  const cx = (x: number) => Math.floor((x - x0) / h) + M, cy = (y: number) => Math.floor((y - y0) / h) + M;
  const dil = (a: Uint8Array, rr: number) => dilateBox(a, W, H, rr);
  const occ = new Uint8Array(W * H);
  for (let k = 0; k < seed.length; k++) occ[cy(ys[k]) * W + cx(xs[k])] = 1;
  if (tris) { const m = new Uint8Array(N); for (let k = 0; k < seed.length; k++) m[seed[k]] = 1; rasterTris(pos, tris, m, c, u, v, x0, y0, h, M, W, H, occ); }
  // Outer contour = boundary of the GROWN region with its interior holes/islands filled – never beyond the grown
  // region's outer edge (no silhouette/hull, no extension over edge fillets or side walls). Closing by one cell only
  // bridges the sampling gaps of the grid; everything not reachable from the grid border is inside.
  const closed = dil(occ, 1);
  const out = new Uint8Array(W * H), st: number[] = [];
  const push = (i: number, j: number) => { if (i < 0 || j < 0 || i >= W || j >= H) return; const k = j * W + i; if (out[k] || closed[k]) return; out[k] = 1; st.push(k); };
  for (let i = 0; i < W; i++) { push(i, 0); push(i, H - 1); } for (let j = 0; j < H; j++) { push(0, j); push(W - 1, j); }
  while (st.length) { const k = st.pop()!, i = k % W, j = (k - i) / W; push(i + 1, j); push(i - 1, j); push(i, j + 1); push(i, j - 1); }
  void r;
  // inside = complement of the dilated outside (undo the closing at the outer contour); the seed is always inside
  const outD = dil(out, 1), inside = new Uint8Array(W * H); let insideCells = 0;
  for (let k = 0; k < W * H; k++) if (!outD[k]) inside[k] = 1;
  for (let k = 0; k < W * H; k++) if (occ[k]) inside[k] = 1;
  for (let k = 0; k < W * H; k++) insideCells += inside[k];
  // one pass over the mesh: candidates in the band, cells with surface in the band, deep wall cells, raised cells
  const cosW = Math.cos(((p.maxWallDeg ?? 75) * Math.PI) / 180), band = p.band, sel = new Uint8Array(N);
  for (let k = 0; k < seed.length; k++) sel[seed[k]] = 1;
  const cand: number[] = [], cd: number[] = [], cdn: number[] = [], ccell: number[] = [];
  const hc: number[] = [], hd: number[] = [], hdn: number[] = [], hcell: number[] = [];
  const bandV = tris ? new Uint8Array(N) : new Uint8Array(0);
  const has = new Uint8Array(W * H), deep = new Uint8Array(W * H), high = new Uint8Array(W * H);
  const dabs = p.isl ? new Float32Array(W * H) : new Float32Array(0), hpos = p.isl ? new Float32Array(W * H) : dabs, pc = p.isl ? new Uint32Array(W * H) : new Uint32Array(0), dbs: number[] = []; // |distance| per cell (islands: local bumps/dents)
  for (let k = 0; k < seed.length; k++) has[cy(ys[k]) * W + cx(xs[k])] = 1;
  for (let i = 0; i < N; i++) {
    const dx = pos[3 * i] - c[0], dy = pos[3 * i + 1] - c[1], dz = pos[3 * i + 2] - c[2];
    const d = dx * n[0] + dy * n[1] + dz * n[2]; if (d < -4 * band - 1) continue;
    const ii = cx(dx * u[0] + dy * u[1] + dz * u[2]), jj = cy(dx * v[0] + dy * v[1] + dz * v[2]);
    if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue; const cell = jj * W + ii; if (!inside[cell]) continue;
    const dn = nrm ? nrm[3 * i] * n[0] + nrm[3 * i + 1] * n[1] + nrm[3 * i + 2] * n[2] : 1;
    if (d < -band) { if (Math.abs(dn) < 0.5) deep[cell] = 1; continue; }   // wall continuing below the band: real bore/step
    if (d > band) { if (dn > -0.2 && d < 50) { high[cell] = 1; if (p.isl) { pc[cell]++; if (d > hpos[cell]) hpos[cell] = d; } hc.push(i); hd.push(d); hdn.push(dn); hcell.push(cell); } continue; } // above the band: bump tip or raised feature
    has[cell] = 1; if (tris) bandV[i] = 1; if (p.isl) { pc[cell]++; if (dn > 0.87) { const a = Math.abs(d); if (a > dabs[cell]) dabs[cell] = a; if (d > hpos[cell]) hpos[cell] = d; if (dbs.length < 200000 && (i & 3) === 0) dbs.push(a); } } if (sel[i]) continue; cand.push(i); cd.push(d); cdn.push(dn); ccell.push(cell);
  }
  if (tris) { for (let k = 0; k < seed.length; k++) bandV[seed[k]] = 1; const hasT = new Uint8Array(W * H); rasterTris(pos, tris, bandV, c, u, v, x0, y0, h, M, W, H, hasT); for (let k = 0; k < W * H; k++) if (hasT[k] && inside[k]) has[k] = 1; }
  // real openings: inside cells without any surface in the band (and the outside); their edge zone
  const voids = new Uint8Array(W * H); for (let k = 0; k < W * H; k++) if (!inside[k] || !has[k]) voids[k] = 1;
  const nearOpen = dil(voids, 2), nearDeep = dil(deep, 1), nearEdge = dil(outD, Math.max(3, Math.ceil(1.5 / h))), nearOuter = dil(outD, 2);
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
  // islands: cells inside the contour with surface that the (gap-closed) grown region does not cover
  const grownC = dil(occ, 1), island = new Uint8Array(W * H); let islandCells = 0;
  if (p.islands === false) for (let k = 0; k < W * H; k++) if (inside[k] && has[k] && !grownC[k] && !rcell[k]) { island[k] = 1; islandCells++; }
  let islands: Island[] | undefined;
  if (p.isl) { // 0.31: detected islands, excluded unless chosen “not an island”
    const lift3 = (x: number, y: number) => [c[0] + u[0] * x + v[0] * y, c[1] + u[1] * x + v[1] * y, c[2] + u[2] * x + v[2] * y];
    const cellXY = (k: number) => { const i = k % W, j = (k - i) / W; return [(i + 0.5 - M) * h + x0, (j + 0.5 - M) * h + y0]; };
    // local bump / dent: surface further from the plane than 6 × the robust noise (MAD), at least 0.03 mm – also where the
    // region growing ran over it (gentle flanks)
    dbs.sort((a, b) => a - b); const sig = 1.4826 * (dbs[dbs.length >> 1] ?? 0), T = Math.max(0.03, 6 * sig);
    const cand0 = new Uint8Array(W * H); for (let k = 0; k < W * H; k++) if (inside[k] && (!has[k] || !grownC[k] || rcell[k] || dabs[k] > T || high[k])) cand0[k] = 1;
    const comp = new Int32Array(W * H).fill(-1), comps: number[][] = [];
    for (let k0 = 0; k0 < W * H; k0++) { if (!cand0[k0] || comp[k0] >= 0) continue; const id = comps.length, cells = [k0], q = [k0]; comp[k0] = id; let open = false;
      while (q.length) { const k = q.pop()!, i = k % W, j = (k - i) / W;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H) { open = true; continue; }
          const kk = jj * W + ii; if (outD[kk] && !inside[kk]) open = true; if (!cand0[kk] || comp[kk] >= 0) continue; comp[kk] = id; cells.push(kk); q.push(kk); } }
      comps.push(open || cells.length < 2 || cells.length > 0.25 * insideCells ? [] : cells); } // large areas = form deviation of the face, not an island
    // per component: kind, centre, height, point count
    islands = [];
    const choices = p.isl;
    for (let id = 0; id < comps.length; id++) { const cells = comps[id]; if (!cells.length) continue;
      let sx = 0, sy = 0, nv = 0, nr = 0, nb = 0, npt = 0, hmx = 0; for (const k of cells) { const [x, y] = cellXY(k); sx += x; sy += y; if (!has[k] && !high[k]) nv++; if (rcell[k]) nr++; if (hpos[k] > T) nb++; npt += pc[k]; hmx = Math.max(hmx, hpos[k]); }
      const cc = lift3(sx / cells.length, sy / cells.length), area = cells.length * h * h, r = Math.sqrt(area / Math.PI);
      const kind: Island['kind'] = nr > 0 && hmx > 0.5 ? 'raised' : nv >= 2 ? 'hole' : 'bump'; // a flat swell of a few 0.1 mm is a bump, not a raised feature
      let ch: IslandChoice | undefined, bd = Math.max(1, 0.5 * r);
      for (const o of choices) { const d = Math.hypot(o.c[0] - cc[0], o.c[1] - cc[1], o.c[2] - cc[2]); if (d < bd) { bd = d; ch = o; } }
      const rim = kind === 'hole' && nb >= 3, inc = !!ch?.inc && (kind !== 'hole' || rim), m = ch?.m ?? 0;
      // excluded zone = component refined by the margin (dilate / erode inside its bounding box)
      let i0 = W, i1 = 0, j0 = H, j1 = 0; for (const k of cells) { const i = k % W, j = (k - i) / W; i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
      const rr = Math.round(Math.abs(m) / h), pad = rr + 2, bi = Math.max(0, i0 - pad), bj = Math.max(0, j0 - pad), bw = Math.min(W - 1, i1 + pad) - bi + 1, bh = Math.min(H - 1, j1 + pad) - bj + 1;
      const sub = new Uint8Array(bw * bh); for (const k of cells) { const i = k % W, j = (k - i) / W; sub[(j - bj) * bw + (i - bi)] = 1; }
      let zone: Uint8Array = sub;
      if (m > 0 && rr > 0) zone = dilateBox(sub, bw, bh, rr);
      else if (m < 0 && rr > 0) { const inv = new Uint8Array(bw * bh); for (let k = 0; k < bw * bh; k++) inv[k] = sub[k] ? 0 : 1; const e = dilateBox(inv, bw, bh, rr); zone = new Uint8Array(bw * bh); for (let k = 0; k < bw * bh; k++) zone[k] = sub[k] && !e[k] ? 1 : 0; }
      if (!inc) for (let jj = 0; jj < bh; jj++) for (let ii = 0; ii < bw; ii++) if (zone[jj * bw + ii]) { const k = (jj + bj) * W + ii + bi; if (inside[k] && !island[k]) { island[k] = 1; islandCells++; } }
      const loops = maskLoops(zone, bw, bh).map((L) => L.map(([gi, gj]) => lift3((gi + bi - M) * h + x0, (gj + bj - M) * h + y0)));
      islands.push({ id: islands.length + 1, kind, rim: rim || undefined, c: cc, r, area, h: hmx, n: npt, inc, m, loops });
    }
  }
  // boundary exclusion distance: inset from the outer contour, openings and (islands excluded) island edges
  let insetZone: Uint8Array | null = null;
  if ((p.inset ?? 0) > 0) { const rr = Math.max(1, Math.round(p.inset! / h)), b0 = new Uint8Array(W * H);
    for (let k = 0; k < W * H; k++) if (!inside[k] || !has[k] || island[k]) b0[k] = 1;
    insetZone = dil(b0, rr); }
  let added = 0, insetDropped = 0; const raised: number[] = [];
  for (let t = 0; t < cand.length; t++) {
    const i = cand[t], d = cd[t], dn = cdn[t], cell = ccell[t];
    if (nrm && dn < -0.2) continue;                                         // facing away: opposite side / overhang
    if (d < 0 && nrm && Math.abs(dn) < cosW && (nearDeep[cell] || nearOpen[cell])) continue; // bore/step wall going down
    if (nrm && dn < cosSlope && (d < 0 ? nearOpen[cell] : nearOuter[cell])) continue; // edge fillet / chamfer / side wall at the outer edge or an opening (normal tilted > 20°)
    if (nrm && d < 0 && dn < cosSlope && nearEdge[cell]) continue;          // wider zone along the outer contour: anything sloping down
    if (raisedZone[cell]) { raised.push(i); if (p.excludeRaised) continue; }
    if (island[cell]) continue;
    if (insetZone && insetZone[cell]) continue;
    sel[i] = 1; added++;
  }
  if (insetZone || islandCells) for (let k = 0; k < seed.length; k++) { const i = seed[k], cell = cy(ys[k]) * W + cx(xs[k]); if ((insetZone && insetZone[cell]) || island[cell]) { if (sel[i]) insetDropped++; sel[i] = 0; } }
  for (let t = 0; t < hc.length; t++) { const i = hc[t]; if (sel[i]) continue; if (island[hcell[t]] || (insetZone && insetZone[hcell[t]])) continue;
    if (rcell[hcell[t]]) { raised.push(i); continue; } // raised feature above the band: shown, not captured
    sel[i] = 1; added++; }                                                    // tip of a tall bump / spatter
  const idx: number[] = []; for (let i = 0; i < N; i++) if (sel[i]) idx.push(i);
  // outer contour loops in 3D (slightly above the plane)
  const lift = 0;
  // contour exactly where the captured points are: cells holding selected points, sampling gaps closed (1 cell)
  const selC = new Uint8Array(W * H);
  for (let i = 0; i < idx.length; i++) { const q = idx[i], dx = pos[3 * q] - c[0], dy = pos[3 * q + 1] - c[1], dz = pos[3 * q + 2] - c[2];
    const ii = cx(dx * u[0] + dy * u[1] + dz * u[2]), jj = cy(dx * v[0] + dy * v[1] + dz * v[2]); if (ii >= 0 && jj >= 0 && ii < W && jj < H) selC[jj * W + ii] = 1; }
  const selD = dil(selC, 1), selInv = new Uint8Array(W * H); for (let k = 0; k < W * H; k++) selInv[k] = selD[k] ? 0 : 1;
  const selE = dil(selInv, 1), selM = new Uint8Array(W * H); for (let k = 0; k < W * H; k++) selM[k] = selE[k] ? 0 : 1;
  for (let k = 0; k < W * H; k++) if (selC[k]) selM[k] = 1;
  const contour = maskLoops(selM, W, H).map((L) => L.map(([gi, gj]) => { const x = (gi - M) * h + x0, y = (gj - M) * h + y0;
    return [c[0] + u[0] * x + v[0] * y + n[0] * lift, c[1] + u[1] * x + v[1] * y + n[1] * lift, c[2] + u[2] * x + v[2] * y + n[2] * lift]; }));
  return { indices: Uint32Array.from(idx), added, cell: h, insideCells, raised: Uint32Array.from(raised), raisedCount: raised.length, contour, islandCells, insetDropped, islands };
}

/** Boundary exclusion distance for a plain region (no outer-contour fill): drop points closer than `inset` mm to the
 *  boundary of the point set in the plane (outer edge and holes) – occupancy grid, closed by one cell. */
export function insetPlane(pos: ArrayLike<number>, idx: ArrayLike<number>, fit: FitResult, inset: number, tris?: ArrayLike<number> | null): Uint32Array {
  if (!(inset > 0) || idx.length < 10) return Uint32Array.from(idx);
  const n = unit(fit.normal), c = fit.center, [u, v] = basis(n), K = idx.length, xs = new Float64Array(K), ys = new Float64Array(K);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k < K; k++) { const i = idx[k], d: Vec3 = [pos[3 * i] - c[0], pos[3 * i + 1] - c[1], pos[3 * i + 2] - c[2]]; const x = dot(d, u), y = dot(d, v); xs[k] = x; ys[k] = y; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  let h = 1.6 * Math.sqrt(Math.max(1e-12, (x1 - x0) * (y1 - y0)) / K); h = Math.min(h, inset / 1.5 || h);
  while (((x1 - x0) / h + 10) * ((y1 - y0) / h + 10) > 4e6) h *= 1.5;
  const M = 3, W = Math.ceil((x1 - x0) / h) + 2 * M, H = Math.ceil((y1 - y0) / h) + 2 * M, cell = (k: number) => (Math.floor((ys[k] - y0) / h) + M) * W + Math.floor((xs[k] - x0) / h) + M;
  const occ = new Uint8Array(W * H); for (let k = 0; k < K; k++) occ[cell(k)] = 1;
  if (tris) { const m = new Uint8Array(pos.length / 3); for (let k = 0; k < K; k++) m[idx[k]] = 1; rasterTris(pos, tris, m, c, u, v, x0, y0, h, M, W, H, occ); }
  // close 1-cell gaps (sampling), then the empty cells are the boundary
  const cl = dilateBox(occ, W, H, 1), er = new Uint8Array(W * H); const inv = new Uint8Array(W * H); for (let k = 0; k < W * H; k++) inv[k] = cl[k] ? 0 : 1;
  const invD = dilateBox(inv, W, H, 1); for (let k = 0; k < W * H; k++) er[k] = invD[k] ? 0 : 1; // closed = erode(dilate)
  const b0 = new Uint8Array(W * H); for (let k = 0; k < W * H; k++) b0[k] = er[k] || occ[k] ? 0 : 1;
  const zone = dilateBox(b0, W, H, Math.max(1, Math.round(inset / h)));
  const out: number[] = []; for (let k = 0; k < K; k++) if (!zone[cell(k)]) out.push(idx[k]);
  return Uint32Array.from(out);
}
