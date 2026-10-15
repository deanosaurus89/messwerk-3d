// Line with auxiliary plane at the top front edge of the training part (block 100×60×20): full plane vs local band.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { samplePath } from './samplePath';
import { parseSTL } from '../src/core/io';
import { MeshTopology } from '../src/core/region';
import { extractLine } from '../src/core/aux';
import type { Vec3 } from '../src/core/linalg';
const buf = readFileSync(samplePath('beispielteil.stl'));
const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'beispielteil');
const topo = new MeshTopology(mesh);
function seed(pt: Vec3, n: Vec3) { const P = mesh.positions, F = mesh.indices, fn = mesh.faceNormals!; let b = -1, bd = Infinity;
  for (let t = 0; t < F.length / 3; t++) { if (fn[3 * t] * n[0] + fn[3 * t + 1] * n[1] + fn[3 * t + 2] * n[2] < 0.9) continue; const v = F[3 * t]; const d = (P[3 * v] - pt[0]) ** 2 + (P[3 * v + 1] - pt[1]) ** 2 + (P[3 * v + 2] - pt[2]) ** 2; if (d < bd) { bd = d; b = t; } } return b; }
describe('line with aux plane: full plane vs local band', () => {
  const pt: Vec3 = [50, 0, 19.3], t = seed(pt, [0, -1, 0]);
  for (const ring of [undefined, { gap: 0.5, width: 3 }]) it(ring ? 'local band' : 'full plane', () => {
    const r = extractLine(mesh, topo, t, pt, { maxAngleDeg: 20, radius: 0 }, 0, undefined, ring);
    expect(Math.abs(r.fit.direction![0])).toBeGreaterThan(0.999);
    expect(Math.abs(r.fit.center[1])).toBeLessThan(0.2); expect(Math.abs(r.fit.center[2] - 20)).toBeLessThan(0.6);
    if (ring) expect(r.planeIdx.length).toBeGreaterThan(20);
  });
});
