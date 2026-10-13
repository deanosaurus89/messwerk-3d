// Kurvennetz (Flächenrückführung wie PolyWorks|Modeler): Merkmalskurven erkennen (scharfe Kanten, Tangentenlinien von
// Verrundungen über Krümmungswechsel), als kubische B-Splines fitten und auf das Netz legen, Kurvengraph mit T-Stößen
// und daraus resultierende Patch-Aufteilung (Seitenzahl je Patch, 4-seitig bevorzugt).
import type { MeshData } from './mesh';
import type { Vec3 } from './linalg';
import { MeshBVH } from 'three-mesh-bvh';
import * as THREE from 'three';
import { buildBVH } from './polyedit';

export type CurveKind = 'Kante' | 'Tangente' | 'Benutzer';
export interface CurveData { kind: CurveKind; chain: number[]; closed: boolean; ctrl: Vec3[]; pts: Vec3[]; length: number; }
export interface DetectOptions { sharpDeg?: number; flatKappa?: number; binRatio?: number; minLen?: number; smoothRings?: number; minIsland?: number; }
export interface Layout { nodes: { p: Vec3; degree: number; v: number }[]; regionOf: Int32Array; regions: { faces: number; sides: number; area: number }[]; tJunctions: number; foursided: number; }

/** Kantenstruktur: ungerichtete Kanten mit anliegenden Dreiecken. */
export class EdgeGraph {
  nv: number; key: (a: number, b: number) => number; faces = new Map<number, number[]>(); vadj: number[][];
  fn: Float32Array; centroid: Float32Array; el: number;
  constructor(public m: MeshData) {
    const P = m.positions, F = m.indices, nt = F.length / 3; this.nv = P.length / 3; const nv = this.nv;
    this.key = (a, b) => (a < b ? a * nv + b : b * nv + a);
    this.vadj = Array.from({ length: nv }, () => []);
    this.fn = new Float32Array(3 * nt); this.centroid = new Float32Array(3 * nt);
    let el = 0;
    for (let t = 0; t < nt; t++) {
      const a = F[3 * t], b = F[3 * t + 1], c = F[3 * t + 2];
      const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2], vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
      this.fn[3 * t] = nx / l; this.fn[3 * t + 1] = ny / l; this.fn[3 * t + 2] = nz / l;
      for (let k = 0; k < 3; k++) this.centroid[3 * t + k] = (P[3 * a + k] + P[3 * b + k] + P[3 * c + k]) / 3;
      el += Math.hypot(ux, uy, uz);
      for (let k = 0; k < 3; k++) {
        const x = F[3 * t + k], y = F[3 * t + (k + 1) % 3], kk = this.key(x, y); let L = this.faces.get(kk);
        if (!L) { L = []; this.faces.set(kk, L); this.vadj[x].push(y); this.vadj[y].push(x); } L.push(t);
      }
    }
    this.el = el / Math.max(1, nt);
  }
  dist(a: number, b: number) { const P = this.m.positions; return Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]); }
  dihedralCos(kk: number) { const L = this.faces.get(kk)!; if (L.length !== 2) return 1; const [s, t] = L, f = this.fn; return Math.abs(f[3 * s] * f[3 * t] + f[3 * s + 1] * f[3 * t + 1] + f[3 * s + 2] * f[3 * t + 2]); }
  /** Kürzester Kantenweg (Dijkstra), optional mit Bevorzugung markierter Kanten. */
  path(a: number, b: number, cost?: (u: number, v: number) => number): number[] {
    if (a === b) return [a];
    const d = new Map<number, number>(), prev = new Map<number, number>(); d.set(a, 0);
    const H: [number, number][] = [[0, a]];
    const push = (x: [number, number]) => { H.push(x); let i = H.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (H[p][0] <= H[i][0]) break; [H[p], H[i]] = [H[i], H[p]]; i = p; } };
    const pop = () => { const r = H[0], l = H.pop()!; if (H.length) { H[0] = l; let i = 0; for (;;) { const x = 2 * i + 1, y = x + 1; let m = i; if (x < H.length && H[x][0] < H[m][0]) m = x; if (y < H.length && H[y][0] < H[m][0]) m = y; if (m === i) break; [H[m], H[i]] = [H[i], H[m]]; i = m; } } return r; };
    while (H.length) {
      const [du, u] = pop(); if (du > (d.get(u) ?? Infinity)) continue; if (u === b) break;
      for (const v of this.vadj[u]) { const nd = du + (cost ? cost(u, v) : this.dist(u, v)); if (nd < (d.get(v) ?? Infinity)) { d.set(v, nd); prev.set(v, u); push([nd, v]); } }
    }
    if (!prev.has(b)) return [a];
    const out = [b]; let x = b; while (x !== a) { x = prev.get(x)!; out.push(x); } return out.reverse();
  }
}

