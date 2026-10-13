// Kurvennetz (Flächenrückführung wie PolyWorks|Modeler): Merkmalskurven erkennen (scharfe Kanten, Tangentenlinien von
// Verrundungen über Krümmungswechsel), als kubische B-Splines fitten und auf das Netz legen, Kurvengraph mit T-Stößen
// und daraus resultierende Patch-Aufteilung (Seitenzahl je Patch, 4-seitig bevorzugt).
import type { MeshData } from './mesh';
import type { Vec3 } from './linalg';
import { MeshBVH } from 'three-mesh-bvh';
import * as THREE from 'three';
import { buildBVH } from './polyedit';

export type CurveKind = 'Kante' | 'Tangente' | 'Übergang' | 'Benutzer' | 'Vorschlag';
export interface CurveData { kind: CurveKind; chain: number[]; closed: boolean; ctrl: Vec3[]; pts: Vec3[]; length: number; }
export interface DetectOptions { sharpDeg?: number; flatKappa?: number; binRatio?: number; minLen?: number; smoothRings?: number; minIsland?: number; }
export interface Layout { nodes: { p: Vec3; degree: number; v: number }[]; corners: { v: number; kind: 'Knick' | 'Auto' | 'Knoten'; p: Vec3 }[]; regionOf: Int32Array;
  regions: { faces: number; sides: number; loops: number; area: number; center: Vec3 }[]; suggestions: { chain: number[]; reason: string; region: number }[]; tJunctions: number; foursided: number; }

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
    // Maximum über die Nachbarn ≈ größte Hauptkrümmung (Mittelwert würde Kanten in Krümmungs-Nullrichtung mitzählen)
    const k = Math.acos(Math.min(1, c)) / d; if (k > acc[s]) acc[s] = k; if (k > acc[t]) acc[t] = k; cnt[s]++; cnt[t]++;
  }
  // Kalibrierung: Schwerpunktabstand/geglättete Normalen unterschätzen κ (Zylinder-Gitter R5/R15: Faktor ≈ 0,585)
  let K = new Float32Array(nt); for (let t = 0; t < nt; t++) K[t] = acc[t] * 1.71;
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

/**
 * Krümmungssegmentierung (Betrag der Krümmung): Regionenwachstum über nicht-scharfe Kanten; ein Nachbar gehört zur Region,
 * wenn beide eben sind oder sein κ um weniger als binRatio vom Regionsmittel abweicht. Kleine Regionen werden mit dem
 * Nachbarn mit der längsten gemeinsamen Grenze verschmolzen. Liefert Region je Dreieck + Mittelwert je Region.
 */
