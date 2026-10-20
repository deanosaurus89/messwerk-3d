// 0.40 regression: the gap-bridging contour wall (needed for the inclined upper slot on the multi-feature plate) must not
// pull in a foreign ring – Flansch/Welle Ø50 next to the torus groove grew a wall whose ROBUST fit looked fine (rms 0.008)
// but whose raw final fit (as created) was Ø49.91 with form 2.55 mm. The created feature is fitted raw, so check raw.
import { readFileSync } from 'node:fs'; import { gunzipSync } from 'node:zlib'; import { describe, expect, it } from 'vitest';
import { parseSTL } from '../src/core/io'; import { computeNormals } from '../src/core/mesh'; import { MeshTopology } from '../src/core/region';
import { autoExtract, fitInPlane } from '../src/core/aux';
const b = gunzipSync(readFileSync('public/samples/flansch.stl.gz'));
const m0 = parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'flansch');
const mesh: any = { name: 'flansch', positions: m0.positions, indices: m0.indices }; computeNormals(mesh);
const P = mesh.positions, F = mesh.indices, nt = F.length / 3; const topo = new MeshTopology(mesh);
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); }
const diag = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
const near = (q: number[]) => { let bt = 0, bd = 1e9; for (let t = 0; t < nt; t++) { const v = F[3 * t]; const d = (P[3 * v] - q[0]) ** 2 + (P[3 * v + 1] - q[1]) ** 2 + (P[3 * v + 2] - q[2]) ** 2; if (d < bd) { bd = d; bt = t; } } return bt; };
const J = JSON.parse(readFileSync('public/samples/flansch.json', 'utf8'));
describe('flansch auto circles in aux plane: raw final fit matches nominal', () => {
  for (const f of J.features.filter((x: any) => x.probe && x.diameter && /Welle|Umfang|Zapfen|Teilkreis/.test(x.id)))
    it(f.id, () => { const r: any = autoExtract(mesh, topo, near(f.probe), f.probe, { maxAngleDeg: 20, radius: 0, seedR: 0 }, diag);
      expect(r.aux).toBeTruthy(); const pts = Array.from(r.indices as Uint32Array, (v) => [P[3 * v], P[3 * v + 1], P[3 * v + 2]] as [number, number, number]);
      const raw = fitInPlane('Kreis', pts, r.aux.plane, false);
      expect(Math.abs(2 * raw.radius! - f.diameter)).toBeLessThan(0.03); expect(raw.rms).toBeLessThan(0.05); }, 120000);
});
