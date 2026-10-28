// A click on one wall of a slot must stay on that wall. Neighbour-angle growth can walk the
// round ends (G1) onto the opposite wall; a plane through both sits in the middle of the slot.
import { describe, expect, it } from 'vitest';
import { computeNormals, type MeshData } from '../src/core/mesh';
import { MeshTopology, gather } from '../src/core/region';
import { fitType } from '../src/core/fit';
import { dot, sub, type Vec3 } from '../src/core/linalg';

function slotMesh(): MeshData {
  const H = 8, R = 5, half = 10, st = 0.8, nz = Math.round(H / st);
  const profile: [number, number][] = [];
  for (let y = -half; y <= half + 1e-9; y += st) profile.push([0, Math.min(half, y)]);
  const nArc = Math.max(8, Math.round(Math.PI * R / st));
  for (let k = 1; k < nArc; k++) { const th = Math.PI * (1 - k / nArc); profile.push([R + R * Math.cos(th), half + R * Math.sin(th)]); }
  for (let y = half; y >= -half - 1e-9; y -= st) profile.push([2 * R, Math.max(-half, y)]);
  for (let k = 1; k < nArc; k++) { const th = Math.PI * (k / nArc); profile.push([R + R * Math.cos(th), -half - R * Math.sin(th)]); }
  // drop duplicated junctions (the loops above repeat the corners)
  const prof: [number, number][] = [];
  for (const p of profile) { const q = prof[prof.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) prof.push(p); }
  const pos: number[] = [], idx: number[] = [];
  const vid = (i: number, j: number) => j * prof.length + i;
  for (let j = 0; j <= nz; j++) for (let i = 0; i < prof.length; i++) pos.push(prof[i][0], prof[i][1], (j / nz) * H);
  for (let j = 0; j < nz; j++) for (let i = 0; i < prof.length; i++) {
    const i2 = (i + 1) % prof.length;
    const a = vid(i, j), b = vid(i2, j), c = vid(i2, j + 1), d = vid(i, j + 1);
    idx.push(a, b, c, a, c, d);
  }
  const m: MeshData = { name: 'slot', positions: new Float32Array(pos), indices: new Uint32Array(idx) };
  computeNormals(m);
  return m;
}

describe('slot wall stays a plane', () => {
  const mesh = slotMesh();
  const topo = new MeshTopology(mesh);
  const P = mesh.positions, F = mesh.indices, fn = mesh.faceNormals!;
  // a triangle in the middle of the left wall
  let seed = 0, bd = Infinity;
  for (let t = 0; t < F.length / 3; t++) {
    const c = [0, 1, 2].map((k) => (P[3 * F[3 * t] + k] + P[3 * F[3 * t + 1] + k] + P[3 * F[3 * t + 2] + k]) / 3);
    const n = [fn[3 * t], fn[3 * t + 1], fn[3 * t + 2]];
    if (n[0] < 0.9) continue;
    const d = c[0] ** 2 + c[1] ** 2 + (c[2] - 4) ** 2;
    if (d < bd) { bd = d; seed = t; }
  }
  const c: Vec3 = [0, 1, 2].map((k) => (P[3 * F[3 * seed] + k] + P[3 * F[3 * seed + 1] + k] + P[3 * F[3 * seed + 2] + k]) / 3) as Vec3;
  const n: Vec3 = [fn[3 * seed], fn[3 * seed + 1], fn[3 * seed + 2]];

  function planeOf(type?: 'Ebene') {
    const tris = topo.growRegion(seed, c, { maxAngleDeg: 20, radius: 0, type });
    const v = topo.regionVertices(tris);
    const idx = v.interior.length >= 12 ? v.interior : v.all;
    const g = gather(mesh, idx);
    const fit = fitType('Ebene', g.p, g.n);
    let span = 0;
    for (const q of g.p) span = Math.max(span, Math.abs(dot(sub(q, c), n)));
    return { fit, span, nPts: g.p.length };
  }

  it('an explicit Plane stays on the clicked wall, not between the two walls', () => {
    expect(n[0]).toBeGreaterThan(0.9);
    // Angle-only growth does walk around the ends onto the other wall. The plane path must not.
    const around = topo.growRegion(seed, c, { maxAngleDeg: 20, radius: 0, legacy: true, noCurv: true, legacyCap: 2 });
    const gv = topo.regionVertices(around);
    const gg = gather(mesh, gv.all);
    let aroundSpan = 0;
    for (const q of gg.p) aroundSpan = Math.max(aroundSpan, Math.abs(dot(sub(q, c), n)));
    expect(aroundSpan).toBeGreaterThan(8);
    const r = planeOf('Ebene');
    const dist = Math.abs(dot(sub(c, r.fit.center), r.fit.normal));
    expect(dist).toBeLessThan(0.4);
    expect(r.span).toBeLessThan(2);
    expect(r.fit.rms).toBeLessThan(0.15);
    expect(Math.abs(r.fit.normal[0])).toBeGreaterThan(0.95);
  });
});