export function segmentCurvature(g: EdgeGraph, K: Float32Array, cosSharp: number, flat: number, ratio: number, minIsland: number) {
  const nt = g.m.indices.length / 3;
  const nbr: number[][] = Array.from({ length: nt }, () => []);
  for (const [kk, L] of g.faces) if (L.length === 2 && g.dihedralCos(kk) >= cosSharp) { nbr[L[0]].push(L[1]); nbr[L[1]].push(L[0]); }
  // Saat-Reihenfolge: glatteste Krümmung zuerst (Regionsinneres)
  const grad = new Float32Array(nt), lk = (k: number) => Math.log(Math.max(k, flat * 0.5));
  for (let t = 0; t < nt; t++) { let m = 0; for (const u of nbr[t]) m = Math.max(m, Math.abs(lk(K[t]) - lk(K[u]))); grad[t] = m; }
  const order = Array.from({ length: nt }, (_, i) => i).sort((x, y) => grad[x] - grad[y]);
  const reg = new Int32Array(nt).fill(-1); const mean: number[] = []; const size: number[] = []; const lr = Math.log(ratio);
  for (const s0 of order) {
    if (reg[s0] >= 0) continue; const id = mean.length; const fl = K[s0] < flat; let sum = K[s0], n = 1; reg[s0] = id; const st = [s0];
    while (st.length) { const t = st.pop()!; for (const u of nbr[t]) { if (reg[u] >= 0) continue; const m = sum / n;
      const ok = fl ? K[u] < flat : K[u] >= flat && Math.abs(Math.log(K[u] / m)) < lr; if (!ok) continue; reg[u] = id; sum += K[u]; n++; st.push(u); } }
    mean.push(sum / n); size.push(n);
  }
  // kleine Regionen verschmelzen (mehrere Runden)
  for (let pass = 0; pass < 6; pass++) {
    let changed = false; const border = new Map<number, Map<number, number>>();
    for (let t = 0; t < nt; t++) for (const u of nbr[t]) if (reg[u] !== reg[t] && size[reg[t]] < minIsland) { const m = border.get(reg[t]) ?? border.set(reg[t], new Map()).get(reg[t])!; m.set(reg[u], (m.get(reg[u]) ?? 0) + 1); }
    const target = new Map<number, number>();
    for (const [r, m] of border) { let best = -1, bc = 0; for (const [q, c] of m) if (c > bc || (c === bc && size[q] > size[best])) { bc = c; best = q; } if (best >= 0) target.set(r, best); }
    for (let t = 0; t < nt; t++) { const to = target.get(reg[t]); if (to !== undefined && !(target.get(to) === reg[t] && size[to] < size[reg[t]])) { size[to]++; size[reg[t]]--; reg[t] = to; changed = true; } }
    if (!changed) break;
  }
  // Mittelwerte neu
  const acc = new Float64Array(mean.length), cnt = new Float64Array(mean.length); for (let t = 0; t < nt; t++) { acc[reg[t]] += K[t]; cnt[reg[t]]++; }
  for (let r = 0; r < mean.length; r++) mean[r] = cnt[r] ? acc[r] / cnt[r] : 0;
  return { reg, mean, flat };
}

export interface CleanOptions { mergeDeg?: number; minLen?: number; gap?: number; gapAngleDeg?: number; dangling?: number; }
/** Aufräumen: kurze/lose Kettenstücke entfernen, fluchtende Fragmente über Lücken verbinden. */
function cleanup(g: EdgeGraph, marked: Set<number>, kindOf: Map<number, CurveKind>, o: CleanOptions) {
  const minLen = o.minLen ?? Math.max(2, 8 * g.el), gap = o.gap ?? 6 * g.el, dang = o.dangling ?? 2 * minLen, cosG = Math.cos(((o.gapAngleDeg ?? 35) * Math.PI) / 180);
  const P = g.m.positions; const pt = (v: number): Vec3 => [P[3 * v], P[3 * v + 1], P[3 * v + 2]];
  const degree = () => { const d = new Map<number, number>(); for (const kk of marked) { const a = Math.floor(kk / g.nv), b = kk % g.nv; d.set(a, (d.get(a) ?? 0) + 1); d.set(b, (d.get(b) ?? 0) + 1); } return d; };
  const drop = (c: number[]) => { for (let i = 1; i < c.length; i++) marked.delete(g.key(c[i - 1], c[i])); };
  const prune = () => {
    for (let it = 0; it < 6; it++) {
      const d = degree(); let ch = false;
      for (const c of chains(g, marked)) { const L = chainLen(g, c.chain); const e0 = d.get(c.chain[0]) === 1, e1 = d.get(c.chain[c.chain.length - 1]) === 1;
        if ((c.closed && L < minLen * 2) || (!c.closed && L < minLen && (e0 || e1)) || (!c.closed && L < dang && e0 !== e1) || (!c.closed && e0 && e1 && L < minLen * 1.5)) { drop(c.chain); ch = true; } }
      if (!ch) break;
    }
  };
  prune();
  // Lückenschluss mit Richtungsprüfung (Endtangente zeigt auf das Ziel)
  for (let pass = 0; pass < 2; pass++) {
    const d = degree(); const cs = chains(g, marked); const chainOf = new Map<number, number>(); cs.forEach((c, i) => c.chain.forEach((v) => chainOf.set(v, i)));
    for (const c of cs) for (const end of [0, 1]) {
      const ch = end ? c.chain.slice().reverse() : c.chain; const v = ch[0]; if (d.get(v) !== 1) continue;
      // Richtung: von Punkt ~3 el innen zum Ende
      let k = 0, acc = 0; while (k < ch.length - 1 && acc < 3 * g.el) { acc += g.dist(ch[k], ch[k + 1]); k++; }
      const pv = pt(v), pi = pt(ch[k]); const dir = [pv[0] - pi[0], pv[1] - pi[1], pv[2] - pi[2]]; const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const dist = new Map<number, number>([[v, 0]]); const q = [v]; let hit = -1, hd = Infinity;
      while (q.length) { const u = q.shift()!; const du = dist.get(u)!; for (const w of g.vadj[u]) { const nd = du + g.dist(u, w); if (nd > gap || nd >= (dist.get(w) ?? Infinity)) continue; dist.set(w, nd); q.push(w);
        if (d.has(w) && chainOf.get(w) !== chainOf.get(v)) { const pw = pt(w); const t = [pw[0] - pv[0], pw[1] - pv[1], pw[2] - pv[2]]; const tl = Math.hypot(t[0], t[1], t[2]) || 1;
          if ((t[0] * dir[0] + t[1] * dir[1] + t[2] * dir[2]) / (tl * dl) > cosG && nd < hd) { hd = nd; hit = w; } } } }
      if (hit < 0) continue;
      const kind = kindOf.get(g.key(ch[0], ch[1])) ?? 'Tangente';
      const pth = g.path(v, hit); for (let i = 1; i < pth.length; i++) { const kk = g.key(pth[i - 1], pth[i]); if (!marked.has(kk)) { marked.add(kk); kindOf.set(kk, kind); } }
      d.set(v, 2);
    }
  }
  prune();
}

