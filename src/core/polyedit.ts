// Polygonbearbeitung: Dreiecksreduktion (Kantenkollaps mit Quadrik-Fehler und harter Toleranz),
// Unterteilung (Loop, toleranzbegrenzt), Glättung (Taubin, toleranzbegrenzt), magischer Radierer (Loch stanzen + füllen + fairen)
// und Abweichungsvergleich zum Original (BVH-Abstand, vorzeichenbehaftet).
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export interface RawMesh { positions: Float32Array; indices: Uint32Array; }
export type Progress = (triCount: number, done: number) => void;

// ---------------------------------------------------------------- Hilfen
/** Abstand² Punkt–Dreieck (Ericson, Real-Time Collision Detection 5.1.5). */
export function pointTriDist2(px: number, py: number, pz: number, P: ArrayLike<number>, a: number, b: number, c: number): number {
  const ax = P[3 * a], ay = P[3 * a + 1], az = P[3 * a + 2];
  const abx = P[3 * b] - ax, aby = P[3 * b + 1] - ay, abz = P[3 * b + 2] - az;
  const acx = P[3 * c] - ax, acy = P[3 * c + 1] - ay, acz = P[3 * c + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx: number, qy: number, qz: number;
  const set = (u: number, v: number) => { qx = ax + u * abx + v * acx; qy = ay + u * aby + v * acy; qz = az + u * abz + v * acz; };
  if (d1 <= 0 && d2 <= 0) set(0, 0);
  else {
    const bpx = px - P[3 * b], bpy = py - P[3 * b + 1], bpz = pz - P[3 * b + 2];
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) set(1, 0);
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) set(d1 / (d1 - d3), 0);
      else {
        const cpx = px - P[3 * c], cpy = py - P[3 * c + 1], cpz = pz - P[3 * c + 2];
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) set(0, 1);
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) set(0, d2 / (d2 - d6));
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); qx = P[3 * b] + w * (P[3 * c] - P[3 * b]); qy = P[3 * b + 1] + w * (P[3 * c + 1] - P[3 * b + 1]); qz = P[3 * b + 2] + w * (P[3 * c + 2] - P[3 * b + 2]); }
            else { const den = 1 / (va + vb + vc); set(vb * den, vc * den); }
          }
        }
      }
    }
  }
  return (px - qx!) ** 2 + (py - qy!) ** 2 + (pz - qz!) ** 2;
}

function faceNormal(P: ArrayLike<number>, a: number, b: number, c: number, out: number[]) {
  const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2];
  const vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2];
  out[0] = uy * vz - uz * vy; out[1] = uz * vx - ux * vz; out[2] = ux * vy - uy * vx;
  return Math.hypot(out[0], out[1], out[2]);
}
/** Dreiecksqualität 4√3·A/Σl² (1 = gleichseitig). */
function quality(P: ArrayLike<number>, a: number, b: number, c: number, n: number[]) {
  const A2 = faceNormal(P, a, b, c, n);
  const d = (i: number, j: number) => (P[3 * i] - P[3 * j]) ** 2 + (P[3 * i + 1] - P[3 * j + 1]) ** 2 + (P[3 * i + 2] - P[3 * j + 2]) ** 2;
  const s = d(a, b) + d(b, c) + d(c, a);
  return s > 0 ? (2 * Math.sqrt(3) * A2) / s : 0;
}

