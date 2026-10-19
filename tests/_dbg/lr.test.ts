import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { samplePath } from '../samplePath';
import { parseSTL } from '../../src/core/io';
import { MeshTopology, setNormalMode } from '../../src/core/region';
import { extractLine } from '../../src/core/aux';
import type { Vec3 } from '../../src/core/linalg';
const buf = readFileSync(samplePath('beispielteil.stl'));
const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'beispielteil');
function seed(pt: Vec3, n: Vec3) { const P = mesh.positions, F = mesh.indices, fn = mesh.faceNormals!; let b = -1, bd = Infinity;
  for (let t = 0; t < F.length / 3; t++) { if (fn[3 * t] * n[0] + fn[3 * t + 1] * n[1] + fn[3 * t + 2] * n[2] < 0.9) continue; const v = F[3 * t]; const d = (P[3 * v] - pt[0]) ** 2 + (P[3 * v + 1] - pt[1]) ** 2 + (P[3 * v + 2] - pt[2]) ** 2; if (d < bd) { bd = d; b = t; } } return b; }
for (const mode of ['needle036', 'robust'] as const) it(mode, () => {
  setNormalMode(mode); const topo = new MeshTopology(mesh);
  const pt: Vec3 = [50, 0, 19.3], t = seed(pt, [0, -1, 0]);
  const ext = (tr: Uint32Array) => { const P = mesh.positions, F = mesh.indices; const lo = [1e9,1e9,1e9], hi=[-1e9,-1e9,-1e9]; for (const x of tr) for (let k=0;k<3;k++){const v=F[3*x+k]; for(let j=0;j<3;j++){lo[j]=Math.min(lo[j],P[3*v+j]);hi[j]=Math.max(hi[j],P[3*v+j]);}} return tr.length+' '+lo.map(x=>x.toFixed(2))+' / '+hi.map(x=>x.toFixed(2)); };
  const g = topo.growRegion(t, pt, { maxAngleDeg: 20, radius: 0 }); console.log(mode, 'r1', ext(g), topo.lastGrow);
  try { const r = extractLine(mesh, topo, t, pt, { maxAngleDeg: 20, radius: 0 }, 0); console.log(mode, r.fit.center, r.fit.direction, 'plane', (r as any).plane?.center, (r as any).plane?.normal ?? (r as any).plane?.direction); } catch (e) { console.log(mode, 'ERR', String(e)); }
});