/** Fluchtende Ketten an Knoten zu einer Kurve verbinden (Kurve läuft durch den T-Stoß weiter), gleicher Typ, Knick < maxDeg. */
function mergeCollinear(g: EdgeGraph, cs: { chain: number[]; closed: boolean }[], maxDeg: number, kindOf: Map<number, CurveKind>) {
  const P = g.m.positions; const cosM = Math.cos((maxDeg * Math.PI) / 180);
  const kindC = (c: number[]) => kindOf.get(g.key(c[0], c[1])) ?? 'Tangente';
  // Richtung am Ende (vom Knoten weg), über ~4 el
  const dirAt = (c: number[], fromStart: boolean) => { const ch = fromStart ? c : c.slice().reverse(); let k = 0, a = 0; while (k < ch.length - 1 && a < 4 * g.el) { a += g.dist(ch[k], ch[k + 1]); k++; }
    const d = [P[3 * ch[k]] - P[3 * ch[0]], P[3 * ch[k] + 1] - P[3 * ch[0] + 1], P[3 * ch[k] + 2] - P[3 * ch[0] + 2]]; const l = Math.hypot(d[0], d[1], d[2]) || 1; return d.map((x) => x / l); };
  let list = cs.map((c) => ({ ...c, alive: true }));
  for (let it = 0; it < 50; it++) {
    const at = new Map<number, { i: number; start: boolean }[]>();
    list.forEach((c, i) => { if (!c.alive || c.closed) return; for (const st of [true, false]) { const v = st ? c.chain[0] : c.chain[c.chain.length - 1]; (at.get(v) ?? at.set(v, []).get(v)!).push({ i, start: st }); } });
    let best: null | { a: { i: number; start: boolean }; b: { i: number; start: boolean }; c: number } = null;
    for (const [, ends] of at) { if (ends.length < 2) continue;
      for (let x = 0; x < ends.length; x++) for (let y = x + 1; y < ends.length; y++) { const A = ends[x], B = ends[y]; if (A.i === B.i) continue; const ca = list[A.i], cb = list[B.i]; if (kindC(ca.chain) !== kindC(cb.chain)) continue;
        const da = dirAt(ca.chain, A.start), db = dirAt(cb.chain, B.start); const cc = -(da[0] * db[0] + da[1] * db[1] + da[2] * db[2]); if (cc > cosM && (!best || cc > best.c)) best = { a: A, b: B, c: cc }; } }
    if (!best) break;
    const ca = list[best.a.i], cb = list[best.b.i];
    const A = best.a.start ? ca.chain.slice().reverse() : ca.chain, B = best.b.start ? cb.chain : cb.chain.slice().reverse();
    const ch = [...A, ...B.slice(1)]; ca.alive = false; cb.alive = false; list.push({ chain: ch, closed: ch[0] === ch[ch.length - 1], alive: true });
  }
  return list.filter((c) => c.alive);
}

