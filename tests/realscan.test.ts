// 0.38: real scans from Martin – Multi-Feature (public demo) and Connector (PRIVATE, local only: /workspace/private-testdata,
// never in the repo/site; the test is skipped when the file is absent). Auto-extraction smoke test + timings.
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseSTL } from '../src/core/io';
import { MeshTopology } from '../src/core/region';
import { autoExtract } from '../src/core/aux';
import type { Vec3 } from '../src/core/linalg';
const FILES: [string, string][] = [['multifeature', 'public/samples/multifeature.stl.gz'], ['connector', process.env.PRIVATE_CONNECTOR ?? '/workspace/private-testdata/connector.stl']];
for (const [key, file] of FILES) describe.skipIf(!existsSync(file))(`real scan ${key}`, () => {
  it('loads, topology fast, Auto extraction works on random seeds', () => {
    let b: Buffer = readFileSync(file); if (file.endsWith('.gz')) b = gunzipSync(b);
    const t0 = performance.now(); const mesh = parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, key); const tParse = performance.now() - t0;
    const t1 = performance.now(); const topo = new MeshTopology(mesh); const tTopo = performance.now() - t1;
    const nt = mesh.indices.length / 3, P = mesh.positions, F = mesh.indices; let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
    const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const res: string[] = []; let ok = 0; const N = 12; const ms: number[] = [];
    // seeds area-weighted (a tap lands on large faces more often than on fine fillet triangles)
    const fa = mesh.faceAreas!, cum = new Float64Array(nt); let acc = 0; for (let t = 0; t < nt; t++) cum[t] = acc += fa[t];
    const pickT = () => { const x = rnd() * acc; let a = 0, z = nt - 1; while (a < z) { const m = (a + z) >> 1; if (cum[m] < x) a = m + 1; else z = m; } return a; };
    for (let i = 0; i < N; i++) { const t = pickT(), v = F[3 * t]; const pt: Vec3 = [P[3 * v], P[3 * v + 1], P[3 * v + 2]];
      const s = performance.now(); try { const r = autoExtract(mesh, topo, t, pt, { maxAngleDeg: 20, radius: 0 }, diag); ms.push(performance.now() - s); if (r.indices.length >= 20) ok++; res.push(`${r.fit.type}:${r.indices.length}`); } catch (e) { ms.push(performance.now() - s); res.push('x:' + String((e as Error).message).slice(0, 30)); } }
    ms.sort((a, b) => a - b);
    const memMB = (mesh.positions.byteLength + mesh.indices.byteLength + (mesh.faceNormals?.byteLength ?? 0) + (mesh.vertexNormals?.byteLength ?? 0) + topo.smooth.byteLength + topo.robustVN.byteLength + topo.vt.tris.byteLength * 2) / 1e6;
    console.log(`REAL ${key}: tris ${nt} parse ${tParse.toFixed(0)} ms topo ${tTopo.toFixed(0)} ms auto median ${ms[ms.length >> 1].toFixed(0)} ms max ${ms[ms.length - 1].toFixed(0)} ms ok ${ok}/${N} core-mem ${memMB.toFixed(0)} MB | ${res.join(' ')}`);
    expect(tTopo).toBeLessThan(3000); expect(ok).toBeGreaterThanOrEqual(Math.ceil(0.6 * N)); expect(memMB).toBeLessThan(250);
  }, 300000);
});
