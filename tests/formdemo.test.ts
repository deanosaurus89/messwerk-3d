// Default demo part (form deviation demo): loads, the largest flat face is found by click & grow / auto and has a
// clearly visible form deviation; anchor fits (minimum points) pass exactly through their points.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { samplePath } from './samplePath';
import { parseByName } from '../src/core/io';
import { MeshTopology } from '../src/core/region';
import { autoExtract } from '../src/core/aux';
import { anchorFit, signedDistance } from '../src/core/fit';
import type { Vec3 } from '../src/core/linalg';

describe('Form deviation demo (default model)', () => {
  const buf = readFileSync(samplePath('formdemo.stl.gz'));
  const mesh = parseByName('formdemo.stl.gz', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const topo = new MeshTopology(mesh);
  it('loads (≈298k triangles)', () => { expect(mesh.indices.length / 3).toBe(297828); });
  it('largest flat face → plane with visible form deviation', () => {
    // dominant normal: area-weighted vote over coarse normal bins
    const P = mesh.positions, F = mesh.indices, fn = mesh.faceNormals!, votes = new Map<string, { a: number; t: number }>();
    for (let t = 0; t < F.length / 3; t++) {
      const k = [0, 1, 2].map((j) => Math.round(fn[3 * t + j] * 10)).join(','), a = 1, v = votes.get(k) ?? { a: 0, t };
      v.a += a; votes.set(k, v);
    }
    const best = [...votes.values()].sort((x, y) => y.a - x.a)[0].t;
    const v0 = F[3 * best], pt: Vec3 = [P[3 * v0], P[3 * v0 + 1], P[3 * v0 + 2]];
    const r = autoExtract(mesh, topo, best, pt, { maxAngleDeg: 20, radius: 0 }, 1000);
    expect(r.fit.type).toBe('Ebene');
    expect(r.indices.length).toBeGreaterThan(1000);
    expect(r.fit.form!).toBeGreaterThan(0.02); // a demo for form deviation: clearly non-flat
  });
});

describe('Anchor fits (mathematical minimum of points)', () => {
  const cases: [string, Vec3[], Vec3[]][] = [
    ['Punkt', [[1, 2, 3]], [[0, 0, 1]]],
    ['Linie', [[0, 0, 0], [10, 0, 0]], [[0, 0, 1], [0, 0, 1]]],
    ['Ebene', [[0, 0, 5], [10, 0, 5], [0, 10, 5]], [[0, 0, 1], [0, 0, 1], [0, 0, 1]]],
    ['Kreis', [[5, 0, 0], [0, 5, 0], [-5, 0, 0]], [[1, 0, 0], [0, 1, 0], [-1, 0, 0]]],
    ['Kugel', [[4, 0, 0], [0, 4, 0], [0, 0, 4], [-4, 0, 0]], [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0]]],
  ];
  const cyl = (n: number, r: number, h: number): [Vec3[], Vec3[]] => { const p: Vec3[] = [], q: Vec3[] = [];
    for (let i = 0; i < n; i++) { const a = (i * 2.4), z = (i / (n - 1)) * h; p.push([r * Math.cos(a), r * Math.sin(a), z]); q.push([Math.cos(a), Math.sin(a), 0]); } return [p, q]; };
  cases.push(['Zylinder', ...cyl(5, 3, 10)]);
  { // cone: half angle 20°, apex at origin, axis +z
    const ta = Math.tan(20 * Math.PI / 180), p: Vec3[] = [], q: Vec3[] = [];
    for (let i = 0; i < 6; i++) { const a = i * 2.4, z = 5 + i, r = z * ta; p.push([r * Math.cos(a), r * Math.sin(a), z]); const c = Math.cos(20 * Math.PI / 180), s = Math.sin(20 * Math.PI / 180); q.push([c * Math.cos(a), c * Math.sin(a), -s]); }
    cases.push(['Kegel', p, q]);
  }
  for (const [t, p, n] of cases) it(`${t} through ${p.length} point(s)`, () => {
    const f = anchorFit(t as any, p, n);
    expect(f.type).toBe(t);
    for (const q of p) expect(Math.abs(signedDistance(f, q))).toBeLessThan(1e-3);
    if (t === 'Kreis' || t === 'Kugel') expect(f.radius!).toBeCloseTo(t === 'Kreis' ? 5 : 4, 3);
    if (t === 'Zylinder') expect(f.radius!).toBeCloseTo(3, 2);
  });
});