/** Automatische Erkennung: scharfe Kanten, Tangentenlinien (eben ↔ gekrümmt) und Radius-Übergänge (Krümmungsbetrag ändert sich). */
export function detectCurves(m: MeshData, o: DetectOptions & CleanOptions = {}, g = new EdgeGraph(m), bvh = buildBVH(m)): CurveData[] {
  const cosSharp = Math.cos(((o.sharpDeg ?? 30) * Math.PI) / 180);
  const K = faceCurvature(g, cosSharp, o.smoothRings ?? 4);
  const seg = segmentCurvature(g, K, cosSharp, o.flatKappa ?? 0.055, o.binRatio ?? 1.6, o.minIsland ?? 150);
  const marked = new Set<number>(), kindOf = new Map<number, CurveKind>();
  for (const [kk, L] of g.faces) {
    if (L.length !== 2) continue;
    if (g.dihedralCos(kk) < cosSharp) { marked.add(kk); kindOf.set(kk, 'Kante'); continue; }
    const a = seg.reg[L[0]], b = seg.reg[L[1]]; if (a === b) continue;
    const fa = seg.mean[a] < seg.flat, fb = seg.mean[b] < seg.flat;
    marked.add(kk); kindOf.set(kk, fa !== fb ? 'Tangente' : 'Übergang');
  }
  cleanup(g, marked, kindOf, o);
  const minLen = o.minLen ?? Math.max(2, 8 * g.el);
  const merged = o.mergeDeg === 0 ? chains(g, marked) : mergeCollinear(g, chains(g, marked), o.mergeDeg ?? 30, kindOf);
  return merged.filter((c) => chainLen(g, c.chain) >= minLen).map((c) => {
    const cnt: Record<string, number> = {}; for (let i = 1; i < c.chain.length; i++) { const k = kindOf.get(g.key(c.chain[i - 1], c.chain[i])) ?? 'Tangente'; cnt[k] = (cnt[k] ?? 0) + 1; }
    const kind = (Object.entries(cnt).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'Tangente') as CurveKind;
    return makeCurve(g, bvh, c.chain, kind, c.closed);
  });
}

export interface LayoutOptions { turnDeg?: number; autoCorners?: boolean; }
/**
 * Patch-Aufteilung: Flächen entlang der Kurven trennen; Ränder als Schleifen ablaufen, Ecken = Knoten (Grad ≠ 2),
 * Knicke der Kurven (> turnDeg) und automatisch eingefügte Eckpunkte (Patches mit einer Randschleife und < 4 Ecken).
 * Vorschläge: Naht bei ringförmigen Patches (zwei Randschleifen, z. B. Zylindermantel), Teilung bei N > 4 Seiten.
 */
