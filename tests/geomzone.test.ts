import { samplePath } from './samplePath';
// Regression 0.27: "Boundary from: Fitted geometry" for a cylinder – the zone is the analytic fitted shell (axis, radius,
// axial extent of the points, 360°), NOT the selected/grown triangles. Starting from only half of the hole wall the
// extraction must capture ~all wall points of the demo hole, and the display is clean circles (closed wall).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSTL } from '../src/core/io';
import { MeshTopology, gather } from '../src/core/region';
import { fitType } from '../src/core/fit';
import { reextract } from '../src/core/reextract';
import { analyticShell } from '../src/core/trim';
import type { Vec3 } from '../src/core/linalg';

const buf = readFileSync(samplePath('beispielteil.stl'));
const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'beispielteil');
const topo = new MeshTopology(mesh);
const P = (v: number): Vec3 => [mesh.positions[3 * v], mesh.positions[3 * v + 1], mesh.positions[3 * v + 2]];
function seedTri(pt: Vec3, nrm: Vec3) {
  const p = mesh.positions, f = mesh.indices, fn = mesh.faceNormals!; let best = -1, bd = Infinity;
  for (let t = 0; t < f.length / 3; t++) {
    if (fn[3 * t] * nrm[0] + fn[3 * t + 1] * nrm[1] + fn[3 * t + 2] * nrm[2] < 0.5) continue;
    let d = 0; for (let k = 0; k < 3; k++) { const c = [0, 1, 2].map((j) => (p[3 * f[3 * t] + j] + p[3 * f[3 * t + 1] + j] + p[3 * f[3 * t + 2] + j]) / 3); d = (c[0] - pt[0]) ** 2 + (c[1] - pt[1]) ** 2 + (c[2] - pt[2]) ** 2; }
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

describe('Boundary from fitted geometry (cylinder)', () => {
  const pt: Vec3 = [20, 26.04, 15];
  const tris = topo.growRegion(seedTri(pt, [0, -1, 0]), pt, { maxAngleDeg: 20, radius: 0 });
  const grown = Uint32Array.from(topo.regionVertices(tris).all);
  const g0 = gather(mesh, grown), fit0 = { ...fitType('Zylinder', g0.p, g0.n), type: 'Zylinder' as const };
  // only the half of the wall on the clicked side (what a partial selection / growing stop leaves)
  const a = fit0.normal as Vec3, c = fit0.center;
  const side = (v: number) => { const q = P(v); return (q[1] - c[1]) * 1 >= 0; };
  void a;
  const half = Uint32Array.from(Array.from(grown).filter(side));
  // all wall vertices: within ±0.1 mm of the fitted radius inside the axial extent of the grown wall
  const n = fit0.normal as Vec3; let t0 = Infinity, t1 = -Infinity;
  for (const v of grown) { const q = P(v), t = (q[0] - c[0]) * n[0] + (q[1] - c[1]) * n[1] + (q[2] - c[2]) * n[2]; t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
  let wall = 0; for (let v = 0; v < mesh.positions.length / 3; v++) { const q = P(v), d = [q[0] - c[0], q[1] - c[1], q[2] - c[2]], t = d[0] * n[0] + d[1] * n[1] + d[2] * n[2]; if (t < t0 || t > t1) continue;
    if (Math.abs(Math.hypot(d[0] - t * n[0], d[1] - t * n[1], d[2] - t * n[2]) - fit0.radius!) <= 0.1) wall++; }

  it('captures ~all wall points of the demo hole from half the wall', () => {
    const r = reextract(fit0, mesh.positions, mesh.vertexNormals ?? null, half, { maxDist: 0.1, sigma: 3, sigmaOn: true, maxAngleDeg: 30, angleOn: false, margin: 0, iterations: 3 }, [pt], mesh.indices);
    console.log(`geom zone: selection ${half.length} (grown ${grown.length}) → ${r.indices.length} of ${wall} wall points`);
    expect(r.region.kind).toBe('shell');
    expect(half.length).toBeLessThan(0.75 * wall);
    expect(r.indices.length).toBeGreaterThan(0.97 * wall);
    expect(r.indices.length).toBeLessThan(1.05 * wall);
    expect(Math.abs(r.fit.radius! - fit0.radius!)).toBeLessThan(0.02);
    // clean display: closed wall → full 360°, edges are two circles (no polygon outline)
    const s = analyticShell(r.fit, mesh.positions, r.indices);
    expect(s.closed).toBe(true);
    expect(s.a1 - s.a0).toBeCloseTo(2 * Math.PI, 6);
    expect(s.edges.length / 6).toBe(2 * 96);
  });
  it('an open wall (half) is displayed as an arc, not 360°', () => {
    const s = analyticShell(fit0, mesh.positions, half);
    expect(s.closed).toBe(false);
    expect(s.a1 - s.a0).toBeGreaterThan(Math.PI * 0.8);
    expect(s.a1 - s.a0).toBeLessThan(Math.PI * 1.3);
  });
});