/** Krümmung je Dreieck [1/mm]: Normalen erst über einige Ringe glätten (nicht über scharfe Kanten – Scanrauschen mittelt sich heraus),
 *  dann Normalenwinkel/Abstand zu Nachbarn, nochmals geglättet. */
export function faceCurvature(g: EdgeGraph, cosSharp: number, rings: number): Float32Array {
  const F = g.m.indices, nt = F.length / 3, C = g.centroid;
  const nbr: number[][] = Array.from({ length: nt }, () => []);
  for (const [kk, L] of g.faces) { if (L.length !== 2 || g.dihedralCos(kk) < cosSharp) continue; nbr[L[0]].push(L[1]); nbr[L[1]].push(L[0]); }
  let N = Float32Array.from(g.fn);
  for (let r = 0; r < Math.max(2, rings + 1); r++) {
    const M = new Float32Array(3 * nt);
    for (let t = 0; t < nt; t++) { let x = N[3 * t], y = N[3 * t + 1], z = N[3 * t + 2]; for (const u of nbr[t]) { const sg = N[3 * t] * N[3 * u] + N[3 * t + 1] * N[3 * u + 1] + N[3 * t + 2] * N[3 * u + 2] < 0 ? -1 : 1; x += sg * N[3 * u]; y += sg * N[3 * u + 1]; z += sg * N[3 * u + 2]; } const l = Math.hypot(x, y, z) || 1; M[3 * t] = x / l; M[3 * t + 1] = y / l; M[3 * t + 2] = z / l; }
    N = M;
  }
  const acc = new Float32Array(nt), cnt = new Float32Array(nt);
  for (let s = 0; s < nt; s++) for (const t of nbr[s]) {
    if (t < s) continue;
    const c = Math.abs(N[3 * s] * N[3 * t] + N[3 * s + 1] * N[3 * t + 1] + N[3 * s + 2] * N[3 * t + 2]);
    const d = Math.hypot(C[3 * s] - C[3 * t], C[3 * s + 1] - C[3 * t + 1], C[3 * s + 2] - C[3 * t + 2]) || 1e-9;
    const k = Math.acos(Math.min(1, c)) / d; acc[s] += k; acc[t] += k; cnt[s]++; cnt[t]++;
  }
  let K = new Float32Array(nt); for (let t = 0; t < nt; t++) K[t] = cnt[t] ? acc[t] / cnt[t] : 0;
  for (let r = 0; r < 2; r++) { const M = new Float32Array(nt); for (let t = 0; t < nt; t++) { let s2 = K[t], n = 1; for (const u of nbr[t]) { s2 += K[u]; n++; } M[t] = s2 / n; } K = M; }
  return K;
}

/** Kanten-Ketten aus markierten Kanten: Knoten = Grad ≠ 2. */
function chains(g: EdgeGraph, edges: Set<number>): { chain: number[]; closed: boolean }[] {
  const adj = new Map<number, number[]>();
  for (const kk of edges) { const a = Math.floor(kk / g.nv), b = kk % g.nv; (adj.get(a) ?? adj.set(a, []).get(a)!).push(b); (adj.get(b) ?? adj.set(b, []).get(b)!).push(a); }
  const used = new Set<number>(); const out: { chain: number[]; closed: boolean }[] = [];
  const walk = (s: number, n: number) => {
    const ch = [s]; let prev = s, cur = n; used.add(g.key(s, n));
    while (true) {
      ch.push(cur); const L = adj.get(cur)!; if (L.length !== 2) break;
      const nx = L[0] === prev ? L[1] : L[0]; const kk = g.key(cur, nx); if (used.has(kk)) break; used.add(kk); prev = cur; cur = nx;
      if (cur === s) { ch.push(cur); break; }
    }
    return ch;
  };
  for (const [v, L] of adj) if (L.length !== 2) for (const w of L) if (!used.has(g.key(v, w))) out.push({ chain: walk(v, w), closed: false });
  for (const [v, L] of adj) for (const w of L) if (!used.has(g.key(v, w))) { const c = walk(v, w); out.push({ chain: c.slice(0, -1).concat(c[0] === c[c.length - 1] ? [c[0]] : []), closed: c[0] === c[c.length - 1] }); }
  return out;
}
const chainLen = (g: EdgeGraph, c: number[]) => { let l = 0; for (let i = 1; i < c.length; i++) l += g.dist(c[i - 1], c[i]); return l; };

