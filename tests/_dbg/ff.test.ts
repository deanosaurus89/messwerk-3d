import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { samplePath } from '../samplePath';
import { parseByName } from '../../src/core/io';
import { MeshTopology, setNormalMode } from '../../src/core/region';
const buf = readFileSync(samplePath('freiform.stl.gz'));
const mesh = parseByName('freiform.stl.gz', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
for (const mode of ['needle036', 'robust'] as const) it(mode, () => {
  setNormalMode(mode); const topo = new MeshTopology(mesh); const P = mesh.positions, F = mesh.indices, fn = mesh.faceNormals!;
  console.log(mode, 'iso', topo.isotropic, 'needles', topo.needleCount, 'nt', F.length / 3);
  let best = 0, bd = Infinity; const pt = [35, 40, 0]; for (let t = 0; t < F.length / 3; t++) { const a = 3 * F[3 * t]; const d = (P[a] - pt[0]) ** 2 + (P[a + 1] - pt[1]) ** 2; if (d < bd && fn[3*t+2] > 0.5) { bd = d; best = t; } }
  const tr = topo.growRegion(best, [P[3*F[3*best]], P[3*F[3*best]+1], P[3*F[3*best]+2]], { maxAngleDeg: 20, radius: 0, type: 'Freiformfläche' });
  let bad = 0, ex: string[] = []; for (const t of tr) { const n = topo.N(t); if (n[3 * t + 2] < 0.3) { bad++; if (ex.length < 5) ex.push(`c=${[0,1,2].map(k=>((P[3*F[3*t]+k]+P[3*F[3*t+1]+k]+P[3*F[3*t+2]+k])/3).toFixed(1))} K=${topo.isotropic?topo.K(t).toFixed(3):'-'} raw=${[0,1,2].map(k=>fn[3*t+k].toFixed(2))} rob=${[0,1,2].map(k=>n[3*t+k].toFixed(2))}`); } }
  console.log(mode, 'tris', tr.length, 'bad', bad, ex.join(' | '));
});
it('profile', () => {
  setNormalMode('robust'); const topo = new MeshTopology(mesh); const P = mesh.positions, F = mesh.indices, fn = mesh.faceNormals!;
  const rows: [number, string][] = [];
  for (let t = 0; t < F.length / 3; t++) { const c = [0,1,2].map(k=>(P[3*F[3*t]+k]+P[3*F[3*t+1]+k]+P[3*F[3*t+2]+k])/3); if (Math.abs(c[1]-40)>0.3 || c[0]<68 || c[0]>72 || c[2]<15) continue; const n = topo.N(t);
    rows.push([c[0], `x=${c[0].toFixed(2)} raw=${(Math.acos(fn[3*t+2])*57.3).toFixed(0)} rob=${(Math.acos(n[3*t+2])*57.3).toFixed(0)} K=${topo.K(t).toFixed(2)}`]); }
  rows.sort((a,b)=>a[0]-b[0]); console.log('PROF\n'+rows.map(r=>r[1]).join('\n'));
});
