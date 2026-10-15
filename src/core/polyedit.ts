// Polygonbearbeitung: Dreiecksreduktion (Kantenkollaps mit Quadrik-Fehler und harter Toleranz),
// Unterteilung (Loop, toleranzbegrenzt), Glättung (Taubin, toleranzbegrenzt), magischer Radierer (Loch stanzen + füllen + fairen)
// und Abweichungsvergleich zum Original (BVH-Abstand, vorzeichenbehaftet).
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { axisFromNormals, fitCylinder, fitPlane, fitSphere } from './fit';
import { basis, solve, type Vec3 } from './linalg';

export interface RawMesh { positions: Float32Array; indices: Uint32Array; }
/** Fortschritt: Dreiecke, erledigte Einheiten, optional Anteil 0..1 / Schritt i von n / Bezeichnung */
export type Progress = (triCount: number, done: number, info?: { frac?: number; step?: number; steps?: number; label?: string }) => void;

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

/** Sinus des kleinsten Innenwinkels (gegenüber der kürzesten Kante) */
function minAngleSin(P: ArrayLike<number>, a: number, b: number, c: number): number {
  const l = (i: number, j: number) => Math.hypot(P[3 * i] - P[3 * j], P[3 * i + 1] - P[3 * j + 1], P[3 * i + 2] - P[3 * j + 2]);
  const x = l(a, b), y = l(b, c), z = l(c, a); const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2], vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2];
  const A2 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); const mx = Math.max(x * y, y * z, z * x); return mx ? A2 / mx : 0;
}

