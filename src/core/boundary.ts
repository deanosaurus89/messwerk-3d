// Smoothed boundary DISPLAY of a feature (Phase 1, step 4): the boundary of the selected triangles is a zigzag along
// the mesh edges. It is chained into closed loops, projected onto the fitted surface and smoothed (Taubin λ|μ, every
// point stays within the smoothing tolerance of its original position, so corners round off by at most that much).
// Display only – never used for any fit or evaluation.
import type { FitResult } from './fit';
import type { Vec3 } from './linalg';
import { projectOnto } from './trim';

/** default smoothing tolerance: 0.7 × median boundary edge length, at most 0.5 mm (0.5 × edge left a visible
 *  staircase on regular meshes – the zigzag amplitude of a triangle boundary is about half to two thirds of an edge) */
export const SMOOTH_FACTOR = 0.7, SMOOTH_MAX = 0.5;

/** boundary loops (vertex indices) of the triangles whose 3 vertices are all in `verts` (or of the listed triangles) */
export function selectionLoops(tris: ArrayLike<number>, verts: ArrayLike<number>, nVerts: number): number[][] {
  const inSet = new Uint8Array(nVerts); for (let k = 0; k < verts.length; k++) inSet[verts[k]] = 1;
  const cnt = new Map<number, number>(), dir = new Map<number, number>(), K = nVerts + 1;
  for (let t = 0; t < tris.length / 3; t++) {
    const a = tris[3 * t], b = tris[3 * t + 1], c = tris[3 * t + 2]; if (!inSet[a] || !inSet[b] || !inSet[c]) continue;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) { const key = p < q ? p * K + q : q * K + p; cnt.set(key, (cnt.get(key) ?? 0) + 1); dir.set(key, p * K + q); }
  }
  const next = new Map<number, number[]>();
  for (const [key, c] of cnt) if (c === 1) { const d = dir.get(key)!, p = Math.floor(d / K), q = d % K; const l = next.get(p); if (l) l.push(q); else next.set(p, [q]); }
  const loops: number[][] = [];
  for (const start of next.keys()) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const L = [start]; let v = start;
      for (let guard = 0; guard < 4e6; guard++) { const l = next.get(v); if (!l || !l.length) break; const w = l.pop()!; if (w === start) break; L.push(w); v = w; }
      if (L.length >= 3) loops.push(L);
    }
  }
  return loops;
}

const d3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** median segment length of a closed loop */
export function medianEdge(L: Vec3[]): number { const e = L.map((p, i) => d3(p, L[(i + 1) % L.length])).sort((a, b) => a - b); return e[e.length >> 1] ?? 0; }
/** auto tolerance for a loop */
export const autoTol = (L: Vec3[]) => Math.min(SMOOTH_MAX, SMOOTH_FACTOR * medianEdge(L));

/** Taubin smoothing of a closed polyline; each point stays within `tol` of its original position; optional reprojection */
export function smoothLoop(L: Vec3[], tol: number, onto?: (p: Vec3) => Vec3, iterations = 12): Vec3[] {
  const n = L.length; if (n < 4 || !(tol > 0)) return L.map((p) => [...p] as Vec3);
  let P = L.map((p) => [...p] as Vec3);
  const step = (w: number) => { const Q: Vec3[] = new Array(n);
    for (let i = 0; i < n; i++) { const a = P[(i + n - 1) % n], b = P[i], c = P[(i + 1) % n]; Q[i] = [0, 1, 2].map((k) => b[k] + w * ((a[k] + c[k]) / 2 - b[k])) as Vec3; }
    P = Q; };
  for (let it = 0; it < iterations; it++) {
    step(0.6); step(-0.62);
    for (let i = 0; i < n; i++) { let p = onto ? onto(P[i]) : P[i]; const o = L[i], d = d3(p, o); if (d > tol) { const s = tol / d; p = [o[0] + (p[0] - o[0]) * s, o[1] + (p[1] - o[1]) * s, o[2] + (p[2] - o[2]) * s]; } P[i] = p; }
  }
  return P;
}
/** total absolute turning angle of a closed loop (rad) – 2π for a convex smooth curve, large for a zigzag */
export function turning(L: Vec3[]): number {
  let s = 0; const n = L.length;
  for (let i = 0; i < n; i++) { const a = L[(i + n - 1) % n], b = L[i], c = L[(i + 1) % n];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]], lu = Math.hypot(...u), lv = Math.hypot(...v);
    if (lu < 1e-12 || lv < 1e-12) continue; s += Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv)))); }
  return s;
}
/** loops → line segments (Float32Array of point pairs) */
export function loopSegments(loops: Vec3[][]): Float32Array {
  let m = 0; for (const L of loops) m += L.length; const out = new Float32Array(m * 6); let o = 0;
  for (const L of loops) for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; out[o++] = a[0]; out[o++] = a[1]; out[o++] = a[2]; out[o++] = b[0]; out[o++] = b[1]; out[o++] = b[2]; }
  return out;
}
/**
 * Smoothed boundary of a feature's selection on its fitted surface. tol = null → automatic per loop (0.7 × median edge,
 * ≤ 0.5 mm); 0 → no smoothing (raw projected triangle boundary).
 */
