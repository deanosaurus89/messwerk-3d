// 0.33 (Martin 19.10. 15:49): frozen boundary of a plane feature. On ✓ (create) the boundary of the final selection –
// union of all selected/added regions after island edits – is frozen: its edge loops, in the plane frame (u,v).
// Re-extraction then searches exactly inside that boundary, offset by the boundary exclusion distance (holes / masked
// interior areas of the selection are boundary loops too, so they get the same offset). Stored in the feature's Ist.
import type { FitResult } from './fit';
import { Vec3, basis, dot, sub, unit } from './linalg';
import { selectionLoops } from './boundary';

export interface FrozenBoundary { o: Vec3; n: Vec3; u: Vec3; v: Vec3; /** closed loops, flat [u0,v0,u1,v1,…] [mm] */ loops: number[][]; /** median edge [mm] */ h: number; /** search distance ± used at creation [mm] (default of a later re-extraction) */ band?: number }

const P3 = (pos: ArrayLike<number>, i: number): Vec3 => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

export function freezeBoundary(fit: FitResult, pos: ArrayLike<number>, tris: ArrayLike<number>, idx: ArrayLike<number>): FrozenBoundary | null {
  if (fit.type !== 'Ebene' || idx.length < 3) return null;
  const n = unit(fit.normal), o = fit.center, [u, v] = basis(n);
  const L = selectionLoops(tris, idx, pos.length / 3); if (!L.length) return null;
  let loops: number[][] = []; const edges: number[] = [];
  for (const lp of L) { const a: number[] = [];
    for (const k of lp) { const w = sub(P3(pos, k), o); a.push(r4(dot(w, u)), r4(dot(w, v))); }
    for (let i = 0; i < a.length; i += 2) { const j = (i + 2) % a.length; edges.push(Math.hypot(a[j] - a[i], a[j + 1] - a[i + 1])); }
    loops.push(a); }
  edges.sort((x, y) => x - y); const h = edges[edges.length >> 1] ?? 0.5;
  loops = realLoops(loops, h);
  return { o: [...o] as Vec3, n: [...n] as Vec3, u: [...u] as Vec3, v: [...v] as Vec3, loops, h };
}

const loopArea = (l: number[]) => { let a = 0; for (let i = 0; i < l.length; i += 2) { const j = (i + 2) % l.length; a += l[i] * l[j + 1] - l[j] * l[i + 1]; } return Math.abs(a) / 2; };
const loopLen = (l: number[]) => { let s = 0; for (let i = 0; i < l.length; i += 2) { const j = (i + 2) % l.length; s += Math.hypot(l[j] - l[i], l[j + 1] - l[i + 1]); } return s; };
/** 0.36 (Martin 19.10.): eingefroren werden nur die Außenkontur und echte Inseln – Schleife mit Fläche ≥ max(0,25 mm², 4·h²)
 *  und mittlerer Breite (2·Fläche/Umfang) ≥ 0,5·h. Dünne Splitter (z. B. um einzelne nicht gewählte Punkte) gehören nicht dazu. */