/** Ungenutzte Knoten entfernen, tote Dreiecke weglassen. */
function compact(P: ArrayLike<number>, F: ArrayLike<number>, alive: (t: number) => boolean, nt: number): RawMesh {
  const map = new Int32Array(P.length / 3).fill(-1); const pos: number[] = []; const idx: number[] = [];
  for (let t = 0; t < nt; t++) {
    if (!alive(t)) continue;
    for (let k = 0; k < 3; k++) {
      const v = F[3 * t + k];
      if (map[v] < 0) { map[v] = pos.length / 3; pos.push(P[3 * v], P[3 * v + 1], P[3 * v + 2]); }
      idx.push(map[v]);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

/** Randkanten (genau einem Dreieck zugeordnet) -> Knoten am Rand markieren. */
export function boundaryEdges(indices: ArrayLike<number>, nv: number): { count: number; isB: Uint8Array } {
  const m = new Map<number, number>();
  for (let t = 0; t < indices.length / 3; t++) for (let k = 0; k < 3; k++) {
    const a = indices[3 * t + k], b = indices[3 * t + (k + 1) % 3];
    const key = a < b ? a * nv + b : b * nv + a; m.set(key, (m.get(key) ?? 0) + 1);
  }
  const isB = new Uint8Array(nv); let count = 0;
  for (const [key, c] of m) if (c === 1) { count++; isB[Math.floor(key / nv)] = 1; isB[key % nv] = 1; }
  return { count, isB };
}

// ---------------------------------------------------------------- Dreiecksreduktion
class Heap { // Min-Heap (Kosten, Halbkante u->v, Zeitstempel)
  c: number[] = []; u: number[] = []; v: number[] = []; s: number[] = [];
  get size() { return this.c.length; }
  push(c: number, u: number, v: number, s: number) {
    let i = this.c.length; this.c.push(c); this.u.push(u); this.v.push(v); this.s.push(s);
    while (i > 0) { const p = (i - 1) >> 1; if (this.c[p] <= this.c[i]) break; this.swap(i, p); i = p; }
  }
  pop(): [number, number, number, number] {
    const r: [number, number, number, number] = [this.c[0], this.u[0], this.v[0], this.s[0]];
    const last = this.c.length - 1; this.swap(0, last); this.c.pop(); this.u.pop(); this.v.pop(); this.s.pop();
    let i = 0; const n = this.c.length;
    for (;;) { const l = 2 * i + 1, rr = l + 1; let m = i; if (l < n && this.c[l] < this.c[m]) m = l; if (rr < n && this.c[rr] < this.c[m]) m = rr; if (m === i) break; this.swap(i, m); i = m; }
    return r;
  }
  private swap(i: number, j: number) { for (const a of [this.c, this.u, this.v, this.s]) { const t = a[i]; a[i] = a[j]; a[j] = t; } }
}

export interface DecimateOptions { tol: number; minTris?: number; minQuality?: number; onProgress?: Progress; progressEvery?: number; }
export interface DecimateResult extends RawMesh { before: number; after: number; maxDev: number; collapses: number; }

/**
 * Halbkanten-Kollaps (Knoten u wandert auf Nachbarknoten v; alle verbleibenden Knoten liegen damit auf dem Original),
 * Reihenfolge nach Quadrik-Fehler (Garland/Heckbert). Harte Grenze: jeder Originalknoten bleibt ≤ tol vom reduzierten Netz entfernt
 * (Originalpunkte werden den Dreiecken zugeordnet und bei jedem Kollaps neu verteilt und geprüft – analog zur Sehnenhöhe beim Polygonisieren).
 * Randknoten bleiben fest; Kollapse, die Dreiecke umklappen oder Splitter erzeugen, werden verworfen.
 */
export function decimate(m: RawMesh, o: DecimateOptions): DecimateResult {
  const P = Float64Array.from(m.positions), F = Int32Array.from(m.indices);
  const nv = P.length / 3, nt = F.length / 3, tol2 = o.tol * o.tol, minQ = o.minQuality ?? 0.08;
  const alive = new Uint8Array(nt).fill(1);
  const vf: number[][] = Array.from({ length: nv }, () => []);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) vf[F[3 * t + k]].push(t);
  const { isB } = boundaryEdges(F, nv);
  // Quadriken (flächengewichtet)
  const Q = new Float64Array(10 * nv); const n = [0, 0, 0];
  for (let t = 0; t < nt; t++) {
    const a = F[3 * t], b = F[3 * t + 1], c = F[3 * t + 2]; const l = faceNormal(P, a, b, c, n); if (!l) continue;
    const nx = n[0] / l, ny = n[1] / l, nz = n[2] / l, d = -(nx * P[3 * a] + ny * P[3 * a + 1] + nz * P[3 * a + 2]), w = l / 2;
    const q = [nx * nx, nx * ny, nx * nz, nx * d, ny * ny, ny * nz, ny * d, nz * nz, nz * d, d * d];
    for (const v of [a, b, c]) for (let i = 0; i < 10; i++) Q[10 * v + i] += w * q[i];
  }
  const qerr = (u: number, v: number) => {
    const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2]; const A = 10 * u, B = 10 * v; const q = (i: number) => Q[A + i] + Q[B + i];
    return q(0) * x * x + 2 * q(1) * x * y + 2 * q(2) * x * z + 2 * q(3) * x + q(4) * y * y + 2 * q(5) * y * z + 2 * q(6) * y + q(7) * z * z + 2 * q(8) * z + q(9);
  };
  // Originalpunkte je Dreieck
  const own: number[][] = Array.from({ length: nt }, () => []);
  for (let v = 0; v < nv; v++) if (vf[v].length) own[vf[v][0]].push(v);
  const O = m.positions; // Original (unverändert)
  const stamp = new Int32Array(nv);
  const heap = new Heap();
  const neigh = (u: number) => { const s = new Set<number>(); for (const t of vf[u]) for (let k = 0; k < 3; k++) { const w = F[3 * t + k]; if (w !== u) s.add(w); } return s; };
  const pushV = (u: number) => { if (isB[u] || !vf[u].length) return; stamp[u]++; for (const v of neigh(u)) heap.push(qerr(u, v), u, v, stamp[u]); };
  for (let u = 0; u < nv; u++) pushV(u);
  let tris = nt, collapses = 0; const minTris = o.minTris ?? 4, every = o.progressEvery ?? 20000;
  const n0 = [0, 0, 0], n1 = [0, 0, 0];
  while (heap.size && tris > minTris) {
    const [, u, v, s] = heap.pop();
    if (s !== stamp[u] || !vf[u].length || !vf[v].length) continue;
    // Dreiecke an Kante uv / übrige Dreiecke von u
    const shared: number[] = [], moved: number[] = [];
    for (const t of vf[u]) (F[3 * t] === v || F[3 * t + 1] === v || F[3 * t + 2] === v ? shared : moved).push(t);
    if (shared.length !== 2) continue;
    // Link-Bedingung: gemeinsame Nachbarn genau 2
    const nu = neigh(u), nvs = neigh(v); let common = 0; for (const w of nu) if (nvs.has(w)) common++;
    if (common !== 2) continue;
    // Geometrie prüfen (Umklappen, Splitter)
    let ok = true;
    for (const t of moved) {
      const i = 3 * t; const a = F[i], b = F[i + 1], c = F[i + 2];
      faceNormal(P, a, b, c, n0);
      const a2 = a === u ? v : a, b2 = b === u ? v : b, c2 = c === u ? v : c;
      const q = quality(P, a2, b2, c2, n1);
      const l0 = Math.hypot(n0[0], n0[1], n0[2]), l1 = Math.hypot(n1[0], n1[1], n1[2]);
      if (q < minQ || !l1 || (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) / (l0 * l1) < 0.5) { ok = false; break; }
    }
    if (!ok) continue;
    // Toleranz: Originalpunkte aller Dreiecke von u auf neue Dreiecke verteilen
    const pts: number[] = []; for (const t of vf[u]) for (const p of own[t]) pts.push(p);
    const assign = new Int32Array(pts.length);
    for (let k = 0; k < pts.length && ok; k++) {
      const p = pts[k], px = O[3 * p], py = O[3 * p + 1], pz = O[3 * p + 2]; let bd = Infinity, bt = -1;
      for (const t of moved) {
        const i = 3 * t; const a = F[i] === u ? v : F[i], b = F[i + 1] === u ? v : F[i + 1], c = F[i + 2] === u ? v : F[i + 2];
        const d = pointTriDist2(px, py, pz, P, a, b, c); if (d < bd) { bd = d; bt = t; }
      }
      if (bd > tol2) ok = false; else assign[k] = bt;
    }
    if (!ok) continue;
    // Kollaps ausführen
    for (const t of vf[u]) own[t] = [];
    for (let k = 0; k < pts.length; k++) own[assign[k]].push(pts[k]);
    for (const t of shared) { alive[t] = 0; for (let k = 0; k < 3; k++) { const w = F[3 * t + k]; if (w !== u) { const L = vf[w]; L.splice(L.indexOf(t), 1); } } }
    for (const t of moved) { for (let k = 0; k < 3; k++) if (F[3 * t + k] === u) F[3 * t + k] = v; vf[v].push(t); }
    vf[u] = []; tris -= 2; collapses++;
    for (let i = 0; i < 10; i++) Q[10 * v + i] += Q[10 * u + i];
    pushV(v); for (const w of neigh(v)) pushV(w);
    if (o.onProgress && collapses % every === 0) o.onProgress(tris, collapses);
  }
  const r = compact(P, F, (t) => !!alive[t], nt);
  return { ...r, before: nt, after: tris, maxDev: NaN, collapses };
}

// ---------------------------------------------------------------- Unterteilung
export interface SubdivideOptions { tol: number; levels?: number; maxTris?: number; onProgress?: Progress; }
/** Loop-Unterteilung (1→4); jede Knotenverschiebung gegenüber der linearen Lage (liegt auf dem Original) wird auf tol begrenzt. Randknoten linear. */
export function subdivide(m: RawMesh, o: SubdivideOptions): RawMesh & { before: number; after: number } {
  let P = Float64Array.from(m.positions), F = Uint32Array.from(m.indices); const before = F.length / 3;
  const levels = o.levels ?? 1, maxTris = o.maxTris ?? 3_000_000;
  for (let lv = 0; lv < levels && (F.length / 3) * 4 <= maxTris; lv++) {
    const nv = P.length / 3, nt = F.length / 3;
    const edge = new Map<number, number>(); const eOpp = new Map<number, number[]>();
    const key = (a: number, b: number) => (a < b ? a * nv + b : b * nv + a);
    let next = nv; const ends: number[] = [];
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
      const a = F[3 * t + k], b = F[3 * t + (k + 1) % 3], c = F[3 * t + (k + 2) % 3], kk = key(a, b);
      if (!edge.has(kk)) { edge.set(kk, next++); ends.push(a, b); eOpp.set(kk, []); }
      eOpp.get(kk)!.push(c);
    }
    const NP = new Float64Array(3 * next), lin = new Float64Array(3 * next);
    // Nachbarn / Randkanten der alten Knoten
    const nb: number[][] = Array.from({ length: nv }, () => []); const bnb: number[][] = Array.from({ length: nv }, () => []);
    for (const [kk, opp] of eOpp) { const a = Math.floor(kk / nv), b = kk % nv; nb[a].push(b); nb[b].push(a); if (opp.length === 1) { bnb[a].push(b); bnb[b].push(a); } }
    for (let v = 0; v < nv; v++) {
      for (let k = 0; k < 3; k++) lin[3 * v + k] = P[3 * v + k];
      if (bnb[v].length) { // Randregel
        if (bnb[v].length === 2) for (let k = 0; k < 3; k++) NP[3 * v + k] = 0.75 * P[3 * v + k] + 0.125 * (P[3 * bnb[v][0] + k] + P[3 * bnb[v][1] + k]);
        else for (let k = 0; k < 3; k++) NP[3 * v + k] = P[3 * v + k];
        continue;
      }
      const n = nb[v].length, beta = n === 3 ? 3 / 16 : 3 / (8 * n);
      for (let k = 0; k < 3; k++) { let s = 0; for (const w of nb[v]) s += P[3 * w + k]; NP[3 * v + k] = (1 - n * beta) * P[3 * v + k] + beta * s; }
    }
    let ei = 0;
    for (const [kk, opp] of eOpp) {
      const id = edge.get(kk)!, a = ends[2 * ei], b = ends[2 * ei + 1]; ei++;
      for (let k = 0; k < 3; k++) {
        const mid = 0.5 * (P[3 * a + k] + P[3 * b + k]); lin[3 * id + k] = mid;
        NP[3 * id + k] = opp.length === 2 ? 0.375 * (P[3 * a + k] + P[3 * b + k]) + 0.125 * (P[3 * opp[0] + k] + P[3 * opp[1] + k]) : mid;
      }
    }
    // Toleranzbegrenzung
    for (let v = 0; v < next; v++) {
      const dx = NP[3 * v] - lin[3 * v], dy = NP[3 * v + 1] - lin[3 * v + 1], dz = NP[3 * v + 2] - lin[3 * v + 2], d = Math.hypot(dx, dy, dz);
      if (d > o.tol) { const s = o.tol / d; NP[3 * v] = lin[3 * v] + dx * s; NP[3 * v + 1] = lin[3 * v + 1] + dy * s; NP[3 * v + 2] = lin[3 * v + 2] + dz * s; }
    }
    const NF = new Uint32Array(12 * nt);
    for (let t = 0; t < nt; t++) {
      const a = F[3 * t], b = F[3 * t + 1], c = F[3 * t + 2], ab = edge.get(key(a, b))!, bc = edge.get(key(b, c))!, ca = edge.get(key(c, a))!;
      NF.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], 12 * t);
    }
    P = NP; F = NF;
    o.onProgress?.(F.length / 3, lv + 1);
    // Nach Stufe 1 sind die „linearen“ Lagen nicht mehr auf dem Original: weitere Stufen nur linear + begrenzt (konservativ)
    if (lv === 0) o = { ...o, tol: o.tol / 4 };
  }
  return { positions: Float32Array.from(P), indices: F, before, after: F.length / 3 };
}

