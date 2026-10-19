// Step 1 (0.28): typed circle Click & grow tapped roughly at the rim (plane or wall near the edge) must give hole-wall
// AND aux-plane points – as robust as Auto.
import { samplePath } from './samplePath';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSTL } from '../src/core/io';
import { MeshTopology } from '../src/core/region';
import { extractAtRim, autoExtract } from '../src/core/aux';
import type { Vec3 } from '../src/core/linalg';

const buf = readFileSync(samplePath('beispielteil.stl'));
const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'beispielteil');
const topo = new MeshTopology(mesh);
const NT = mesh.indices.length / 3, CEN = new Float32Array(3 * NT);
for (let t = 0; t < NT; t++) for (let j = 0; j < 3; j++) CEN[3 * t + j] = (mesh.positions[3 * mesh.indices[3 * t] + j] + mesh.positions[3 * mesh.indices[3 * t + 1] + j] + mesh.positions[3 * mesh.indices[3 * t + 2] + j]) / 3;
function seedTri(pt: Vec3, nrm: Vec3) {
  const fn = mesh.faceNormals!; let best = -1, bd = Infinity;
  for (let t = 0; t < NT; t++) {
    if (fn[3 * t] * nrm[0] + fn[3 * t + 1] * nrm[1] + fn[3 * t + 2] * nrm[2] < 0.5) continue;
    const d = (CEN[3 * t] - pt[0]) ** 2 + (CEN[3 * t + 1] - pt[1]) ** 2 + (CEN[3 * t + 2] - pt[2]) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

const DBG = !!process.env.DBG;
describe('Typed circle at the rim (Click & grow, pick radius)', () => {
  const holes: [number, number, number, number, number][] = [[85, 10, 3, 20, 1], [85, 10, 3, 0, -1], [20, 20, 6.04, 20, 1], [20, 20, 6.04, 0, -1]];
  for (const pickR of (process.env.PICKS ?? "0,1.5").split(",").map(Number)) it(`pick r ${pickR || 'auto'}: all rim taps give circle + aux plane`, () => {
    const fails: string[] = [];
    for (const [cx, cy, R, zt, sg] of holes) for (const ang of [0, 90, 200, 300]) {
      const a = ang * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      const taps: [string, Vec3, Vec3][] = [];
      for (const dr of [0.3, 0.8, 1.4]) taps.push([`plane+${dr}`, [cx + (R + dr) * c, cy + (R + dr) * s, zt], [0, 0, sg]]);
      for (const dz of [0.3, 0.8, 1.4]) taps.push([`wall-${dz}`, [cx + R * c, cy + R * s, zt - sg * dz], [-c, -s, 0]]);
      for (const [k, p, n] of taps) {
        const t = seedTri(p, n); let msg = '';
        try { const r = extractAtRim(mesh, topo, t, p, { maxAngleDeg: 20, radius: 0, seedR: pickR }, 'Kreis', 130);
          if (Math.abs(r.fit.radius! - R) > 0.05 || r.planeIdx.length < 100 || r.wallIdx.length < 500) msg = `R${r.fit.radius!.toFixed(2)} w${r.wallIdx.length} a${r.planeIdx.length}`;
        } catch (e) { msg = (e as Error).message; }
        if (DBG) { let au = ''; try { const q = autoExtract(mesh, topo, t, p, { maxAngleDeg: 20, radius: 0, seedR: pickR }, 130); au = `${q.fit.type} a${q.aux?.indices.length ?? 0}`; } catch (e) { au = 'x'; } console.log('TAP', cx, zt, ang, k, msg || 'ok', '| auto', au); }
        if (msg) fails.push(`${cx},${zt}@${ang} ${k}: ${msg}`);
      }
    }
    expect(fails).toEqual([]);
  }, 300000);
});