export function realLoops(loops: number[][], h: number): number[][] {
  if (loops.length <= 1) return loops;
  const A = loops.map(loopArea); let outer = 0; for (let i = 1; i < A.length; i++) if (A[i] > A[outer]) outer = i;
  return loops.filter((l, i) => i === outer || (A[i] >= Math.max(0.25, 4 * h * h) && (2 * A[i]) / Math.max(1e-9, loopLen(l)) >= 0.5 * h));
}
/** occupancy grid of the frozen boundary (even-odd fill of all loops), optionally offset by off [mm] (< 0 shrinks) */
export function frozenCells(F: FrozenBoundary, off = 0) {
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const l of F.loops) for (let i = 0; i < l.length; i += 2) { a0 = Math.min(a0, l[i]); a1 = Math.max(a1, l[i]); b0 = Math.min(b0, l[i + 1]); b1 = Math.max(b1, l[i + 1]); }
  let h = Math.min(0.5, Math.max(0.05, 0.5 * F.h));
  const ext = Math.max(0, off) + 2 * h;
  while (((a1 - a0 + 2 * ext) / h + 4) * ((b1 - b0 + 2 * ext) / h + 4) > 4e6) h *= 1.4;
  const pad = Math.ceil(Math.max(0, off) / h) + 2, i0 = Math.floor(a0 / h) - pad, j0 = Math.floor(b0 / h) - pad, W = Math.ceil(a1 / h) + pad - i0 + 1, H = Math.ceil(b1 / h) + pad - j0 + 1;
  let cells = new Uint8Array(W * H);
  // scanline even-odd fill at cell centres
  const segs: number[] = []; for (const l of F.loops) for (let i = 0; i < l.length; i += 2) { const j = (i + 2) % l.length; segs.push(l[i], l[i + 1], l[j], l[j + 1]); }
  const rows: number[][] = Array.from({ length: H }, () => []);
  for (let s = 0; s < segs.length; s += 4) { const ax = segs[s], ay = segs[s + 1], bx = segs[s + 2], by = segs[s + 3]; if (ay === by) continue;
    const lo = Math.min(ay, by), hi = Math.max(ay, by);
    for (let j = Math.max(0, Math.ceil(lo / h - 0.5) - j0); j < H; j++) { const y = (j + j0 + 0.5) * h; if (y >= hi) break; if (y < lo) continue; rows[j].push(ax + ((y - ay) / (by - ay)) * (bx - ax)); } }
  for (let j = 0; j < H; j++) { const xs = rows[j].sort((x, y) => x - y);
    for (let k = 0; k + 1 < xs.length; k += 2) { const s0 = Math.max(0, Math.ceil(xs[k] / h - 0.5) - i0), s1 = Math.min(W - 1, Math.floor(xs[k + 1] / h - 0.5) - i0); for (let i = s0; i <= s1; i++) cells[j * W + i] = 1; } }
  // the boundary cells themselves belong to the zone (points on the edge), then the constant offset
  for (let s = 0; s < segs.length; s += 4) { const L = Math.hypot(segs[s + 2] - segs[s], segs[s + 3] - segs[s + 1]), m = Math.max(1, Math.ceil(L / (0.5 * h)));
    for (let t = 0; t <= m; t++) { const x = segs[s] + ((segs[s + 2] - segs[s]) * t) / m, y = segs[s + 1] + ((segs[s + 3] - segs[s + 1]) * t) / m; const i = Math.floor(x / h) - i0, j = Math.floor(y / h) - j0; if (i >= 0 && j >= 0 && i < W && j < H) cells[j * W + i] = 1; } }
  const dil = (src: Uint8Array, r: number) => { const out = new Uint8Array(src.length);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (src[j * W + i]) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < W && jj < H && di * di + dj * dj <= r * r + 0.5) out[jj * W + ii] = 1; }
    return out; };
  const r = Math.round(Math.abs(off) / h);
  if (off > 0 && r > 0) cells = dil(cells, r);
  else if (off < 0 && r > 0) { const inv = new Uint8Array(W * H); for (let k = 0; k < W * H; k++) inv[k] = cells[k] ? 0 : 1; const g = dil(inv, r); for (let k = 0; k < W * H; k++) cells[k] = cells[k] && !g[k] ? 1 : 0; }
  return { h, i0, j0, w: W, hgt: H, cells };
}

/** exact membership test of the frozen boundary (no raster): a point (projected into the frozen frame) belongs to the
 *  zone if it is inside the loops (even-odd) – or on them (≤ ε) – and, with an exclusion distance, at least that far
 *  from every loop edge (outer contour and masked interior areas alike). off > 0 grows the zone outward. */
/** 0.35: why a frozen POINT SET (frozenIdx) and not only the polygon: the loops are the projected 3D selection edges –
 *  at a rounded rim the mesh folds, so the projected loops zigzag, overlap and contain hundreds of sliver hole loops
 *  around single non-selected rim vertices. A pure position test (inside polygon + within search distance) then took
 *  805 fillet/rim vertices (≤ 0.03 mm inside the zigzag edge, normals mostly > 30°) and lost 344 selected ones
 *  (outside by projection / parity flips of overlapping loops) on the demo top plane: +1.3 %. With setOnly the
 *  candidates are the frozen vertices themselves; the polygon only measures the exclusion distance. */