/** Ungenutzte Knoten entfernen, tote Dreiecke weglassen. */
function compact(P: ArrayLike<number>, F: ArrayLike<number>, alive: (t: number) => boolean, nt: number): RawMesh & { vmap: Uint32Array } {
  const map = new Int32Array(P.length / 3).fill(-1); const pos: number[] = []; const idx: number[] = []; const vm: number[] = [];
  for (let t = 0; t < nt; t++) {
    if (!alive(t)) continue;
    for (let k = 0; k < 3; k++) {
      const v = F[3 * t + k];
      if (map[v] < 0) { map[v] = pos.length / 3; vm.push(v); pos.push(P[3 * v], P[3 * v + 1], P[3 * v + 2]); }
      idx.push(map[v]);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), vmap: new Uint32Array(vm) };
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
class Heap { // Min-Heap (Kosten, Halbkante u->v, Zeitstempel) – typisierte Felder, wachsend, ohne Allokation je Eintrag
  c = new Float64Array(1024); u = new Int32Array(1024); v = new Int32Array(1024); s = new Int32Array(1024); size = 0;
  pu = 0; pv = 0; ps = 0;
  private grow() { const n = this.c.length * 2; const c = new Float64Array(n); c.set(this.c); this.c = c; const u = new Int32Array(n); u.set(this.u); this.u = u; const v = new Int32Array(n); v.set(this.v); this.v = v; const s = new Int32Array(n); s.set(this.s); this.s = s; }
  push(c: number, u: number, v: number, s: number) {
    if (this.size === this.c.length) this.grow(); let i = this.size++; const C = this.c, U = this.u, V = this.v, S = this.s;
    while (i > 0) { const p = (i - 1) >> 1; if (C[p] <= c) break; C[i] = C[p]; U[i] = U[p]; V[i] = V[p]; S[i] = S[p]; i = p; }
    C[i] = c; U[i] = u; V[i] = v; S[i] = s;
  }
  /** kleinstes Element nach pu/pv/ps */
  pop() {
    const C = this.c, U = this.u, V = this.v, S = this.s; this.pu = U[0]; this.pv = V[0]; this.ps = S[0];
    const n = --this.size; const c = C[n], u = U[n], v = V[n], s = S[n]; let i = 0;
    for (;;) { let m = 2 * i + 1; if (m >= n) break; if (m + 1 < n && C[m + 1] < C[m]) m++; if (C[m] >= c) break; C[i] = C[m]; U[i] = U[m]; V[i] = V[m]; S[i] = S[m]; i = m; }
    C[i] = c; U[i] = u; V[i] = v; S[i] = s;
  }
}

export interface DecimateOptions { tol: number; minTris?: number; minQuality?: number; onProgress?: Progress; progressEvery?: number;
  /** max. Winkel zwischen neuer Dreiecksnormale und Originalnormalen der zugeordneten Punkte [°] – krümmungsadaptiv (Default 10°) */
  maxNormalDeg?: number;
  /** Kanten mit Flächenwinkel über diesem Wert sind Merkmalskanten: nur entlang der Kante kollabieren, Ecken fest (Default 30°) */
  featureDeg?: number;
  /** beidseitige Toleranz: Schwerpunkte/Kantenmitten neuer Dreiecke ≤ tol vom Original (Default an) */
  twoSided?: boolean;
  /** Glättungsringe der Referenznormalen (Scanrauschen), Default 3 */
  normalSmooth?: number;
  /** max. Kantenlänge der reduzierten Dreiecke (begrenzt die Dreiecksgröße), 0/undefined = ohne */
  maxEdge?: number;
  /** kleinster Innenwinkel neuer Dreiecke [°] (keine zu spitzen Dreiecke; schlechtere nur, wenn vorher schon schlechter) */
  minAngleDeg?: number;
  /** Knoten, die nicht bewegt/entfernt werden dürfen (z. B. Partitionsgrenzen) */
  frozen?: Uint8Array;
  /** Referenz-Original, falls m bereits reduziert ist (Nahtdurchgang): Toleranz/Normalen gegen dieses Netz */
  ref?: RawMesh; }
export interface DecimateResult extends RawMesh { before: number; after: number; maxDev: number; collapses: number; rejects?: Record<string, number>; noiseDeg?: number; /** je Ausgabeknoten der Eingabeknotenindex */ vmap?: Uint32Array; }

/**
 * Halbkanten-Kollaps (Knoten u wandert auf Nachbarknoten v; alle verbleibenden Knoten liegen damit auf dem Original),
 * Reihenfolge nach Quadrik-Fehler (Garland/Heckbert). Harte Grenze: jeder Originalknoten bleibt ≤ tol vom reduzierten Netz entfernt
 * (Originalpunkte werden den Dreiecken zugeordnet und bei jedem Kollaps neu verteilt und geprüft – analog zur Sehnenhöhe beim Polygonisieren).
 * Randknoten bleiben fest; Kollapse, die Dreiecke umklappen oder Splitter erzeugen, werden verworfen.
 */
export function decimate(m: RawMesh, o: DecimateOptions): DecimateResult {
  const P = Float64Array.from(m.positions), F = Int32Array.from(m.indices); const R = o.ref ?? m;
  const nv = P.length / 3, nt = F.length / 3, tol2 = o.tol * o.tol;
  // CAD-Tessellierung (Median-Dreiecksqualität < 0,3: lange Splitter) → Splitterschutz lockern, sonst wäre kaum ein Kollaps möglich
  let minQ = o.minQuality ?? 0.12;
  if (o.minQuality === undefined) { const qs: number[] = []; const nn = [0, 0, 0]; for (let t = 0; t < nt; t += Math.max(1, Math.floor(nt / 5000))) qs.push(quality(P, F[3 * t], F[3 * t + 1], F[3 * t + 2], nn)); qs.sort((a, b) => a - b); if ((qs[qs.length >> 1] ?? 1) < 0.3) minQ = 0.02; }
  const alive = new Uint8Array(nt).fill(1);
  const vf: number[][] = Array.from({ length: nv }, () => []);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) vf[F[3 * t + k]].push(t);
  const { isB } = boundaryEdges(F, nv); if (o.frozen) for (let v = 0; v < nv; v++) if (o.frozen[v]) isB[v] = 1;
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
  // als verkettete Listen in typisierten Feldern (keine Allokation je Kollaps)
  const ownH = new Int32Array(nt).fill(-1), ownN = new Int32Array(R.positions.length / 3).fill(-1);
  if (!o.ref) { for (let v = 0; v < nv; v++) if (vf[v].length) { const t = vf[v][0]; ownN[v] = ownH[t]; ownH[t] = v; } }
  else { const bc = buildBVH(m); const q = new THREE.Vector3(); const tg: any = {}; const RPs = R.positions;
    for (let v = 0; v < RPs.length / 3; v++) { q.set(RPs[3 * v], RPs[3 * v + 1], RPs[3 * v + 2]); const h = bc.closestPointToPoint(q, tg); if (!h) continue; const t = h.faceIndex!; ownN[v] = ownH[t]; ownH[t] = v; } }
  const O = R.positions; // Original (unverändert)
  // Originalnormalen (flächengewichtet, geglättet) für die Normalenabweichung – je Knoten eines Netzes
  const refNormals = (P: Float64Array, F: Int32Array): Float32Array => { const nv = P.length / 3, nt = F.length / 3;
  const ON = new Float32Array(3 * nv);
  // vorzeichenunabhängig (STL mit uneinheitlicher Orientierung): Flächennormalen am ersten Beitrag ausrichten
  for (let t = 0; t < nt; t++) { const a = F[3 * t], b = F[3 * t + 1], c = F[3 * t + 2]; faceNormal(P, a, b, c, n); for (const v of [a, b, c]) { const sg = ON[3 * v] * n[0] + ON[3 * v + 1] * n[1] + ON[3 * v + 2] * n[2] < 0 ? -1 : 1; ON[3 * v] += sg * n[0]; ON[3 * v + 1] += sg * n[1]; ON[3 * v + 2] += sg * n[2]; } }
  for (let v = 0; v < nv; v++) { const l = Math.hypot(ON[3 * v], ON[3 * v + 1], ON[3 * v + 2]) || 1; ON[3 * v] /= l; ON[3 * v + 1] /= l; ON[3 * v + 2] /= l; }
  // Scanrauschen: Referenznormalen über einige Ringe glätten (nicht über Merkmalskanten hinweg, siehe unten: dort Kantenwinkel)
  for (let it = 0; it < (o.normalSmooth ?? 3); it++) {
    const S = new Float32Array(3 * nv);
    for (let t = 0; t < nt; t++) { const a = F[3 * t], b = F[3 * t + 1], c = F[3 * t + 2];
      const sb = ON[3 * a] * ON[3 * b] + ON[3 * a + 1] * ON[3 * b + 1] + ON[3 * a + 2] * ON[3 * b + 2] < 0 ? -1 : 1, sc = ON[3 * a] * ON[3 * c] + ON[3 * a + 1] * ON[3 * c + 1] + ON[3 * a + 2] * ON[3 * c + 2] < 0 ? -1 : 1;
      const x = ON[3 * a] + sb * ON[3 * b] + sc * ON[3 * c], y = ON[3 * a + 1] + sb * ON[3 * b + 1] + sc * ON[3 * c + 1], z = ON[3 * a + 2] + sb * ON[3 * b + 2] + sc * ON[3 * c + 2];
      for (const v of [a, b, c]) { const sv = ON[3 * v] * x + ON[3 * v + 1] * y + ON[3 * v + 2] * z < 0 ? -1 : 1; if (Math.abs(ON[3 * v] * x + ON[3 * v + 1] * y + ON[3 * v + 2] * z) < 2.4) { S[3 * v] += ON[3 * v]; S[3 * v + 1] += ON[3 * v + 1]; S[3 * v + 2] += ON[3 * v + 2]; continue; } S[3 * v] += sv * x; S[3 * v + 1] += sv * y; S[3 * v + 2] += sv * z; } }
    for (let v = 0; v < nv; v++) { const l = Math.hypot(S[3 * v], S[3 * v + 1], S[3 * v + 2]) || 1; ON[3 * v] = S[3 * v] / l; ON[3 * v + 1] = S[3 * v + 1] / l; ON[3 * v + 2] = S[3 * v + 2] / l; }
  }
    return ON; };
  const RP = R === m ? P : Float64Array.from(R.positions), RF = R === m ? F : Int32Array.from(R.indices);
  const ON = refNormals(RP, RF); const ONc = R === m ? ON : refNormals(P, F);
  // Rauschniveau: 90. Perzentil des Winkels Originaldreieck ↔ geglättete Normale; erlaubt = Vorgabe + Rauschwinkel
  let noiseDeg = 0;
  { const a: number[] = []; const rt = RF.length / 3, step = Math.max(1, Math.floor(rt / 20000));
    for (let t = 0; t < rt; t += step) { const x = RF[3 * t], y = RF[3 * t + 1], z = RF[3 * t + 2]; const l = faceNormal(RP, x, y, z, n) || 1; let w = 0; for (const v of [x, y, z]) w = Math.max(w, Math.acos(Math.min(1, Math.abs(n[0] * ON[3 * v] + n[1] * ON[3 * v + 1] + n[2] * ON[3 * v + 2]) / l))); a.push(w); }
    a.sort((p2, q2) => p2 - q2); noiseDeg = ((a[Math.floor(0.9 * a.length)] ?? 0) * 180) / Math.PI; }
  const cosN = Math.cos((Math.min(80, (o.maxNormalDeg ?? 10) + noiseDeg) * Math.PI) / 180);
  // Merkmalskanten (Flächenwinkel) – Knoten mit ≠ 0/2 Merkmalskanten (Ecken, Enden) bleiben fest
  const cosF = Math.cos(((o.featureDeg ?? 30) * Math.PI) / 180);
  const ekey = (a: number, b: number) => (a < b ? a * nv + b : b * nv + a);
  const feat = new Set<number>();
  { const em = new Map<number, number>(); const fn = new Float64Array(3 * nt);
    for (let t = 0; t < nt; t++) { const l = faceNormal(P, F[3 * t], F[3 * t + 1], F[3 * t + 2], n) || 1; fn[3 * t] = n[0] / l; fn[3 * t + 1] = n[1] / l; fn[3 * t + 2] = n[2] / l; }
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
      const kk = ekey(F[3 * t + k], F[3 * t + (k + 1) % 3]); const o2 = em.get(kk);
      if (o2 === undefined) em.set(kk, t); else if (Math.abs(fn[3 * t] * fn[3 * o2] + fn[3 * t + 1] * fn[3 * o2 + 1] + fn[3 * t + 2] * fn[3 * o2 + 2]) < cosF) feat.add(kk);
    } }
  const fdeg = new Uint8Array(nv); for (const kk of feat) { const a = Math.floor(kk / nv), b = kk % nv; if (fdeg[a] < 255) fdeg[a]++; if (fdeg[b] < 255) fdeg[b]++; }
  const twoSided = o.twoSided ?? true; let bvh: MeshBVH | null = null; const qv = new THREE.Vector3(); const qt: any = {};
  if (twoSided) bvh = buildBVH({ positions: R.positions, indices: R.indices });
  const farFromOrig = (x: number, y: number, z: number) => { qv.set(x, y, z); const r = bvh!.closestPointToPoint(qv, qt, 0, o.tol * 1.0001); return !r || r.distance > o.tol; };
  const stamp = new Int32Array(nv);
  const heap = new Heap();
  // Nachbarn ohne Set: Markierung je Durchlauf (epoch), Ergebnis in wiederverwendetem Puffer
  const mark = new Int32Array(nv); let epoch = 0; let NB: Int32Array<ArrayBufferLike> = new Int32Array(64), NB2: Int32Array<ArrayBufferLike> = new Int32Array(64);
  const neighInto = (u: number, out: Int32Array<ArrayBufferLike>): [Int32Array<ArrayBufferLike>, number] => { epoch++; let k = 0; const L = vf[u];
    for (let j = 0; j < L.length; j++) { const i = 3 * L[j]; for (let e = 0; e < 3; e++) { const w = F[i + e]; if (w !== u && mark[w] !== epoch) { mark[w] = epoch; if (k === out.length) { const o2 = new Int32Array(2 * k); o2.set(out); out = o2; } out[k++] = w; } } }
    return [out, k]; };
  const pushV = (u: number) => {
    if (isB[u] || !vf[u].length || (fdeg[u] !== 0 && fdeg[u] !== 2)) return; stamp[u]++;
    const [b, k] = neighInto(u, NB2); NB2 = b;
    for (let j = 0; j < k; j++) { const v = b[j]; if (fdeg[u] === 2 && !feat.has(ekey(u, v))) continue; heap.push(qerr(u, v), u, v, stamp[u]); }
  };
  for (let u = 0; u < nv; u++) pushV(u);
  let tris = nt, collapses = 0; const minTris = o.minTris ?? 4, every = o.progressEvery ?? 20000;
  const n0 = [0, 0, 0], n1 = [0, 0, 0]; const rej = { geoQ: 0, geoFlip: 0, shared: 0, link: 0, geo: 0, tol: 0, normal: 0, twoSided: 0, planarFast: 0, angle: 0, edge: 0 };
  const maxE2 = o.maxEdge ? o.maxEdge * o.maxEdge : 0, minSin = o.minAngleDeg ? Math.sin((o.minAngleDeg * Math.PI) / 180) : 0;
  // wiederverwendete Puffer
  let MV = new Int32Array(64); const SH = new Int32Array(2); let PTS = new Int32Array(256), ASG = new Int32Array(256); let NN = new Float64Array(192);
  const cosPlanar = Math.cos((2 * Math.PI) / 180), band = o.tol / 4;
  while (heap.size && tris > minTris) {
    heap.pop(); const u = heap.pu, v = heap.pv, s = heap.ps;
    if (s !== stamp[u] || !vf[u].length || !vf[v].length) continue;
    // Dreiecke an Kante uv / übrige Dreiecke von u
    const VU = vf[u]; let ns = 0, nm = 0; if (MV.length < VU.length) MV = new Int32Array(2 * VU.length);
    for (let j = 0; j < VU.length; j++) { const t = VU[j]; if (F[3 * t] === v || F[3 * t + 1] === v || F[3 * t + 2] === v) { if (ns < 2) SH[ns] = t; ns++; } else MV[nm++] = t; }
    if (ns !== 2) { rej.shared++; continue; }
    // Link-Bedingung: gemeinsame Nachbarn genau 2
    let r1 = neighInto(v, NB2); NB2 = r1[0]; const ev = epoch; const r0 = neighInto(u, NB); NB = r0[0]; const nuN = r0[1];
    // mark[] trägt jetzt epoch von u; v-Nachbarn erneut prüfen über zweiten Durchlauf
    let common = 0; { const eu = epoch; const NV2 = NB2, nvN = r1[1]; for (let j = 0; j < nvN; j++) if (mark[NV2[j]] === eu) common++; void ev; }
    if (common !== 2) { rej.link++; continue; }
    // Geometrie prüfen (Umklappen, Splitter)
    let ok = true;
    for (let j = 0; j < nm; j++) { const t = MV[j];
      const i = 3 * t; const a = F[i], b = F[i + 1], c = F[i + 2];
      faceNormal(P, a, b, c, n0);
      const a2 = a === u ? v : a, b2 = b === u ? v : b, c2 = c === u ? v : c;
      const q = quality(P, a2, b2, c2, n1);
      const l0 = Math.hypot(n0[0], n0[1], n0[2]), l1 = Math.hypot(n1[0], n1[1], n1[2]);
      const q0 = l0 ? quality(P, a, b, c, n0) : 0;
      if (q < minQ && q < q0) { rej.geoQ++; ok = false; break; }
      if (!l1 || (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) / (l0 * l1) < 0.5) { rej.geoFlip++; ok = false; break; }
      if (minSin && minAngleSin(P, a2, b2, c2) < minSin && minAngleSin(P, a2, b2, c2) < minAngleSin(P, a, b, c)) { rej.angle++; ok = false; break; }
      if (maxE2) { const w1 = a === u ? b : a, w2 = c === u ? b : c; for (const w of [w1, w2]) { const dx = P[3 * w] - P[3 * v], dy = P[3 * w + 1] - P[3 * v + 1], dz = P[3 * w + 2] - P[3 * v + 2]; if (dx * dx + dy * dy + dz * dz > maxE2) { rej.edge++; ok = false; break; } } if (!ok) break; }
    }
    if (!ok) { rej.geo++; continue; }
    // neue Dreiecksnormalen
    if (NN.length < 3 * nm) NN = new Float64Array(6 * nm);
    for (let j = 0; j < nm; j++) { const i = 3 * MV[j]; const a = F[i] === u ? v : F[i], b = F[i + 1] === u ? v : F[i + 1], c = F[i + 2] === u ? v : F[i + 2]; const l = faceNormal(P, a, b, c, n1) || 1; NN[3 * j] = n1[0] / l; NN[3 * j + 1] = n1[1] / l; NN[3 * j + 2] = n1[2] / l; }
    // Toleranz: Originalpunkte aller Dreiecke von u auf neue Dreiecke verteilen
    let np = 0; for (let j = 0; j < VU.length; j++) for (let p = ownH[VU[j]]; p >= 0; p = ownN[p]) { if (np === PTS.length) { const x = new Int32Array(2 * np); x.set(PTS); PTS = x; const y = new Int32Array(2 * np); y.set(ASG); ASG = y; } PTS[np++] = p; }
    for (let k = 0; k < np && ok; k++) {
      const p = PTS[k], px = O[3 * p], py = O[3 * p + 1], pz = O[3 * p + 2]; let bd = Infinity, bt = -1;
      for (let j = 0; j < nm; j++) { const i = 3 * MV[j]; const a = F[i] === u ? v : F[i], b = F[i + 1] === u ? v : F[i + 1], c = F[i + 2] === u ? v : F[i + 2];
        const d = pointTriDist2(px, py, pz, P, a, b, c); if (d < bd) { bd = d; bt = j; } }
      if (bd > tol2) ok = false; else ASG[k] = bt;
    }
    if (!ok) { rej.tol++; continue; }
    // Normalenabweichung neuer Dreiecke gegenüber den Originalnormalen ihrer Punkte (hält Verrundungen/Übergänge fein)
    for (let j = 0; j < nm && ok; j++) { const i = 3 * MV[j]; const qx = NN[3 * j], qy = NN[3 * j + 1], qz = NN[3 * j + 2];
      for (let e = 0; e < 3; e++) { const w = F[i + e] === u ? v : F[i + e]; if (Math.abs(qx * ONc[3 * w] + qy * ONc[3 * w + 1] + qz * ONc[3 * w + 2]) < cosN) { ok = false; break; } } }
    for (let k = 0; k < np && ok; k++) { const j = ASG[k], p = PTS[k]; if (Math.abs(NN[3 * j] * ON[3 * p] + NN[3 * j + 1] * ON[3 * p + 1] + NN[3 * j + 2] * ON[3 * p + 2]) < cosN) ok = false; }
    if (!ok) { rej.normal++; continue; }
    // beidseitig: Schwerpunkt und Mitten der neuen Kanten müssen nahe am Original liegen.
    // Schnellpfad Ebene: alle neuen Normalen innerhalb 2° von der Normale bei v, Ring und zugeordnete Originalpunkte innerhalb tol/4 der Ebene
    // → neue Dreiecke liegen im Band ±tol/4, das Original ebenso → Abstand ≤ tol/2, BVH-Abfrage überflüssig.
    if (bvh) {
      let planar = true; const ex = NN[0], ey = NN[1], ez = NN[2], d0 = ex * P[3 * v] + ey * P[3 * v + 1] + ez * P[3 * v + 2];
      for (let j = 1; j < nm && planar; j++) if (NN[3 * j] * ex + NN[3 * j + 1] * ey + NN[3 * j + 2] * ez < cosPlanar) planar = false;
      for (let j = 0; j < nuN && planar; j++) { const w = NB[j]; if (Math.abs(ex * P[3 * w] + ey * P[3 * w + 1] + ez * P[3 * w + 2] - d0) > band) planar = false; }
      for (let k = 0; k < np && planar; k++) { const p = PTS[k]; if (Math.abs(ex * O[3 * p] + ey * O[3 * p + 1] + ez * O[3 * p + 2] - d0) > band) planar = false; }
      if (planar) rej.planarFast++;
      else {
        for (let j = 0; j < nm && ok; j++) { const i = 3 * MV[j]; const a = F[i] === u ? v : F[i], b = F[i + 1] === u ? v : F[i + 1], c = F[i + 2] === u ? v : F[i + 2];
          if (farFromOrig((P[3 * a] + P[3 * b] + P[3 * c]) / 3, (P[3 * a + 1] + P[3 * b + 1] + P[3 * c + 1]) / 3, (P[3 * a + 2] + P[3 * b + 2] + P[3 * c + 2]) / 3)) ok = false; }
        for (let j = 0; j < nuN && ok; j++) { const w = NB[j]; if (w === v) continue; if (farFromOrig((P[3 * v] + P[3 * w]) / 2, (P[3 * v + 1] + P[3 * w + 1]) / 2, (P[3 * v + 2] + P[3 * w + 2]) / 2)) ok = false; }
        if (!ok) { rej.twoSided++; continue; }
      }
    }
    // Kollaps ausführen
    for (let j = 0; j < VU.length; j++) ownH[VU[j]] = -1;
    for (let k = 0; k < np; k++) { const t = MV[ASG[k]], p = PTS[k]; ownN[p] = ownH[t]; ownH[t] = p; }
    for (let h = 0; h < 2; h++) { const t = SH[h]; alive[t] = 0; for (let k = 0; k < 3; k++) { const w = F[3 * t + k]; if (w !== u) { const L = vf[w]; const ix = L.indexOf(t); L[ix] = L[L.length - 1]; L.pop(); } } }
    const VV = vf[v]; for (let j = 0; j < nm; j++) { const t = MV[j]; for (let k = 0; k < 3; k++) if (F[3 * t + k] === u) F[3 * t + k] = v; VV.push(t); }
    if (fdeg[u]) for (let j = 0; j < nuN; j++) { const w = NB[j]; const kk = ekey(u, w); if (feat.has(kk)) { feat.delete(kk); if (w !== v) feat.add(ekey(v, w)); } }
    vf[u] = []; tris -= 2; collapses++;
    for (let i = 0; i < 10; i++) Q[10 * v + i] += Q[10 * u + i];
    pushV(v); { const [b, k] = neighInto(v, NB); NB = b; const cp = b.slice(0, k); for (let j = 0; j < k; j++) pushV(cp[j]); }
    if (o.onProgress && collapses % every === 0) o.onProgress(tris, collapses, { frac: Math.min(0.99, (nt - tris) / (0.9 * nt)), label: `Reduktion: ${tris.toLocaleString('de-DE')} △` });
  }
  const r = compact(P, F, (t) => !!alive[t], nt);
  return { ...r, before: nt, after: tris, maxDev: NaN, collapses, rejects: rej, noiseDeg };
}