// ---------------------------------------------------------------- Glättung
export interface SmoothOptions { iterations: number; lambda?: number; tol?: number; onProgress?: Progress; }
/** Taubin-Glättung (λ/μ, schrumpffrei); optional Verschiebung je Knoten ≤ tol gegenüber der Ausgangslage. Randknoten fest. */
export function smooth(m: RawMesh, o: SmoothOptions): RawMesh {
  const P0 = m.positions, nv = P0.length / 3, F = m.indices, lam = o.lambda ?? 0.5, mu = -(lam + 0.03);
  const P = Float64Array.from(P0), T = new Float64Array(3 * nv);
  const deg = new Uint32Array(nv + 1); const { isB } = boundaryEdges(F, nv);
  for (let i = 0; i < F.length; i++) deg[F[i] + 1] += 2;
  for (let i = 0; i < nv; i++) deg[i + 1] += deg[i];
  const fill = deg.slice(0, nv), adj = new Uint32Array(deg[nv]);
  for (let t = 0; t < F.length / 3; t++) for (let k = 0; k < 3; k++) { const a = F[3 * t + k], b = F[3 * t + (k + 1) % 3]; adj[fill[a]++] = b; adj[fill[b]++] = a; }
  const step = (f: number) => {
    for (let v = 0; v < nv; v++) {
      const s = deg[v], e = deg[v + 1]; if (isB[v] || e === s) { T[3 * v] = P[3 * v]; T[3 * v + 1] = P[3 * v + 1]; T[3 * v + 2] = P[3 * v + 2]; continue; }
      let x = 0, y = 0, z = 0; for (let i = s; i < e; i++) { const w = adj[i]; x += P[3 * w]; y += P[3 * w + 1]; z += P[3 * w + 2]; }
      const inv = 1 / (e - s);
      T[3 * v] = P[3 * v] + f * (x * inv - P[3 * v]); T[3 * v + 1] = P[3 * v + 1] + f * (y * inv - P[3 * v + 1]); T[3 * v + 2] = P[3 * v + 2] + f * (z * inv - P[3 * v + 2]);
    }
    P.set(T);
  };
  for (let it = 0; it < o.iterations; it++) {
    step(lam); step(mu);
    if (o.tol && o.tol > 0) for (let v = 0; v < nv; v++) {
      const dx = P[3 * v] - P0[3 * v], dy = P[3 * v + 1] - P0[3 * v + 1], dz = P[3 * v + 2] - P0[3 * v + 2], d = Math.hypot(dx, dy, dz);
      if (d > o.tol) { const s = o.tol / d; P[3 * v] = P0[3 * v] + dx * s; P[3 * v + 1] = P0[3 * v + 1] + dy * s; P[3 * v + 2] = P0[3 * v + 2] + dz * s; }
    }
    o.onProgress?.(F.length / 3, it + 1);
  }
  return { positions: Float32Array.from(P), indices: Uint32Array.from(F) };
}