export function layout(g: EdgeGraph, curves: { chain: number[] }[], o: LayoutOptions = {}): Layout {
  const F = g.m.indices, nt = F.length / 3, P = g.m.positions, nv = g.nv;
  const cut = new Set<number>(); const deg = new Map<number, number>();
  for (const c of curves) for (let i = 1; i < c.chain.length; i++) { if (c.chain[i - 1] === c.chain[i]) continue; const kk = g.key(c.chain[i - 1], c.chain[i]); if (cut.has(kk)) continue; cut.add(kk); for (const v of [c.chain[i - 1], c.chain[i]]) deg.set(v, (deg.get(v) ?? 0) + 1); }
  const nodes: Layout['nodes'] = []; const corner = new Set<number>(); const kindC = new Map<number, 'Knoten' | 'Knick' | 'Auto'>();
  for (const [v, d] of deg) if (d !== 2) { nodes.push({ v, degree: d, p: [P[3 * v], P[3 * v + 1], P[3 * v + 2]] }); corner.add(v); kindC.set(v, 'Knoten'); }
  // Knicke entlang der Kurven
  const turn = Math.cos(((o.turnDeg ?? 55) * Math.PI) / 180), w = 8 * g.el;
  for (const c of curves) {
    const ch = c.chain, n = ch.length; if (n < 5) continue; const s = [0]; for (let i = 1; i < n; i++) s.push(s[i - 1] + g.dist(ch[i - 1], ch[i]));
    const closed = ch[0] === ch[n - 1]; const L = s[n - 1]; let best = -1, bc = 2, lo = 0, hi = 0;
    const cosAt: number[] = new Array(n).fill(1);
    for (let i = 0; i < n; i++) {
      if (!closed && (s[i] < w || L - s[i] < w)) continue;
      while (s[i] - s[lo] > w) lo++; while (hi < n - 1 && s[hi] - s[i] < w) hi++;
      let a = lo, b = hi; if (closed) { if (s[i] < w) a = n - 1 - Math.max(1, Math.round((w - s[i]) / g.el)); if (L - s[i] < w) b = Math.min(n - 1, Math.round((w - (L - s[i])) / g.el)); }
      const pi = ch[i]; const u = [P[3 * pi] - P[3 * ch[a]], P[3 * pi + 1] - P[3 * ch[a] + 1], P[3 * pi + 2] - P[3 * ch[a] + 2]], v = [P[3 * ch[b]] - P[3 * pi], P[3 * ch[b] + 1] - P[3 * pi + 1], P[3 * ch[b] + 2] - P[3 * pi + 2]];
      const lu = Math.hypot(u[0], u[1], u[2]), lv = Math.hypot(v[0], v[1], v[2]); if (!lu || !lv) continue;
      cosAt[i] = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv);
    }
    for (let i = 0; i < n; i++) { if (cosAt[i] < turn && cosAt[i] <= (cosAt[i - 1] ?? 2) && cosAt[i] <= (cosAt[i + 1] ?? 2) && !corner.has(ch[i])) { let near = false; for (const q of corner) if (g.dist(q, ch[i]) < w) { near = true; break; } if (!near) { corner.add(ch[i]); kindC.set(ch[i], 'Knick'); } } }
    void best; void bc;
  }
  // Regionen
  const regionOf = new Int32Array(nt).fill(-1); let nr = 0;
  const tnb: number[][] = Array.from({ length: nt }, () => []);
  for (const [kk, L] of g.faces) if (L.length === 2 && !cut.has(kk)) { tnb[L[0]].push(L[1]); tnb[L[1]].push(L[0]); }
  for (let s0 = 0; s0 < nt; s0++) { if (regionOf[s0] >= 0) continue; const st = [s0]; regionOf[s0] = nr; while (st.length) { const t = st.pop()!; for (const u of tnb[t]) if (regionOf[u] < 0) { regionOf[u] = nr; st.push(u); } } nr++; }
  // Randschleifen je Region (gerichtete Randkanten, Weiterlauf um den Endknoten durch die Region)
  const faceOf = new Map<number, number>(); // gerichtete Kante a*nv+b -> Dreieck
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) faceOf.set(F[3 * t + k] * nv + F[3 * t + (k + 1) % 3], t);
  const isB = (a: number, b: number) => { const kk = g.key(a, b); return cut.has(kk) || (g.faces.get(kk)?.length ?? 0) < 2; };
  const third = (t: number, a: number, b: number) => { for (let k = 0; k < 3; k++) { const x = F[3 * t + k]; if (x !== a && x !== b) return x; } return a; };
  const loopsOf: number[][][] = Array.from({ length: nr }, () => []); const used = new Set<number>();
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const a = F[3 * t + k], b = F[3 * t + (k + 1) % 3], he = a * nv + b; if (used.has(he) || !isB(a, b)) continue;
    const loop: number[] = []; let ca = a, cb = b, ct = t, guard = 0;
    while (!used.has(ca * nv + cb) && guard++ < 1e6) {
      used.add(ca * nv + cb); loop.push(ca);
      // nächste Randkante ab cb: im aktuellen Dreieck cb -> c; solange innen, ins Nachbardreieck über (cb,c) drehen
      let tt = ct, x = third(tt, ca, cb), spins = 0;
      while (!isB(cb, x) && spins++ < 64) { const nt2 = faceOf.get(x * nv + cb); if (nt2 === undefined) break; tt = nt2; x = third(tt, x, cb); }
      ca = cb; cb = x; ct = tt;
    }
    if (loop.length >= 3) loopsOf[regionOf[t]].push(loop);
  }
  // Auto-Ecken: Patches mit genau einer Schleife und < 4 Ecken auf 4 ergänzen (Bogenlänge)
  if (o.autoCorners ?? true) for (let r = 0; r < nr; r++) {
    const Ls = loopsOf[r]; if (Ls.length !== 1) continue; const L = Ls[0]; if (L.length < 8) continue;
    let cs = L.map((v, i) => (corner.has(v) ? i : -1)).filter((i) => i >= 0);
    const s = [0]; for (let i = 1; i <= L.length; i++) s.push(s[i - 1] + g.dist(L[i - 1], L[i % L.length])); const tot = s[L.length];
    if (!cs.length) { for (let q = 0; q < 4; q++) { const tgt = (q * tot) / 4; let i = 0; while (i < L.length - 1 && s[i + 1] <= tgt) i++; corner.add(L[i]); kindC.set(L[i], 'Auto'); } continue; }
    while (cs.length < 4) { // längste Seite halbieren
      let bi = 0, bl = -1; for (let j = 0; j < cs.length; j++) { const a = cs[j], b = cs[(j + 1) % cs.length]; const len = b > a ? s[b] - s[a] : tot - s[a] + s[b]; if (len > bl) { bl = len; bi = j; } }
      const a = cs[bi]; const tgt = s[a] + bl / 2; let i = a; while (true) { const ni = (i + 1) % L.length; const si = ni > a || ni === 0 ? (ni === 0 ? tot : s[ni]) : s[ni] + tot; if (si > tgt || ni === cs[(bi + 1) % cs.length]) break; i = ni; }
      if (corner.has(L[i])) break; corner.add(L[i]); kindC.set(L[i], 'Auto'); cs = L.map((v, j) => (corner.has(v) ? j : -1)).filter((j) => j >= 0);
    }
  }
  // Seiten zählen + Vorschläge
  const regions: Layout['regions'] = []; const suggestions: Layout['suggestions'] = [];
  const area = new Float64Array(nr), cen = Array.from({ length: nr }, () => [0, 0, 0]), cntF = new Uint32Array(nr);
  for (let t = 0; t < nt; t++) { const r = regionOf[t]; const a = F[3 * t], b = F[3 * t + 1], c = F[3 * t + 2]; const u = [P[3 * b] - P[3 * a], P[3 * b + 1] - P[3 * a + 1], P[3 * b + 2] - P[3 * a + 2]], v = [P[3 * c] - P[3 * a], P[3 * c + 1] - P[3 * a + 1], P[3 * c + 2] - P[3 * a + 2]];
    const A = 0.5 * Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]); area[r] += A; cntF[r]++; for (let k = 0; k < 3; k++) cen[r][k] += A * (P[3 * a + k] + P[3 * b + k] + P[3 * c + k]) / 3; }
  const inRegion = (r: number) => { const ok = new Uint8Array(nv); for (let t = 0; t < nt; t++) if (regionOf[t] === r) for (let k = 0; k < 3; k++) ok[F[3 * t + k]] = 1; return ok; };
  for (let r = 0; r < nr; r++) {
    const Ls = loopsOf[r]; let sides = 0; for (const L of Ls) for (const v of L) if (corner.has(v)) sides++;
    const c = cen[r].map((x) => x / (area[r] || 1)) as Vec3;
    regions.push({ faces: cntF[r], sides, loops: Ls.length, area: area[r], center: c });
    // Vorschläge nur für nennenswerte Patches
    if (area[r] < 25 * g.el * g.el) continue;
    if (Ls.length === 2) { // Naht zwischen den Schleifen (bevorzugt von Ecken aus)
      const ok = inRegion(r); const A = Ls[0], B = new Set(Ls[1]); const src = A.filter((v) => corner.has(v)); const seeds = src.length ? src : A;
      const pth = multiPath(g, seeds, B, (u, v) => ok[u] && ok[v] && !cut.has(g.key(u, v)) || (B.has(v)));
      if (pth.length > 1) suggestions.push({ chain: pth, reason: 'Naht (ringförmiger Patch)', region: r });
    } else if (Ls.length === 1 && sides > 4) {
      const L = Ls[0]; const cs = L.filter((v) => corner.has(v)); const a = cs[0], b = cs[Math.floor(cs.length / 2)];
      const ok = inRegion(r); const pth = multiPath(g, [a], new Set([b]), (u, v) => !!(ok[u] && ok[v]) && (!cut.has(g.key(u, v))));
      if (pth.length > 1) suggestions.push({ chain: pth, reason: `${sides}-seitig teilen`, region: r });
    }
  }
  const cornersOut = [...corner].filter((v) => kindC.get(v) !== 'Knoten').map((v) => ({ v, kind: kindC.get(v)!, p: [P[3 * v], P[3 * v + 1], P[3 * v + 2]] as Vec3 }));
  return { nodes, corners: cornersOut, regionOf, regions, suggestions, tJunctions: nodes.filter((x) => x.degree === 3).length, foursided: regions.filter((r) => r.sides === 4 && r.loops === 1).length };
}
/** Kürzester Weg von einer Startmenge zu einer Zielmenge (Dijkstra) mit Kantenfilter. */
function multiPath(g: EdgeGraph, src: number[], dst: Set<number>, allow: (u: number, v: number) => boolean): number[] {
  const d = new Map<number, number>(), prev = new Map<number, number>(); const H: [number, number][] = [];
  const push = (x: [number, number]) => { H.push(x); let i = H.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (H[p][0] <= H[i][0]) break; [H[p], H[i]] = [H[i], H[p]]; i = p; } };
  const pop = () => { const r = H[0], l = H.pop()!; if (H.length) { H[0] = l; let i = 0; for (;;) { const x = 2 * i + 1, y = x + 1; let m = i; if (x < H.length && H[x][0] < H[m][0]) m = x; if (y < H.length && H[y][0] < H[m][0]) m = y; if (m === i) break; [H[m], H[i]] = [H[i], H[m]]; i = m; } } return r; };
  for (const s of src) { d.set(s, 0); push([0, s]); }
  let end = -1;
  while (H.length) { const [du, u] = pop(); if (du > (d.get(u) ?? Infinity)) continue; if (dst.has(u) && du > 0) { end = u; break; }
    for (const v of g.vadj[u]) { if (!allow(u, v)) continue; const nd = du + g.dist(u, v); if (nd < (d.get(v) ?? Infinity)) { d.set(v, nd); prev.set(v, u); push([nd, v]); } } }
  if (end < 0) return [];
  const out = [end]; let x = end; while (prev.has(x)) { x = prev.get(x)!; out.push(x); } return out.reverse();
}

