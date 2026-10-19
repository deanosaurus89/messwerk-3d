import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { samplePath } from '../samplePath';
import { parseSTL } from '../../src/core/io';
import { MeshTopology, setNormalMode } from '../../src/core/region';
import { extractAtRim } from '../../src/core/aux';
import type { Vec3 } from '../../src/core/linalg';
const buf = readFileSync(samplePath('beispielteil.stl'));
const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'beispielteil');
const NT = mesh.indices.length / 3, P = mesh.positions, F = mesh.indices;
function seedTri(pt: Vec3, n: Vec3) { const fn = mesh.faceNormals!; let b = -1, bd = Infinity; for (let t = 0; t < NT; t++) { if (fn[3*t]*n[0]+fn[3*t+1]*n[1]+fn[3*t+2]*n[2] < 0.5) continue; const d = [0,1,2].reduce((s,j)=>s+((P[3*F[3*t]+j]+P[3*F[3*t+1]+j]+P[3*F[3*t+2]+j])/3-pt[j])**2,0); if (d<bd){bd=d;b=t;} } return b; }
for (const mode of ['needle036','robust'] as const) if (mode === 'robust') it(mode, () => { setNormalMode(mode); const topo = new MeshTopology(mesh);
  for (const dr of [0.3, 0.8, 1.4]) { const a = +(process.env.ANG ?? 200)*Math.PI/180; const p: Vec3 = [20+(6.04+dr)*Math.cos(a), 20+(6.04+dr)*Math.sin(a), 20]; const t = seedTri(p,[0,0,1]);
    for (const pr of [0, 1.5]) { try { const r = extractAtRim(mesh, topo, t, p, { maxAngleDeg: 20, radius: 0, seedR: pr }, 'Kreis', 130); console.log('RIM', mode, dr, pr, r.fit.radius, r.fit.center, r.wallIdx.length, r.planeIdx.length); } catch (e) { console.log('RIM', mode, dr, pr, String(e)); } } } });