// ---------------------------------------------------------------- Magischer Radierer
export interface EraseResult extends RawMesh { removed: number; added: number; loops: number; skipped: number; }
/**
 * Dreiecke im Pinselradius (zusammenhängend ab dem Treffer-Dreieck, gleiche Blickseite) entfernen, die entstehenden Lochränder
 * ringweise triangulieren und biharmonisch fairen (Δ²x = 0, äußere zwei Knotenringe fest) → krümmungsstetiger Anschluss.
 * Ränder, die schon vorher offen waren, werden nicht gefüllt (skipped).
 */
export function eraseAndFill(m: RawMesh, center: number[], radius: number, seedTri: number, facing?: number[]): EraseResult {
  const P = m.positions, F = m.indices, nt = F.length / 3, nv = P.length / 3, r2 = radius * radius;
  const inside = (v: number) => (P[3 * v] - center[0]) ** 2 + (P[3 * v + 1] - center[1]) ** 2 + (P[3 * v + 2] - center[2]) ** 2 <= r2;
  const vf: number[][] = Array.from({ length: nv }, () => []);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) vf[F[3 * t + k]].push(t);
  const n = [0, 0, 0];
  const front = (t: number) => { if (!facing) return true; const l = faceNormal(P, F[3 * t], F[3 * t + 1], F[3 * t + 2], n) || 1; return (n[0] * facing[0] + n[1] * facing[1] + n[2] * facing[2]) / l > -0.2; };
  const del = new Uint8Array(nt); const stack = [seedTri]; del[seedTri] = 1; let removed = 0;
  while (stack.length) {
    const t = stack.pop()!; removed++;
    for (let k = 0; k < 3; k++) for (const s of vf[F[3 * t + k]]) {
      if (del[s]) continue;
      if ((inside(F[3 * s]) || inside(F[3 * s + 1]) || inside(F[3 * s + 2])) && front(s)) { del[s] = 1; stack.push(s); }
    }
  }
  // Lochkanten: gerichtete Kanten verbleibender Dreiecke, deren Gegenkante nur in gelöschten Dreiecken liegt
  const key = (a: number, b: number) => a * nv + b;
  const dirKeep = new Set<number>(), dirDel = new Set<number>();
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) (del[t] ? dirDel : dirKeep).add(key(F[3 * t + k], F[3 * t + (k + 1) % 3]));
  // Bow-tie-Knoten vermeiden: Knoten, an denen nach dem Löschen nur noch Dreiecke hängen, deren alle Knoten am Loch liegen, mitlöschen (eine Runde)
  const next = new Map<number, number>(); let skipped = 0;
  for (let t = 0; t < nt; t++) if (!del[t]) for (let k = 0; k < 3; k++) {
    const a = F[3 * t + k], b = F[3 * t + (k + 1) % 3];
    if (!dirKeep.has(key(b, a)) && dirDel.has(key(b, a))) {
      if (next.has(b)) { skipped++; continue; }
      next.set(b, a); // Lochrand läuft entgegen der Dreiecksorientierung: b -> a
    }
  }
  const loops: number[][] = []; const seen = new Set<number>();
  for (const s of next.keys()) {
    if (seen.has(s)) continue;
    const L: number[] = []; let v = s, guard = 0;
    while (!seen.has(v) && next.has(v) && guard++ < 1e6) { seen.add(v); L.push(v); v = next.get(v)!; }
    if (v === s && L.length >= 3) loops.push(L); else skipped++;
  }
  const pos: number[] = Array.from(P), idx: number[] = [];
  for (let t = 0; t < nt; t++) if (!del[t]) idx.push(F[3 * t], F[3 * t + 1], F[3 * t + 2]);
  // mittlere Kantenlänge
  let el = 0, ec = 0; for (let t = 0; t < Math.min(nt, 5000); t++) { const a = F[3 * t], b = F[3 * t + 1]; el += Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]); ec++; }
  el /= ec || 1;
  const free = new Set<number>(); let added = 0;
  for (const L of loops) {
    const c = [0, 0, 0]; for (const v of L) for (let k = 0; k < 3; k++) c[k] += P[3 * v + k] / L.length;
    let rad = 0; for (const v of L) rad += Math.hypot(P[3 * v] - c[0], P[3 * v + 1] - c[1], P[3 * v + 2] - c[2]) / L.length;
    const rings = Math.max(1, Math.min(60, Math.round(rad / el)));
    const nL = L.length; let prev = L.slice();
    for (let j = 1; j < rings; j++) {
      const s = j / rings;
      // innere Ringe dünner besetzen, damit die Dreiecke nicht zur Mitte hin zu klein werden
      const cnt = Math.max(3, Math.round(nL * (1 - s)));
      const ring: number[] = [];
      for (let i = 0; i < cnt; i++) {
        const src = L[Math.floor((i * nL) / cnt)]; const id = pos.length / 3;
        pos.push(P[3 * src] + s * (c[0] - P[3 * src]), P[3 * src + 1] + s * (c[1] - P[3 * src + 1]), P[3 * src + 2] + s * (c[2] - P[3 * src + 2]));
        ring.push(id); free.add(id);
      }
      stitch(prev, ring, idx); prev = ring;
    }
    const ci = pos.length / 3; pos.push(c[0], c[1], c[2]); free.add(ci);
    for (let i = 0; i < prev.length; i++) idx.push(prev[i], prev[(i + 1) % prev.length], ci);
    added += 0;
  }
  added = free.size;
  // Fairing: biharmonisch per Gauss-Seidel-Iteration auf den freien Knoten (Umbrella-Operator)
  if (free.size) {
    const NV = pos.length / 3; const adj: Set<number>[] = new Array(NV);
    const need = new Set<number>(free);
    for (let t = 0; t < idx.length / 3; t++) { const a = idx[3 * t], b = idx[3 * t + 1], cc = idx[3 * t + 2]; if (free.has(a) || free.has(b) || free.has(cc)) { need.add(a); need.add(b); need.add(cc); } }
    for (const v of [...need]) if (!free.has(v)) for (const t of vf[v] ?? []) if (!del[t]) for (let k = 0; k < 3; k++) need.add(F[3 * t + k]);
    for (let t = 0; t < idx.length / 3; t++) {
      const tri = [idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]]; if (!tri.some((v) => need.has(v))) continue;
      for (let k = 0; k < 3; k++) { const a = tri[k], b = tri[(k + 1) % 3]; (adj[a] ??= new Set()).add(b); (adj[b] ??= new Set()).add(a); }
    }
    const X = Float64Array.from(pos); const Lp = new Float64Array(3 * NV);
    const lap = (v: number) => { const N = adj[v]; if (!N || !N.size) { Lp[3 * v] = Lp[3 * v + 1] = Lp[3 * v + 2] = 0; return; } let x = 0, y = 0, z = 0; for (const w of N) { x += X[3 * w]; y += X[3 * w + 1]; z += X[3 * w + 2]; } const i = 1 / N.size; Lp[3 * v] = x * i - X[3 * v]; Lp[3 * v + 1] = y * i - X[3 * v + 1]; Lp[3 * v + 2] = z * i - X[3 * v + 2]; };
    const nlist = [...need], flist = [...free];
    // erst harmonisch (schnell, stabil), dann biharmonisch
    for (let it = 0; it < 200; it++) for (const v of flist) { lap(v); X[3 * v] += Lp[3 * v]; X[3 * v + 1] += Lp[3 * v + 1]; X[3 * v + 2] += Lp[3 * v + 2]; }
    for (let it = 0; it < 600; it++) {
      for (const v of nlist) lap(v);
      for (const v of flist) {
        const N = adj[v]; let x = 0, y = 0, z = 0; for (const w of N) { x += Lp[3 * w]; y += Lp[3 * w + 1]; z += Lp[3 * w + 2]; }
        const i = 1 / N.size; const bx = x * i - Lp[3 * v], by = y * i - Lp[3 * v + 1], bz = z * i - Lp[3 * v + 2];
        const h = 0.25; X[3 * v] -= h * bx; X[3 * v + 1] -= h * by; X[3 * v + 2] -= h * bz;
      }
    }
    for (const v of flist) { pos[3 * v] = X[3 * v]; pos[3 * v + 1] = X[3 * v + 1]; pos[3 * v + 2] = X[3 * v + 2]; }
  }
  const out = compact(pos, idx, () => true, idx.length / 3);
  return { ...out, removed, added, loops: loops.length, skipped };
}
/** Zwei Ringe (äußerer a, innerer b, gleicher Umlaufsinn) zu einem Dreiecksstreifen verbinden. */
function stitch(a: number[], b: number[], idx: number[]) {
  let i = 0, j = 0; const na = a.length, nb = b.length;
  while (i < na || j < nb) {
    if (j >= nb || (i < na && (i + 1) / na <= (j + 1) / nb)) { idx.push(a[i % na], a[(i + 1) % na], b[j % nb]); i++; }
    else { idx.push(a[i % na], b[(j + 1) % nb], b[j % nb]); j++; }
  }
}

