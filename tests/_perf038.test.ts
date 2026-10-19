// 0.38 measurement (not a gate): topology build + first Auto click per demo part, needle036 (= live 0.36/0.37) vs robust lazy
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { it } from 'vitest';
import { parseSTL } from '../src/core/io';
import { MeshTopology, setNormalMode } from '../src/core/region';
import { autoExtract } from '../src/core/aux';
import type { Vec3 } from '../src/core/linalg';
const files = (process.env.PF ?? 'beispielteil.stl,formdemo.stl.gz,flansch.stl.gz,inseldemo.stl.gz,multifeature.stl.gz').split(',');
it.skipIf(!process.env.PERF)('perf', () => {
  for (const f of files) { let b: Buffer = readFileSync('public/samples/' + f); if (f.endsWith('.gz')) b = gunzipSync(b);
    for (const mode of ['needle036', 'robust'] as const) { setNormalMode(mode); const mesh = parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, f);
      const t0 = performance.now(); const topo = new MeshTopology(mesh); const tt = performance.now() - t0; const P = mesh.positions, F = mesh.indices, nt = F.length / 3;
      const t = Math.floor(nt * 0.37), v = F[3 * t]; const pt: Vec3 = [P[3 * v], P[3 * v + 1], P[3 * v + 2]];
      const t1 = performance.now(); let ty = ''; try { { const r = autoExtract(mesh, topo, t, pt, { maxAngleDeg: 20, radius: 0 }, 300); ty = r.fit.type + ':' + r.indices.length + '+' + (r.aux?.indices.length ?? 0) + ' d=' + (r.fit.diameter ?? 0).toFixed(3); } } catch { ty = 'x'; } const tc = performance.now() - t1;
      console.log(`PERF ${f} ${mode} topo ${tt.toFixed(0)} ms firstAuto ${tc.toFixed(0)} ms ${ty} normals computed ${topo.rn?.computed ?? 'all'}/${P.length / 3} grows ${topo.growCalls} rnMs ${topo.rn ? topo.rn.ms.toFixed(0) : '-'}`); } }
}, 600000);
