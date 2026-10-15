// Parallele Dreiecksreduktion: Zerlegung in Scheiben entlang der längsten Achse, jede Scheibe unabhängig
// (Scheibenränder sind offene Kanten → automatisch fest), danach Zusammenfügen und Nahtdurchgang:
// nur Knoten nahe den Nähten beweglich, Toleranz/Normalen gegen das ORIGINAL im Nahtstreifen – die beidseitige Garantie bleibt erhalten.
import { decimate, DecimateOptions, DecimateResult, RawMesh } from './polyedit';

export interface DecChunk { mesh: RawMesh; gv: Uint32Array }

/** Dreiecke nach Schwerpunkt in k Scheiben gleicher Dreiecksanzahl */
export function partition(m: RawMesh, k: number): { chunks: DecChunk[]; axis: number } {
  const P = m.positions, I = m.indices, nt = I.length / 3; const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i++) { const a = i % 3; if (P[i] < lo[a]) lo[a] = P[i]; if (P[i] > hi[a]) hi[a] = P[i]; }
  const axis = [0, 1, 2].reduce((b, a) => (hi[a] - lo[a] > hi[b] - lo[b] ? a : b), 0);
  const c = new Float32Array(nt); for (let t = 0; t < nt; t++) c[t] = (P[3 * I[3 * t] + axis] + P[3 * I[3 * t + 1] + axis] + P[3 * I[3 * t + 2] + axis]) / 3;
  const sorted = Float32Array.from(c).sort(); const cuts: number[] = []; for (let j = 1; j < k; j++) cuts.push(sorted[Math.floor((j * nt) / k)]);
  const which = (x: number) => { let j = 0; while (j < cuts.length && x >= cuts[j]) j++; return j; };
  const tl: number[][] = Array.from({ length: k }, () => []); for (let t = 0; t < nt; t++) tl[which(c[t])].push(t);
  const map = new Int32Array(P.length / 3); let epoch = 0; const stamp = new Int32Array(P.length / 3).fill(-1);
  const chunks = tl.filter((l) => l.length).map((l) => { epoch++; const gv: number[] = []; const idx = new Uint32Array(3 * l.length);
    for (let j = 0; j < l.length; j++) for (let e = 0; e < 3; e++) { const v = I[3 * l[j] + e]; if (stamp[v] !== epoch) { stamp[v] = epoch; map[v] = gv.length; gv.push(v); } idx[3 * j + e] = map[v]; }
    const pos = new Float32Array(3 * gv.length); for (let j = 0; j < gv.length; j++) { pos[3 * j] = P[3 * gv[j]]; pos[3 * j + 1] = P[3 * gv[j] + 1]; pos[3 * j + 2] = P[3 * gv[j] + 2]; }
    return { mesh: { positions: pos, indices: idx }, gv: Uint32Array.from(gv) }; });
  return { chunks, axis };
}

/** Teilergebnisse (mit vmap) zusammenfügen, Nahtstreifen bestimmen und den Nahtdurchgang ausführen */
export function mergeAndSeam(m: RawMesh, chunks: DecChunk[], parts: DecimateResult[], o: DecimateOptions, axis: number): DecimateResult {
  const nvG = m.positions.length / 3; const id = new Int32Array(nvG).fill(-1); const pos: number[] = []; const idx: number[] = [];
  const cnt = new Uint8Array(nvG); for (const c of chunks) for (const g of c.gv) if (cnt[g] < 255) cnt[g]++;
  parts.forEach((r, j) => { const gv = chunks[j].gv, vm = r.vmap!; const loc = new Int32Array(vm.length);
    for (let i = 0; i < vm.length; i++) { const g = gv[vm[i]]; if (id[g] < 0) { id[g] = pos.length / 3; pos.push(m.positions[3 * g], m.positions[3 * g + 1], m.positions[3 * g + 2]); } loc[i] = id[g]; }
    for (let i = 0; i < r.indices.length; i++) idx.push(loc[r.indices[i]]); });
  const M: RawMesh = { positions: new Float32Array(pos), indices: new Uint32Array(idx) }; const nv = pos.length / 3, nt = idx.length / 3;
  // Nahtknoten (in mehreren Scheiben) + 3 Ringe beweglich
  const free = new Uint8Array(nv); for (let g = 0; g < nvG; g++) if (cnt[g] > 1 && id[g] >= 0) free[id[g]] = 1;
  for (let r = 0; r < 3; r++) { const nx = free.slice(); for (let t = 0; t < nt; t++) { const a = idx[3 * t], b = idx[3 * t + 1], c = idx[3 * t + 2]; if (free[a] || free[b] || free[c]) nx[a] = nx[b] = nx[c] = 1; } free.set(nx); }
  // Ausdehnung der betroffenen Dreiecke entlang der Achse → Original-Streifen als Referenz
  const iv: [number, number][] = [];
  for (let t = 0; t < nt; t++) { const a = idx[3 * t], b = idx[3 * t + 1], c = idx[3 * t + 2]; if (!(free[a] || free[b] || free[c])) continue;
    const xs = [pos[3 * a + axis], pos[3 * b + axis], pos[3 * c + axis]]; iv.push([Math.min(...xs) - o.tol, Math.max(...xs) + o.tol]); }
  iv.sort((p, q) => p[0] - q[0]); const U: [number, number][] = []; for (const x of iv) { const l = U[U.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else U.push([x[0], x[1]]); }
  const inU = (lo: number, hi: number) => { let a = 0, b = U.length - 1; while (a <= b) { const mi = (a + b) >> 1; if (U[mi][1] < lo) a = mi + 1; else if (U[mi][0] > hi) b = mi - 1; else return true; } return false; };
  const OP = m.positions, OI = m.indices; const rid = new Int32Array(nvG).fill(-1); const rp: number[] = [], ri: number[] = [];
  for (let t = 0; t < OI.length / 3; t++) { const a = OI[3 * t], b = OI[3 * t + 1], c = OI[3 * t + 2]; const xa = OP[3 * a + axis], xb = OP[3 * b + axis], xc = OP[3 * c + axis];
    if (!inU(Math.min(xa, xb, xc), Math.max(xa, xb, xc))) continue;
    for (const v of [a, b, c]) { if (rid[v] < 0) { rid[v] = rp.length / 3; rp.push(OP[3 * v], OP[3 * v + 1], OP[3 * v + 2]); } ri.push(rid[v]); } }
  const frozen = new Uint8Array(nv); for (let v = 0; v < nv; v++) frozen[v] = free[v] ? 0 : 1;
  const r = decimate(M, { ...o, frozen, ref: { positions: new Float32Array(rp), indices: new Uint32Array(ri) }, onProgress: undefined });
  const rejects: Record<string, number> = {}; for (const p of [...parts, r]) for (const [k, v] of Object.entries(p.rejects ?? {})) rejects[k] = (rejects[k] ?? 0) + v;
  return { ...r, before: m.indices.length / 3, collapses: parts.reduce((s, p) => s + p.collapses, r.collapses), rejects, noiseDeg: parts[0]?.noiseDeg };
}

/** Komplett: Zerlegen, Teile über run() (z. B. Worker) reduzieren, Naht. k = 1 → normale Reduktion. */
export async function decimateParallel(m: RawMesh, o: DecimateOptions, k: number, run: (c: RawMesh, j: number) => Promise<DecimateResult>): Promise<DecimateResult> {
  if (k <= 1) return decimate(m, o);
  const { chunks, axis } = partition(m, k);
  const parts = await Promise.all(chunks.map((c, j) => run(c.mesh, j)));
  return mergeAndSeam(m, chunks, parts, o, axis);
}