// ---------------------------------------------------------------- Vergleich zum Original
export function buildBVH(m: RawMesh): MeshBVH {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3)); g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  return new MeshBVH(g, { indirect: true });
}
/** Vorzeichenbehafteter Abstand der Punkte zu einem Netz (positiv = in Normalenrichtung außen). */
export function signedDistances(pts: Float32Array, target: RawMesh, bvh: MeshBVH = buildBVH(target)): { d: Float32Array; tri: Int32Array } {
  const n = pts.length / 3, d = new Float32Array(n), tri = new Int32Array(n), p = new THREE.Vector3(), tgt: any = {}, nn = [0, 0, 0];
  const T = target.indices, Q = target.positions;
  for (let i = 0; i < n; i++) {
    p.set(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]);
    const r = bvh.closestPointToPoint(p, tgt); if (!r) continue;
    const f = r.faceIndex; tri[i] = f; const l = faceNormal(Q, T[3 * f], T[3 * f + 1], T[3 * f + 2], nn) || 1;
    const s = (p.x - r.point.x) * nn[0] + (p.y - r.point.y) * nn[1] + (p.z - r.point.z) * nn[2];
    d[i] = (s < 0 ? -1 : 1) * r.distance;
    void l;
  }
  return { d, tri };
}
/**
 * Farbvergleich je Knoten des bearbeiteten Netzes, beidseitig: eigener Abstand zum Original und – damit auch
 * Reduktion (Knoten liegen exakt auf dem Original) sichtbar wird – die größte Abweichung der Originalpunkte, die diesem Knoten am nächsten sind.
 */