/** Kurve aus (bearbeiteten) Kontrollpunkten: B-Spline abtasten, auf das Netz legen, Kantenkette neu bestimmen. */
export function curveFromCtrl(g: EdgeGraph, bvh: MeshBVH, ctrl: Vec3[], kind: CurveKind, closed = false): CurveData {
  const q = new THREE.Vector3(), tg: any = {}; const F = g.m.indices, P = g.m.positions;
  // Kontrollpunkte selbst aufs Netz
  const C = ctrl.map((p) => { q.set(p[0], p[1], p[2]); const h = bvh.closestPointToPoint(q, tg); return (h ? [h.point.x, h.point.y, h.point.z] : p) as Vec3; });
  let est = 0; for (let i = 1; i < C.length; i++) est += Math.hypot(C[i][0] - C[i - 1][0], C[i][1] - C[i - 1][1], C[i][2] - C[i - 1][2]);
  const ns = Math.max(8, Math.min(400, Math.round(est / (0.5 * g.el)))); const pts: Vec3[] = []; const vs: number[] = [];
  for (let i = 0; i <= ns; i++) { const p = evalBSpline(C, i / ns); q.set(p[0], p[1], p[2]); const h = bvh.closestPointToPoint(q, tg);
    if (!h) { pts.push(p); continue; } pts.push([h.point.x, h.point.y, h.point.z]);
    let b = F[3 * h.faceIndex], bd = Infinity; for (let k = 0; k < 3; k++) { const w = F[3 * h.faceIndex + k]; const d = (P[3 * w] - h.point.x) ** 2 + (P[3 * w + 1] - h.point.y) ** 2 + (P[3 * w + 2] - h.point.z) ** 2; if (d < bd) { bd = d; b = w; } }
    if (vs[vs.length - 1] !== b) vs.push(b); }
  const chain = pathThrough(g, vs);
  let sl = 0; for (let i = 1; i < pts.length; i++) sl += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  return { kind, chain, closed, ctrl: C, pts, length: sl };
}
/** Kurve an Kettenknoten teilen. */
export function splitCurve(g: EdgeGraph, bvh: MeshBVH, c: { chain: number[]; kind: CurveKind }, at: number): [CurveData, CurveData] | null {
  const i = c.chain.indexOf(at); if (i < 2 || i > c.chain.length - 3) return null;
  return [makeCurve(g, bvh, c.chain.slice(0, i + 1), c.kind), makeCurve(g, bvh, c.chain.slice(i), c.kind)];
}
/** Zwei Kurven verbinden (nächstliegende Enden, Lücke über kürzesten Weg). */
export function joinCurves(g: EdgeGraph, bvh: MeshBVH, a: { chain: number[]; kind: CurveKind }, b: { chain: number[] }): CurveData {
  const A = a.chain, B = b.chain; const opts: [number[], number[]][] = [[A, B], [A, B.slice().reverse()], [A.slice().reverse(), B], [A.slice().reverse(), B.slice().reverse()]];
  let best = opts[0], bd = Infinity; for (const o of opts) { const d = g.dist(o[0][o[0].length - 1], o[1][0]); if (d < bd) { bd = d; best = o; } }
  const bridge = g.path(best[0][best[0].length - 1], best[1][0]);
  return makeCurve(g, bvh, [...best[0], ...bridge.slice(1, -1), ...best[1]], a.kind);
}

/** Benutzerkurve: Klickpunkte (Knoten) über kürzeste Kantenwege verbinden. */
export function pathThrough(g: EdgeGraph, verts: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < verts.length; i++) { const p = g.path(verts[i - 1], verts[i]); if (out.length) p.shift(); out.push(...p); }
  return out.length ? out : verts.slice();
}
