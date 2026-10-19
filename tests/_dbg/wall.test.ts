import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { samplePath } from '../samplePath';
import { parseSTL } from '../../src/core/io';
import { MeshTopology, setNormalMode, gather } from '../../src/core/region';
import { axisFromNormals } from '../../src/core/fit';
import type { Vec3 } from '../../src/core/linalg';
const buf = readFileSync(samplePath('beispielteil.stl'));
const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'beispielteil');
const P = mesh.positions, F = mesh.indices;
function seed(pt: Vec3, n: Vec3) { const fn = mesh.faceNormals!; let b = -1, bd = Infinity;
  for (let t = 0; t < F.length / 3; t++) { if (fn[3 * t] * n[0] + fn[3 * t + 1] * n[1] + fn[3 * t + 2] * n[2] < 0.9) continue; const v = F[3 * t]; const d = (P[3 * v] - pt[0]) ** 2 + (P[3 * v + 1] - pt[1]) ** 2 + (P[3 * v + 2] - pt[2]) ** 2; if (d < bd) { bd = d; b = t; } } return b; }
for (const mode of ['needle036', 'robust'] as const) it(mode, () => {
  setNormalMode(mode); const topo = new MeshTopology(mesh);
  for (const a of [0, 1, 2, 3, 4, 5]) { const ang = a * Math.PI / 3, z = 19.6 - a * 0.05;
    const pt: Vec3 = [20 + 6.04 * Math.cos(ang), 20 + 6.04 * Math.sin(ang), z]; const t = seed(pt, [-Math.cos(ang), -Math.sin(ang), 0]);
    const tr = topo.growRegion(t, pt, { maxAngleDeg: 20, radius: 0 }); const v = topo.regionVertices(tr); const g = gather(mesh, v.interior.length >= 20 ? v.interior : v.all, 20000);
    let zl = 1e9, zh = -1e9; for (const x of v.all) { zl = Math.min(zl, P[3 * x + 2]); zh = Math.max(zh, P[3 * x + 2]); }
    const sn = topo.N(t); console.log(mode, a, 'tris', tr.length, 'z', zl.toFixed(2), zh.toFixed(2), 'ratio', axisFromNormals(g.n).ratio.toFixed(3), 'seedN', [sn[3*t],sn[3*t+1],sn[3*t+2]].map(x=>x.toFixed(2)).join(','), JSON.stringify(topo.lastGrow));
  }
});