export function compareToOriginal(cur: RawMesh, orig: RawMesh, origBVH?: MeshBVH): { dev: Float32Array; maxPos: number; maxNeg: number; maxAbsOrigToCur: number } {
  const a = signedDistances(cur.positions, orig, origBVH).d;
  const back = signedDistances(orig.positions, cur);
  const dev = Float32Array.from(a); let maxAbs = 0;
  for (let i = 0; i < back.d.length; i++) {
    const f = back.tri[i], v0 = cur.indices[3 * f], v1 = cur.indices[3 * f + 1], v2 = cur.indices[3 * f + 2];
    const px = orig.positions[3 * i], py = orig.positions[3 * i + 1], pz = orig.positions[3 * i + 2];
    let bv = v0, bd = Infinity; for (const v of [v0, v1, v2]) { const dd = (cur.positions[3 * v] - px) ** 2 + (cur.positions[3 * v + 1] - py) ** 2 + (cur.positions[3 * v + 2] - pz) ** 2; if (dd < bd) { bd = dd; bv = v; } }
    const val = -back.d[i]; // Original außerhalb der Bearbeitung => Bearbeitung liegt innen (negativ)
    if (Math.abs(val) > Math.abs(dev[bv])) dev[bv] = val;
    maxAbs = Math.max(maxAbs, Math.abs(back.d[i]));
  }
  let maxPos = 0, maxNeg = 0; for (const x of dev) { if (x > maxPos) maxPos = x; if (x < maxNeg) maxNeg = x; }
  return { dev, maxPos, maxNeg, maxAbsOrigToCur: maxAbs };
}