// ---------------------------------------------------------------- Unterteilung
export interface SubdivideOptions { tol: number; levels?: number; maxTris?: number; onProgress?: Progress;
  /** danach Kanten länger als maxEdge halbieren (Längste-Kante-Bisektion, Winkel bleiben ≥ ½ der Ausgangswinkel) */
  maxEdge?: number; }

/** Längste-Kante-Bisektion, bis alle Kanten ≤ maxEdge (lineare Mittelpunkte: Fläche unverändert) */
export function splitLongEdges(P0: ArrayLike<number>, F0: ArrayLike<number>, maxEdge: number, maxTris = 3_000_000): { P: Float64Array; F: Uint32Array } {
  const P: number[] = Array.from(P0), F: number[] = Array.from(F0); const m2 = maxEdge * maxEdge;
  const l2 = (a: number, b: number) => (P[3 * a] - P[3 * b]) ** 2 + (P[3 * a + 1] - P[3 * b + 1]) ** 2 + (P[3 * a + 2] - P[3 * b + 2]) ** 2;
  for (let pass = 0; pass < 30 && F.length / 3 < maxTris; pass++) {
    const nv0 = P.length / 3; const split = new Map<number, number>(); const key = (a: number, b: number) => (a < b ? a * nv0 + b : b * nv0 + a);
    const nt = F.length / 3; const lk = new Int8Array(nt).fill(-1);
    for (let t = 0; t < nt; t++) { let best = -1, bl = m2; for (let k = 0; k < 3; k++) { const d = l2(F[3 * t + k], F[3 * t + (k + 1) % 3]); if (d > bl) { bl = d; best = k; } } lk[t] = best; if (best >= 0) { const a = F[3 * t + best], b = F[3 * t + (best + 1) % 3]; const kk = key(a, b); if (!split.has(kk)) { split.set(kk, P.length / 3); P.push((P[3 * a] + P[3 * b]) / 2, (P[3 * a + 1] + P[3 * b + 1]) / 2, (P[3 * a + 2] + P[3 * b + 2]) / 2); } } }
    if (!split.size) break;
    // jedes Dreieck: an seiner Kante mit Mittelpunkt teilen (längste zuerst; je Durchgang höchstens eine Teilung je Dreieck – Rest im nächsten Durchgang, Nachbar-T-Stellen über alle 3 Kanten prüfen)
    const out: number[] = [];
    for (let t = 0; t < nt; t++) { let k = -1; for (let e = 0; e < 3; e++) if (split.has(key(F[3 * t + e], F[3 * t + (e + 1) % 3]))) { if (k < 0 || e === lk[t]) k = e; }
      if (k < 0) { out.push(F[3 * t], F[3 * t + 1], F[3 * t + 2]); continue; }
      const a = F[3 * t + k], b = F[3 * t + (k + 1) % 3], c = F[3 * t + (k + 2) % 3], mm = split.get(key(a, b))!;
      // weitere markierte Kanten dieses Dreiecks rekursiv mitteilen (keine T-Stellen)
      const sub = (x: number, y: number, z: number, depth: number): void => { // Dreieck x,y,z
        if (depth > 0) for (let e = 0; e < 3; e++) { const p = [x, y, z][e], q = [x, y, z][(e + 1) % 3], r = [x, y, z][(e + 2) % 3]; const kk = p < nv0 && q < nv0 ? key(p, q) : -1; const s2 = kk >= 0 ? split.get(kk) : undefined;
          if (s2 !== undefined) { sub(p, s2, r, depth - 1); sub(s2, q, r, depth - 1); return; } }
        out.push(x, y, z); };
      sub(a, mm, c, 2); sub(mm, b, c, 2); }
    F.length = 0; for (const x of out) F.push(x);
  }
  return { P: Float64Array.from(P), F: Uint32Array.from(F) };
}
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
    o.onProgress?.(F.length / 3, lv + 1, { frac: (lv + 1) / levels, step: lv + 1, steps: levels, label: `Unterteilung Stufe ${lv + 1}` });
    // Nach Stufe 1 sind die „linearen“ Lagen nicht mehr auf dem Original: weitere Stufen nur linear + begrenzt (konservativ)
    if (lv === 0) o = { ...o, tol: o.tol / 4 };
  }
  if (o.maxEdge && o.maxEdge > 0) { const r = splitLongEdges(P, F, o.maxEdge, maxTris); P = r.P as any; F = r.F as any; }
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
    o.onProgress?.(F.length / 3, it + 1, { frac: (it + 1) / o.iterations, label: `Glättung Iteration ${it + 1}/${o.iterations}` });
  }
  return { positions: Float32Array.from(P), indices: Uint32Array.from(F) };
}

