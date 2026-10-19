// 0.36 (Martin 19.10. 20:15): region growing on a needle-triangle plane (CAD tessellation style: triangles 1 mm long,
// 0.03 mm high) with 8 µm vertex noise. Raw triangle normals tilt > 20° there (the former cause of holes + sliver loops);
// the robust neighbourhood normal (plane fit over 1.3 × local edge length) must grow the whole plane without holes.
import { describe, expect, it } from 'vitest';
import { computeNormals, type MeshData } from '../src/core/mesh';
import { MeshTopology } from '../src/core/region';
function needlePlane(seed = 1): MeshData {
  let s = seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const nx = 31, ny = 401, dx = 1.0, dy = 0.03; const P: number[] = [], I: number[] = [];
  // two disconnected copies (z = 0 and z = 10): the grown plane is half of the mesh (growth caps at 60 %)
  for (const z0 of [0, 10]) { const o = P.length / 3;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) P.push(i * dx + gauss() * 0.008, j * dy + gauss() * 0.008, z0 + gauss() * 0.008);
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = o + j * nx + i, b = a + 1, c = a + nx, d = c + 1; I.push(a, b, d, a, d, c); } }
  const m: MeshData = { positions: new Float32Array(P), indices: new Uint32Array(I) } as MeshData; computeNormals(m); return m;
}
describe('robust neighbourhood normal on needle triangles', () => {
  const m = needlePlane(); const topo = new MeshTopology(m); const nt = m.indices.length / 3;
  it('raw triangle normals of the needles are tilted (> 20° for many), robust ones are not', () => {
    let raw = 0, rob = 0; const fn = m.faceNormals!, sm = topo.smooth;
    for (let t = 0; t < nt; t++) { if (Math.abs(fn[3 * t + 2]) < Math.cos(20 * Math.PI / 180)) raw++; if (Math.abs(sm[3 * t + 2]) < Math.cos(20 * Math.PI / 180)) rob++; }
    expect(topo.needleCount).toBe(nt); expect(raw / nt).toBeGreaterThan(0.1); expect(rob).toBe(0);
  });
  it('Click & grow selects the whole plane – no unselected interior vertex', () => {
    const seed = Math.floor(nt / 4) + 30; const tris = topo.growRegion(seed, [15, 6, 0], { maxAngleDeg: 20, radius: 0 });
    const v = topo.regionVertices(tris).all; expect(tris.length / (nt / 2)).toBeGreaterThan(0.995); expect(tris.length).toBeLessThanOrEqual(nt / 2);
    const sel = new Uint8Array(m.positions.length / 3); for (const x of v) sel[x] = 1; const bv = topo.boundaryVerts(); let inner = 0;
    for (let x = 0; x < m.positions.length / 6; x++) if (!sel[x] && !bv[x]) inner++;
    expect(inner).toBe(0); expect(m.positions.length / 6 - v.length).toBeLessThanOrEqual(4); // only plane corners may stay out
  });
});