// ------------------------------------------------ B-Spline (kubisch, geklemmt, gleichmäßige Knoten)
function basisFuns(n: number, deg: number, u: number, U: number[]): number[] {
  const N = new Array(n).fill(0);
  let span = deg; while (span < n - 1 && U[span + 1] <= u) span++;
  const B = [1]; const left = [0], right = [0];
  for (let j = 1; j <= deg; j++) { left[j] = u - U[span + 1 - j]; right[j] = U[span + j] - u; let saved = 0; for (let r = 0; r < j; r++) { const tmp = B[r] / (right[r + 1] + left[j - r] || 1); B[r] = saved + right[r + 1] * tmp; saved = left[j - r] * tmp; } B[j] = saved; }
  for (let j = 0; j <= deg; j++) N[span - deg + j] = B[j];
  return N;
}
function knots(n: number, deg: number) { const U: number[] = []; for (let i = 0; i <= n + deg; i++) U.push(i <= deg ? 0 : i >= n ? 1 : (i - deg) / (n - deg)); return U; }
export function evalBSpline(ctrl: Vec3[], u: number, deg = 3): Vec3 {
  const n = ctrl.length, d = Math.min(deg, n - 1), N = basisFuns(n, d, Math.min(1 - 1e-12, Math.max(0, u)), knots(n, d));
  const p: Vec3 = [0, 0, 0]; for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) p[k] += N[i] * ctrl[i][k]; return p;
}
/** LSQ-Fit, Endpunkte fest, leichte Glättung (2. Differenzen). */
export function fitBSpline(pts: Vec3[], nCtrl: number, smooth = 1e-3, deg = 3): Vec3[] {
  const m = pts.length; nCtrl = Math.max(deg + 1, Math.min(nCtrl, m)); const d = Math.min(deg, nCtrl - 1);
  if (m <= 2) return pts.slice();
  const t = [0]; for (let i = 1; i < m; i++) t.push(t[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  const L = t[m - 1] || 1; for (let i = 0; i < m; i++) t[i] /= L;
  const U = knots(nCtrl, d); const A = Array.from({ length: nCtrl }, () => new Float64Array(nCtrl)); const B = Array.from({ length: nCtrl }, () => [0, 0, 0]);
  for (let i = 0; i < m; i++) { const N = basisFuns(nCtrl, d, Math.min(1 - 1e-12, t[i]), U); for (let a = 0; a < nCtrl; a++) if (N[a]) { for (let b = 0; b < nCtrl; b++) A[a][b] += N[a] * N[b]; for (let k = 0; k < 3; k++) B[a][k] += N[a] * pts[i][k]; } }
  const w = smooth * m; for (let i = 1; i < nCtrl - 1; i++) { const r = [i - 1, i, i + 1], c = [1, -2, 1]; for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) A[r[x]][r[y]] += w * c[x] * c[y]; }
  // Endpunkte fest
  const fix = (i: number, p: Vec3) => { for (let j = 0; j < nCtrl; j++) A[i][j] = 0; A[i][i] = 1; B[i] = [...p]; };
  fix(0, pts[0]); fix(nCtrl - 1, pts[m - 1]);
  // Gauß-Elimination
  const M = A.map((r, i) => [...r, ...B[i]]); const n = nCtrl;
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; const v = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / v; if (f) for (let k = c; k < n + 3; k++) M[r][k] -= f * M[c][k]; } }
  return M.map((r, i) => [r[n] / (M[i][i] || 1), r[n + 1] / (M[i][i] || 1), r[n + 2] / (M[i][i] || 1)] as Vec3);
}

/** Kette → B-Spline → abgetastet und auf das Netz gelegt. */
export function makeCurve(g: EdgeGraph, bvh: MeshBVH, chain: number[], kind: CurveKind, closed = false): CurveData {
  const P = g.m.positions; const pts: Vec3[] = chain.map((v) => [P[3 * v], P[3 * v + 1], P[3 * v + 2]]);
  const len = chainLen(g, chain);
  const ctrl = fitBSpline(pts, Math.max(4, Math.min(40, Math.round(len / (6 * g.el)))), 1e-3);
  const ns = Math.max(8, Math.min(400, Math.round(len / (0.5 * g.el)))); const out: Vec3[] = []; const q = new THREE.Vector3(), tg: any = {};
  for (let i = 0; i <= ns; i++) { const p = evalBSpline(ctrl, i / ns); q.set(p[0], p[1], p[2]); const h = bvh.closestPointToPoint(q, tg); out.push(h ? [h.point.x, h.point.y, h.point.z] : p); }
  let sl = 0; for (let i = 1; i < out.length; i++) sl += Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1], out[i][2] - out[i - 1][2]);
  return { kind, chain, closed, ctrl, pts: out, length: sl || len };
}