// ---------------------------------------------------------------- Magischer Radierer
export interface EraseResult extends RawMesh { removed: number; added: number; loops: number; skipped: number; surfaces: string[]; }

/** Analytische Ersatzfläche für die Lochfüllung. */
export type FillSurface =
  | { kind: 'Ebene'; c: Vec3; n: Vec3; rms: number }
  | { kind: 'Zylinder'; c: Vec3; a: Vec3; r: number; rms: number }
  | { kind: 'Kugel'; c: Vec3; r: number; rms: number }
  | { kind: 'Quadrik'; c: Vec3; u: Vec3; v: Vec3; n: Vec3; k: number[]; rms: number };
const vsub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vdot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vunit = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export function projectTo(s: FillSurface, p: Vec3): Vec3 {
  if (s.kind === 'Ebene') { const d = vdot(vsub(p, s.c), s.n); return [p[0] - d * s.n[0], p[1] - d * s.n[1], p[2] - d * s.n[2]]; }
  if (s.kind === 'Kugel') { const w = vunit(vsub(p, s.c)); return [s.c[0] + s.r * w[0], s.c[1] + s.r * w[1], s.c[2] + s.r * w[2]]; }
  if (s.kind === 'Zylinder') {
    const w = vsub(p, s.c), t = vdot(w, s.a), q: Vec3 = [s.c[0] + t * s.a[0], s.c[1] + t * s.a[1], s.c[2] + t * s.a[2]], rd = vunit(vsub(p, q));
    return [q[0] + s.r * rd[0], q[1] + s.r * rd[1], q[2] + s.r * rd[2]];
  }
  const w = vsub(p, s.c), x = vdot(w, s.u), y = vdot(w, s.v), k = s.k, h = k[0] + k[1] * x + k[2] * y + k[3] * x * x + k[4] * x * y + k[5] * y * y;
  return [s.c[0] + x * s.u[0] + y * s.v[0] + h * s.n[0], s.c[1] + x * s.u[1] + y * s.v[1] + h * s.n[1], s.c[2] + x * s.u[2] + y * s.v[2] + h * s.n[2]];
}
const surfDist = (s: FillSurface, p: Vec3) => { const q = projectTo(s, p); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
function rmsOf(s: FillSurface, P: Vec3[]) { let e = 0; for (const p of P) e += surfDist(s, p) ** 2; return Math.sqrt(e / Math.max(1, P.length)); }

function fitQuadric(P: Vec3[]): FillSurface | null {
  if (P.length < 8) return null;
  const pl = fitPlane(P); const [u, v] = basis(pl.normal); const c = pl.center, n = pl.normal;
  const A: number[][] = Array.from({ length: 6 }, () => new Array(6).fill(0)), b = new Array(6).fill(0);
  for (const p of P) { const w = vsub(p, c), x = vdot(w, u), y = vdot(w, v), z = vdot(w, n); const r = [1, x, y, x * x, x * y, y * y];
    for (let i = 0; i < 6; i++) { b[i] += r[i] * z; for (let j = 0; j < 6; j++) A[i][j] += r[i] * r[j]; } }
  for (let i = 0; i < 6; i++) A[i][i] += 1e-9;
  const k = solve(A, b); if (!k) return null;
  const s: FillSurface = { kind: 'Quadrik', c, u, v, n, k, rms: 0 }; s.rms = rmsOf(s, P); return s;
}
/** Beste Primitive (Ebene, Zylinder, Kugel) für eine Punktmenge; einfachere Form bevorzugt, wenn kaum schlechter. */
export function fitPrimitive(P: Vec3[], N: Vec3[]): FillSurface | null {
  const c: FillSurface[] = [];
  try { const f = fitPlane(P); c.push({ kind: 'Ebene', c: f.center, n: f.normal, rms: f.rms }); } catch { /* */ }
  if (P.length >= 12) {
    try { const ax = axisFromNormals(N).axis; const f = fitCylinder(P, ax); if (isFinite(f.rms) && f.radius! < 1e4) { const s: FillSurface = { kind: 'Zylinder', c: f.center, a: vunit(f.normal), r: f.radius!, rms: 0 }; s.rms = rmsOf(s, P); c.push(s); } } catch { /* */ }
    try { const f = fitSphere(P); if (isFinite(f.rms) && f.radius! < 1e4) { const s: FillSurface = { kind: 'Kugel', c: f.center, r: f.radius!, rms: 0 }; s.rms = rmsOf(s, P); c.push(s); } } catch { /* */ }
  }
  if (!c.length) return null;
  const mn = Math.min(...c.map((x) => x.rms));
  return c.find((x) => x.rms <= 1.5 * mn + 1e-6)!;
}

/**
 * Stützring um das Loch → Ersatzflächen: eine Primitive, sonst Segmentierung (dominante Ebene über Normalen + Rest),
 * sonst lokale Quadrik. Liefert Flächen und Zuordnung je Stützpunkt.
 */
export function fitSupport(P: Vec3[], N: Vec3[], okRms: number): { surfaces: FillSurface[]; label: Int32Array } {
  const label = new Int32Array(P.length);
  const one = fitPrimitive(P, N);
  if (one && one.rms <= okRms) return { surfaces: [one], label };
  // Segmentierung: dominante Normalenrichtung (±5°) → Ebene; Rest → Primitive
  const cos5 = Math.cos((5 * Math.PI) / 180); let bestN: Vec3 | null = null, bestC = 0;
  const step = Math.max(1, Math.floor(P.length / 60));
  for (let i = 0; i < P.length; i += step) { let cnt = 0; for (const q of N) if (vdot(q, N[i]) > cos5) cnt++; if (cnt > bestC) { bestC = cnt; bestN = N[i]; } }
  if (bestN && bestC > 0.2 * P.length && P.length - bestC > 0.15 * P.length) {
    const ia: number[] = [], ib: number[] = [];
    N.forEach((q, i) => (vdot(q, bestN!) > cos5 ? ia : ib).push(i));
    const sa = fitPrimitive(ia.map((i) => P[i]), ia.map((i) => N[i]));
    // Rest: evtl. selbst wieder eine dominante Ebene (Kante zwischen zwei Ebenen) – rekursiv eine Stufe
    const PB = ib.map((i) => P[i]), NB = ib.map((i) => N[i]);
    let sb = fitPrimitive(PB, NB);
    if (sa && sb && sa.rms <= okRms && sb.rms <= okRms) {
      ia.forEach((i) => (label[i] = 0)); ib.forEach((i) => (label[i] = 1));
      return { surfaces: [sa, sb], label };
    }
    if (sa && sa.rms <= okRms) { const q = fitQuadric(PB); if (q && q.rms <= okRms) { sb = q; ia.forEach((i) => (label[i] = 0)); ib.forEach((i) => (label[i] = 1)); return { surfaces: [sa, sb], label }; } }
  }
  const q = fitQuadric(P);
  if (q && (!one || q.rms < one.rms)) return { surfaces: [q], label };
  return { surfaces: one ? [one] : [], label };
}

export interface EraseOptions { /** Abstandsschwelle für „passt“ (mm); Default 0,15 × mittlere Kantenlänge */ okRms?: number; }
/**
 * Magischer Radierer: ausgewählte Knoten (Pinsel) samt anliegenden Dreiecken entfernen, Lochränder suchen,
 * Ersatzfläche aus dem umgebenden Stützring fitten (Ebene/Zylinder/Kugel, zwei Flächen mit Kante, sonst Quadrik),
 * Loch ringweise mit umgebungsgleicher Dichte triangulieren, auf die Fläche(n) projizieren (Kantenknoten auf die Schnittlinie),
 * tangential entspannen. Ohne brauchbaren Fit: biharmonisches Fairing.
 */
export function eraseAndFill(m: RawMesh, sel: ArrayLike<number>, o: EraseOptions = {}): EraseResult {
  const P = m.positions, F = m.indices, nt = F.length / 3, nv = P.length / 3;
  const selM = new Uint8Array(nv); for (let i = 0; i < sel.length; i++) selM[sel[i]] = 1;
  const vf: number[][] = Array.from({ length: nv }, () => []);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) vf[F[3 * t + k]].push(t);
  const del = new Uint8Array(nt); let removed = 0;
  for (let t = 0; t < nt; t++) if (selM[F[3 * t]] || selM[F[3 * t + 1]] || selM[F[3 * t + 2]]) { del[t] = 1; removed++; }
  // Normalen
  const VN = new Float32Array(3 * nv); const n = [0, 0, 0];
  for (let t = 0; t < nt; t++) { const a = F[3 * t], b = F[3 * t + 1], c = F[3 * t + 2]; faceNormal(P, a, b, c, n); for (const v of [a, b, c]) { VN[3 * v] += n[0]; VN[3 * v + 1] += n[1]; VN[3 * v + 2] += n[2]; } }
  for (let v = 0; v < nv; v++) { const l = Math.hypot(VN[3 * v], VN[3 * v + 1], VN[3 * v + 2]) || 1; VN[3 * v] /= l; VN[3 * v + 1] /= l; VN[3 * v + 2] /= l; }
  // Lochränder
  const key = (a: number, b: number) => a * nv + b;
  const dirKeep = new Set<number>(), dirDel = new Set<number>();
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) (del[t] ? dirDel : dirKeep).add(key(F[3 * t + k], F[3 * t + (k + 1) % 3]));
  const next = new Map<number, number>(); let skipped = 0;
  for (let t = 0; t < nt; t++) if (!del[t]) for (let k = 0; k < 3; k++) {
    const a = F[3 * t + k], b = F[3 * t + (k + 1) % 3];
    if (!dirKeep.has(key(b, a)) && dirDel.has(key(b, a))) { if (next.has(b)) { skipped++; continue; } next.set(b, a); }
  }
  const loops: number[][] = []; const seen = new Set<number>();
  for (const s0 of next.keys()) {
    if (seen.has(s0)) continue;
    const L: number[] = []; let v = s0, guard = 0;
    while (!seen.has(v) && next.has(v) && guard++ < 1e6) { seen.add(v); L.push(v); v = next.get(v)!; }
    if (v === s0 && L.length >= 3) loops.push(L); else skipped++;
  }
  // Knotenringe der verbleibenden Fläche (für Stützring-BFS)
  const keepAdj = (v: number, cb: (w: number) => void) => { for (const t of vf[v]) if (!del[t]) for (let k = 0; k < 3; k++) { const w = F[3 * t + k]; if (w !== v) cb(w); } };
  let el = 0, ec = 0; for (let t = 0; t < nt; t += Math.max(1, Math.floor(nt / 5000))) { const a = F[3 * t], b = F[3 * t + 1]; el += Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]); ec++; }
  el /= ec || 1;
  const okRms = o.okRms ?? 0.15 * el;
  const pos: number[] = Array.from(P), idx: number[] = [], surfacesUsed: string[] = [];
  for (let t = 0; t < nt; t++) if (!del[t]) idx.push(F[3 * t], F[3 * t + 1], F[3 * t + 2]);
  const allFree: number[] = [];
  const fills: { free: number[]; surf: FillSurface[]; lab: Map<number, number> }[] = [];
  for (const L of loops) {
    const c: Vec3 = [0, 0, 0]; for (const v of L) for (let k = 0; k < 3; k++) c[k] += P[3 * v + k] / L.length;
    let rad = 0; for (const v of L) rad += Math.hypot(P[3 * v] - c[0], P[3 * v + 1] - c[1], P[3 * v + 2] - c[2]) / L.length;
    // Stützring (BFS-Tiefe ~ Lochradius)
    const depth = Math.max(3, Math.min(10, Math.round(rad / el)));
    const dist = new Map<number, number>(); let front = L.slice(); L.forEach((v) => dist.set(v, 0));
    for (let d = 1; d <= depth; d++) { const nf: number[] = []; for (const v of front) keepAdj(v, (w) => { if (!dist.has(w) && !selM[w]) { dist.set(w, d); nf.push(w); } }); front = nf; }
    const sup = [...dist.keys()];
    const SP = sup.map((v) => [P[3 * v], P[3 * v + 1], P[3 * v + 2]] as Vec3), SN = sup.map((v) => [VN[3 * v], VN[3 * v + 1], VN[3 * v + 2]] as Vec3);
    const fit = fitSupport(SP, SN, okRms);
    surfacesUsed.push(fit.surfaces.map((x) => x.kind).join('+') || 'Fairing');
    // Triangulierung (Ringe, Dichte ≈ Umgebung)
    const rings = Math.max(1, Math.min(80, Math.round(rad / el)));
    const nL = L.length; let prev = L.slice(); const free: number[] = [];
    for (let j = 1; j < rings; j++) {
      const s = j / rings, cnt = Math.max(3, Math.round(nL * (1 - s))); const ring: number[] = [];
      for (let i = 0; i < cnt; i++) { const src = L[Math.floor((i * nL) / cnt)]; const id = pos.length / 3;
        pos.push(P[3 * src] + s * (c[0] - P[3 * src]), P[3 * src + 1] + s * (c[1] - P[3 * src + 1]), P[3 * src + 2] + s * (c[2] - P[3 * src + 2])); ring.push(id); free.push(id); }
      stitch(prev, ring, idx); prev = ring;
    }
    const ci = pos.length / 3; pos.push(c[0], c[1], c[2]); free.push(ci);
    for (let i = 0; i < prev.length; i++) idx.push(prev[i], prev[(i + 1) % prev.length], ci);
    allFree.push(...free);
    // Zuordnung der neuen Knoten folgt später (nach harmonischer Startlage) über den nächsten Stützpunkt
    const lab = new Map<number, number>(); sup.forEach((v, i) => lab.set(v, fit.label[i]));
    fills.push({ free, surf: fit.surfaces, lab });
    (fills[fills.length - 1] as any).sup = sup;
  }
  // Nachbarschaft der neuen + Randknoten
  const NV = pos.length / 3; const adj: Set<number>[] = new Array(NV);
  const freeSet = new Set(allFree);
  const need = new Set<number>(allFree);
  for (let t = 0; t < idx.length / 3; t++) { const a = idx[3 * t], b = idx[3 * t + 1], cc = idx[3 * t + 2]; if (freeSet.has(a) || freeSet.has(b) || freeSet.has(cc)) { need.add(a); need.add(b); need.add(cc); } }
  for (const v of [...need]) if (!freeSet.has(v) && v < nv) for (const t of vf[v]) if (!del[t]) for (let k = 0; k < 3; k++) need.add(F[3 * t + k]);
  for (let t = 0; t < idx.length / 3; t++) {
    const tri = [idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]]; if (!tri.some((v) => need.has(v))) continue;
    for (let k = 0; k < 3; k++) { const a = tri[k], b = tri[(k + 1) % 3]; (adj[a] ??= new Set()).add(b); (adj[b] ??= new Set()).add(a); }
  }
  const X = Float64Array.from(pos);
  const avg = (v: number): Vec3 => { let x = 0, y = 0, z = 0; for (const w of adj[v]) { x += X[3 * w]; y += X[3 * w + 1]; z += X[3 * w + 2]; } const i = 1 / adj[v].size; return [x * i, y * i, z * i]; };
  // harmonische Startlage
  for (let it = 0; it < 200; it++) for (const v of allFree) { const a = avg(v); X[3 * v] = a[0]; X[3 * v + 1] = a[1]; X[3 * v + 2] = a[2]; }
  const get = (v: number): Vec3 => [X[3 * v], X[3 * v + 1], X[3 * v + 2]];
  const put = (v: number, p: Vec3) => { X[3 * v] = p[0]; X[3 * v + 1] = p[1]; X[3 * v + 2] = p[2]; };
  for (const f of fills) {
    if (!f.surf.length) { biharmonic(X, adj, f.free, [...need]); continue; }
    const sup: number[] = (f as any).sup;
    const assign = new Map<number, number>();
    const proj = (v: number) => {
      const p = get(v);
      if (f.surf.length === 1) { put(v, projectTo(f.surf[0], p)); return; }
      // Zuordnung: Fläche mit kleinerem Abstand, bei Gleichstand nächster Stützpunkt
      let bi = 0, bd = Infinity; for (const s of sup) { const d = (P[3 * s] - p[0]) ** 2 + (P[3 * s + 1] - p[1]) ** 2 + (P[3 * s + 2] - p[2]) ** 2; if (d < bd) { bd = d; bi = s; } }
      const k = f.lab.get(bi) ?? 0; assign.set(v, k); put(v, projectTo(f.surf[k], p));
    };
    for (let round = 0; round < 6; round++) {
      for (const v of f.free) proj(v);
      // Kantenknoten (Nachbar auf anderer Fläche) auf die Schnittlinie: abwechselnd projizieren
      if (f.surf.length === 2) for (const v of f.free) {
        const k = assign.get(v)!; let other = false; for (const w of adj[v]) { const kw = assign.get(w) ?? (f.lab.get(w)); if (kw !== undefined && kw !== k) { other = true; break; } }
        if (!other) continue; let p = get(v); for (let i = 0; i < 30; i++) p = projectTo(f.surf[i & 1], p); put(v, p);
      }
      if (round < 5) for (const v of f.free) { const a = avg(v), p = get(v); put(v, [p[0] + 0.5 * (a[0] - p[0]), p[1] + 0.5 * (a[1] - p[1]), p[2] + 0.5 * (a[2] - p[2])]); }
    }
  }
  for (const v of allFree) { pos[3 * v] = X[3 * v]; pos[3 * v + 1] = X[3 * v + 1]; pos[3 * v + 2] = X[3 * v + 2]; }
  const out = compact(pos, idx, () => true, idx.length / 3);
  return { ...out, removed, added: allFree.length, loops: loops.length, skipped, surfaces: surfacesUsed };
}
function biharmonic(X: Float64Array, adj: Set<number>[], flist: number[], nlist: number[]) {
  const Lp = new Float64Array(X.length);
  const lap = (v: number) => { const N = adj[v]; if (!N || !N.size) return; let x = 0, y = 0, z = 0; for (const w of N) { x += X[3 * w]; y += X[3 * w + 1]; z += X[3 * w + 2]; } const i = 1 / N.size; Lp[3 * v] = x * i - X[3 * v]; Lp[3 * v + 1] = y * i - X[3 * v + 1]; Lp[3 * v + 2] = z * i - X[3 * v + 2]; };
  for (let it = 0; it < 600; it++) {
    for (const v of nlist) lap(v);
    for (const v of flist) { const N = adj[v]; let x = 0, y = 0, z = 0; for (const w of N) { x += Lp[3 * w]; y += Lp[3 * w + 1]; z += Lp[3 * w + 2]; } const i = 1 / N.size;
      X[3 * v] -= 0.25 * (x * i - Lp[3 * v]); X[3 * v + 1] -= 0.25 * (y * i - Lp[3 * v + 1]); X[3 * v + 2] -= 0.25 * (z * i - Lp[3 * v + 2]); }
  }
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