export function smoothedBoundary(f: FitResult | null, pos: ArrayLike<number>, tris: ArrayLike<number>, verts: ArrayLike<number>, tol: number | null = null): Vec3[][] {
  const loops = selectionLoops(tris, verts, pos.length / 3);
  const onto = f ? (p: Vec3) => projectOnto(f, p) : undefined;
  return loops.map((L) => { const P = L.map((v) => { const p: Vec3 = [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]]; return onto ? onto(p) : p; });
    const t = tol == null ? autoTol(P) : tol; return t > 0 ? smoothLoop(P, t, onto) : P; });
}
/** smooth already ordered loops (e.g. grid contours of All inside boundary) with the given tolerance */
export function smoothLoops(loops: number[][][], tol: number, onto?: (p: Vec3) => Vec3): Vec3[][] {
  return loops.map((L) => smoothLoop(L as Vec3[], tol, onto));
}

const P3 = (pos: ArrayLike<number>, i: number): Vec3 => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
const centroid = (L: Vec3[]): Vec3 => {
  const c: Vec3 = [0, 0, 0];
  for (const p of L) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  const n = L.length || 1;
  return [c[0] / n, c[1] / n, c[2] / n];
};
/** Newell area of a closed loop (works for a mildly non-planar mesh ring). */
export function loopArea3(L: Vec3[]): number {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < L.length; i++) {
    const a = L[i], b = L[(i + 1) % L.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return 0.5 * Math.hypot(nx, ny, nz);
}
/**
 * Boundary of the selected triangles as the mesh edges themselves: vertex positions, no projection
 * and no Taubin smoothing. One closed loop per boundary chain.
 */
export function rawLoops(pos: ArrayLike<number>, tris: ArrayLike<number>, verts: ArrayLike<number>): Vec3[][] {
  return selectionLoops(tris, verts, pos.length / 3).map((L) => L.map((v) => P3(pos, v)));
}
export interface HoleLoop { c: Vec3; r: number; area: number; loop: Vec3[] }
/**
 * Inner boundary loops of a selection (holes / islands). The largest loop is the outer contour and is not an island.
 * Tiny slivers (under 0.25 mm² or fewer than 6 vertices) are ignored.
 */
export function selectionHoles(pos: ArrayLike<number>, tris: ArrayLike<number>, verts: ArrayLike<number>): HoleLoop[] {
  const loops = rawLoops(pos, tris, verts).filter((L) => L.length >= 3);
  if (loops.length < 2) return [];
  const areas = loops.map(loopArea3);
  let outer = 0;
  for (let i = 1; i < areas.length; i++) if (areas[i] > areas[outer]) outer = i;
  const out: HoleLoop[] = [];
  loops.forEach((L, i) => {
    if (i === outer || L.length < 6 || areas[i] < 0.25) return;
    const c = centroid(L);
    let r = 0;
    for (const p of L) r = Math.max(r, d3(p, c));
    out.push({ c, r, area: areas[i], loop: L });
  });
  return out;
}
export interface SealMark { c: number[]; r: number }
const nearSeal = (c: Vec3, seals: SealMark[]) => seals.some((s) => d3(c, s.c as Vec3) < Math.max(1.5, (s.r || 0) * 1.6));
/** Keep the outer contour. Drop inner loops whose centre matches a dismissed island. */
export function dropSealedLoops(loops: Vec3[][], seals: SealMark[]): Vec3[][] {
  if (!seals.length || loops.length < 2) return loops;
  const areas = loops.map(loopArea3);
  let outer = 0;
  for (let i = 1; i < areas.length; i++) if (areas[i] > areas[outer]) outer = i;
  return loops.filter((L, i) => i === outer || !nearSeal(centroid(L), seals));
}
/**
 * Triangle fans that close dismissed openings. Each fan vertex is projected onto the fitted surface,
 * so a hole in a cylinder, cone, sphere or torus is filled in the geometry (not only hidden).
 */
export function openingFans(fit: FitResult, loops: Vec3[][], seals: SealMark[]): Float32Array {
  if (!seals.length || !fit || loops.length < 2) return new Float32Array(0);
  const onto = (p: Vec3) => projectOnto(fit, p);
  const areas = loops.map(loopArea3);
  let outer = 0;
  for (let i = 1; i < areas.length; i++) if (areas[i] > areas[outer]) outer = i;
  const out: number[] = [];
  loops.forEach((L, li) => {
    if (li === outer || L.length < 3) return;
    const c0 = centroid(L);
    if (!nearSeal(c0, seals)) return;
    const c = onto(c0);
    for (let i = 0; i < L.length; i++) {
      const a = onto(L[i]), b = onto(L[(i + 1) % L.length]);
      out.push(c[0], c[1], c[2], a[0], a[1], a[2], b[0], b[1], b[2]);
    }
  });
  return new Float32Array(out);
}