/** Automatische Erkennung: scharfe Kanten + Grenzen zwischen Krümmungsklassen (eben / Radienbänder) = Tangentenlinien. */
export function detectCurves(m: MeshData, o: DetectOptions = {}, g = new EdgeGraph(m), bvh = buildBVH(m)): CurveData[] {
  const cosSharp = Math.cos(((o.sharpDeg ?? 30) * Math.PI) / 180);
  const K = faceCurvature(g, cosSharp, o.smoothRings ?? 4);
  const flat = o.flatKappa ?? 0.04, ratio = o.binRatio ?? 2;
  const cls = (k: number) => (k < flat ? 0 : 1 + Math.floor(Math.log(k / flat) / Math.log(ratio)));
  // Klassen eben/gekrümmt bereinigen: Mehrheitsfilter, dann kleine Inseln umklappen (sonst zerfranste Grenzen)
  const nt = g.m.indices.length / 3; let C = new Uint8Array(nt); for (let t = 0; t < nt; t++) C[t] = cls(K[t]) === 0 ? 0 : 1;
  const nbr: number[][] = Array.from({ length: nt }, () => []);
  for (const [kk, L] of g.faces) if (L.length === 2 && g.dihedralCos(kk) >= cosSharp) { nbr[L[0]].push(L[1]); nbr[L[1]].push(L[0]); }
  for (let it = 0; it < 3; it++) { const D = new Uint8Array(nt); for (let t = 0; t < nt; t++) { let s1 = C[t] ? 1 : 0, n = 1; for (const u of nbr[t]) { s1 += C[u]; n++; } D[t] = 2 * s1 > n ? 1 : 2 * s1 < n ? 0 : C[t]; } C = D; }
  const minIsland = o.minIsland ?? 150;
  for (let pass = 0; pass < 2; pass++) {
    const comp = new Int32Array(nt).fill(-1); let id = 0;
    for (let s0 = 0; s0 < nt; s0++) { if (comp[s0] >= 0) continue; const st = [s0], mem = [s0]; comp[s0] = id;
      while (st.length) { const t = st.pop()!; for (const u of nbr[t]) if (comp[u] < 0 && C[u] === C[s0]) { comp[u] = id; st.push(u); mem.push(u); } }
      if (mem.length < minIsland) for (const t of mem) C[t] = 1 - C[t];
      id++; }
  }
  const marked = new Set<number>(), kindOf = new Map<number, CurveKind>();
  for (const [kk, L] of g.faces) {
    if (L.length !== 2) continue;
    if (g.dihedralCos(kk) < cosSharp) { marked.add(kk); kindOf.set(kk, 'Kante'); continue; }
    if (C[L[0]] !== C[L[1]]) { marked.add(kk); kindOf.set(kk, 'Tangente'); }
  }
  const minLen = o.minLen ?? Math.max(2, 8 * g.el);
  // Lücken schließen: offene Enden mit nahen markierten Knoten (andere Kette) über kürzesten Weg verbinden
  const gap = 5 * g.el;
  for (let pass = 0; pass < 2; pass++) {
    const deg = new Map<number, number>(); for (const kk of marked) { const a = Math.floor(kk / g.nv), b = kk % g.nv; deg.set(a, (deg.get(a) ?? 0) + 1); deg.set(b, (deg.get(b) ?? 0) + 1); }
    const cs = chains(g, marked); const chainOf = new Map<number, number>(); cs.forEach((c, i) => c.chain.forEach((v) => chainOf.set(v, i)));
    for (const [v, d] of deg) {
      if (d !== 1) continue;
      // BFS bis Radius gap
      const dist = new Map<number, number>([[v, 0]]); const q = [v]; let hit = -1, hd = Infinity;
      while (q.length) { const u = q.shift()!; const du = dist.get(u)!; for (const w of g.vadj[u]) { const nd = du + g.dist(u, w); if (nd > gap || nd >= (dist.get(w) ?? Infinity)) continue; dist.set(w, nd); q.push(w);
        if (deg.has(w) && chainOf.get(w) !== chainOf.get(v) && nd < hd) { hd = nd; hit = w; } } }
      if (hit < 0) continue;
      const pth = g.path(v, hit); for (let i = 1; i < pth.length; i++) { const kk = g.key(pth[i - 1], pth[i]); if (!marked.has(kk)) { marked.add(kk); kindOf.set(kk, kindOf.get(g.key(v, g.vadj[v].find((w) => marked.has(g.key(v, w)))!)) ?? 'Tangente'); } }
      deg.set(v, 2);
    }
  }
  // Sporne/Kurzketten iterativ entfernen
  for (let it = 0; it < 4; it++) {
    const cs = chains(g, marked); let ch = false;
    for (const c of cs) if (!c.closed && chainLen(g, c.chain) < minLen) { for (let i = 1; i < c.chain.length; i++) marked.delete(g.key(c.chain[i - 1], c.chain[i])); ch = true; }
    if (!ch) break;
  }
  return chains(g, marked).filter((c) => chainLen(g, c.chain) >= minLen).map((c) => {
    let s = 0; for (let i = 1; i < c.chain.length; i++) if (kindOf.get(g.key(c.chain[i - 1], c.chain[i])) === 'Kante') s++;
    return makeCurve(g, bvh, c.chain, s > (c.chain.length - 1) / 2 ? 'Kante' : 'Tangente', c.closed);
  });
}