export function frozenTester(F: FrozenBoundary, d: number, off = 0, setOnly = false) {
  const segs: number[] = []; let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const l of F.loops) for (let i = 0; i < l.length; i += 2) { const j = (i + 2) % l.length; segs.push(l[i], l[i + 1], l[j], l[j + 1]);
    a0 = Math.min(a0, l[i]); a1 = Math.max(a1, l[i]); b0 = Math.min(b0, l[i + 1]); b1 = Math.max(b1, l[i + 1]); }
  const eps = 1e-3, // loop vertices are the selected vertices themselves (distance 0)
    R = Math.max(eps, Math.abs(off)), g = Math.max(2 * F.h, 0.5, Math.hypot(a1 - a0, b1 - b0) / 300);
  const nx = Math.max(1, Math.ceil((a1 - a0 + 2 * R) / g) + 1), ny = Math.max(1, Math.ceil((b1 - b0 + 2 * R) / g) + 1), ox = a0 - R, oy = b0 - R;
  const cells = new Map<number, number[]>(), rows: number[][] = Array.from({ length: ny }, () => []);
  for (let s = 0; s < segs.length; s += 4) {
    const x0 = Math.min(segs[s], segs[s + 2]), x1 = Math.max(segs[s], segs[s + 2]), y0 = Math.min(segs[s + 1], segs[s + 3]), y1 = Math.max(segs[s + 1], segs[s + 3]);
    const i0 = Math.floor((x0 - ox) / g), i1 = Math.floor((x1 - ox) / g), j0 = Math.floor((y0 - oy) / g), j1 = Math.floor((y1 - oy) / g);
    for (let j = j0; j <= j1; j++) { rows[j]?.push(s); for (let i = i0; i <= i1; i++) { const k = j * nx + i; const c = cells.get(k); if (c) c.push(s); else cells.set(k, [s]); } }
  }
  const segDist = (s: number, x: number, y: number) => { const ax = segs[s], ay = segs[s + 1], bx = segs[s + 2] - ax, by = segs[s + 3] - ay, L = bx * bx + by * by;
    const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by) / L)) : 0; return Math.hypot(x - ax - t * bx, y - ay - t * by); };
  const minDist = (x: number, y: number, r: number) => { let best = Infinity; const ci = Math.floor((x - ox) / g), cj = Math.floor((y - oy) / g), k = Math.ceil(r / g);
    for (let j = cj - k; j <= cj + k; j++) for (let i = ci - k; i <= ci + k; i++) { const c = cells.get(j * nx + i); if (c) for (const s of c) best = Math.min(best, segDist(s, x, y)); } return best; };
  const inside = (x: number, y: number) => { const j = Math.floor((y - oy) / g); const r = rows[j]; if (!r) return false; let w = false;
    for (const s of r) { const ay = segs[s + 1], by = segs[s + 3]; if ((ay > y) !== (by > y) && x < segs[s] + ((y - ay) / (by - ay)) * (segs[s + 2] - segs[s])) w = !w; } return w; };
  const { o, n, u, v } = F;
  return (q: [number, number, number]) => {
    const w0 = q[0] - o[0], w1 = q[1] - o[1], w2 = q[2] - o[2];
    const x = w0 * u[0] + w1 * u[1] + w2 * u[2], y = w0 * v[0] + w1 * v[1] + w2 * v[2];
    // 0.35 / 0.41: a frozen vertex is already in the creation set. Exclusion 0 keeps every one of them.
    // The search distance must not drop points that sit slightly off the refined plane (the creation band is tighter
    // than that). A positive exclusion distance only measures in-plane distance to the frozen loops.
    if (setOnly) return off < 0 ? minDist(x, y, -off) >= -off : true;
    if (Math.abs(w0 * n[0] + w1 * n[1] + w2 * n[2]) > d) return false;
    if (x < ox - g || x > ox + nx * g || y < oy - g || y > oy + ny * g) return false;
    const inn = inside(x, y);
    if (off < 0) return inn && minDist(x, y, -off) >= -off;
    if (inn) return true;
    return minDist(x, y, R) <= R; // on the loops (ε) or within the outward offset
  };
}
