// Lasttest: ~1 Mio. Punkte (2 Mio. Dreiecke), nur mit PERF=1 ausführen.
import { it } from 'vitest';
import { parseSTL, writeSTL } from '../src/core/io';
import { MeshTopology, gather } from '../src/core/region';
import { autoFit } from '../src/core/fit';
it.runIf(process.env.PERF)('1 Mio. Punkte: Import, Topologie, Wachstum', () => {
  const N = 1000; // Gitter N x N auf Zylindermantel
  const pos = new Float32Array(3 * N * N), idx = new Uint32Array(6 * (N - 1) * (N - 1));
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const a = (i / (N - 1)) * Math.PI, k = 3 * (i * N + j);
    pos[k] = 50 * Math.cos(a); pos[k + 1] = 50 * Math.sin(a); pos[k + 2] = (j / (N - 1)) * 100;
  }
  let t = 0;
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
    const v = i * N + j; idx.set([v, v + 1, v + N, v + 1, v + N + 1, v + N], t); t += 6;
  }
  const buf = writeSTL(pos, idx);
  let t0 = performance.now();
  const m = parseSTL(buf);
  const tParse = performance.now() - t0; t0 = performance.now();
  const topo = new MeshTopology(m);
  const tTopo = performance.now() - t0; t0 = performance.now();
  const tris = topo.growRegion(1000, [50, 0, 50], { maxAngleDeg: 20, radius: 0 });
  const v = topo.regionVertices(tris);
  const g = gather(m, v.interior);
  const f = autoFit(g.p, g.n).best;
  console.log(`Punkte ${m.positions.length / 3}, Dreiecke ${m.indices.length / 3}; Import ${tParse.toFixed(0)} ms, Topologie ${tTopo.toFixed(0)} ms, Wachstum+Fit ${(performance.now() - t0).toFixed(0)} ms -> ${f.type} D=${f.diameter?.toFixed(4)}`);
});