/** Patch-Aufteilung: Flächen entlang der Kurvenketten trennen, Knoten = Grad ≠ 2 (T-Stoß = 3), Seiten = Knoten am Patchrand. */
export function layout(g: EdgeGraph, curves: { chain: number[] }[]): Layout {
  const F = g.m.indices, nt = F.length / 3, P = g.m.positions;
  const cut = new Set<number>(); const deg = new Map<number, number>();
  for (const c of curves) for (let i = 1; i < c.chain.length; i++) { const kk = g.key(c.chain[i - 1], c.chain[i]); if (cut.has(kk) || c.chain[i - 1] === c.chain[i]) continue; cut.add(kk); for (const v of [c.chain[i - 1], c.chain[i]]) deg.set(v, (deg.get(v) ?? 0) + 1); }
  const nodes: Layout['nodes'] = []; const isNode = new Set<number>();
  for (const [v, d] of deg) if (d !== 2) { nodes.push({ v, degree: d, p: [P[3 * v], P[3 * v + 1], P[3 * v + 2]] }); isNode.add(v); }
  const regionOf = new Int32Array(nt).fill(-1); const regions: Layout['regions'] = [];
  const tnb: number[][] = Array.from({ length: nt }, () => []);
  for (const [kk, L] of g.faces) if (L.length === 2 && !cut.has(kk)) { tnb[L[0]].push(L[1]); tnb[L[1]].push(L[0]); }
  for (let s = 0; s < nt; s++) {
    if (regionOf[s] >= 0) continue; const id = regions.length; const st = [s]; regionOf[s] = id; let n = 0, area = 0; const corner = new Set<number>();
    while (st.length) { const t = st.pop()!; n++;
      const a = F[3 * t], b = F[3 * t + 1], c = F[3 * t + 2];
      area += 0.5 * Math.hypot(...((): [number, number, number] => { const u = [P[3 * b] - P[3 * a], P[3 * b + 1] - P[3 * a + 1], P[3 * b + 2] - P[3 * a + 2]], w = [P[3 * c] - P[3 * a], P[3 * c + 1] - P[3 * a + 1], P[3 * c + 2] - P[3 * a + 2]]; return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; })());
      for (const v of [a, b, c]) if (isNode.has(v)) corner.add(v);
      for (const u of tnb[t]) if (regionOf[u] < 0) { regionOf[u] = id; st.push(u); } }
    regions.push({ faces: n, sides: corner.size, area });
  }
  return { nodes, regionOf, regions, tJunctions: nodes.filter((x) => x.degree === 3).length, foursided: regions.filter((r) => r.sides === 4).length };
}

/** Benutzerkurve: Klickpunkte (Knoten) über kürzeste Kantenwege verbinden. */
export function pathThrough(g: EdgeGraph, verts: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < verts.length; i++) { const p = g.path(verts[i - 1], verts[i]); if (out.length) p.shift(); out.push(...p); }
  return out.length ? out : verts.slice();
}
