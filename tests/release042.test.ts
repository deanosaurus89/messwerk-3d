// 2026.0.42: point boundary does not grow; a clear cone stays a cone; cylinder growing follows form error.
import { describe, expect, it } from 'vitest';
import { reextract } from '../src/core/reextract';
import { autoFit } from '../src/core/fit';
import { cone } from './synth';
import { computeNormals } from '../src/core/mesh';
import { MeshTopology } from '../src/core/region';
import type { Vec3 } from '../src/core/linalg';

describe('re-extract boundary from points', () => {
  const na = 24, nz = 11, R = 5;
  const pos: number[] = [], nrm: number[] = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < na; i++) {
    const a = (2 * Math.PI * i) / na, z = -10 + (20 * j) / (nz - 1);
    pos.push(R * Math.cos(a), R * Math.sin(a), z);
    nrm.push(Math.cos(a), Math.sin(a), 0);
  }
  const created: number[] = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < 4; i++) created.push(j * na + i);
  const fit: any = { type: 'Zylinder', center: [0, 0, 0], normal: [0, 0, 1], radius: R, length: 20 };
  const base = { maxDist: 1, sigma: 3, maxAngleDeg: 30, margin: 2, angleOn: false as const, sigmaOn: false as const };
  it('a lateral margin does not pull in points outside the creation set', () => {
    const P = { ...base, pointBound: true, frozenIdx: Uint32Array.from(created) };
    const cur = Uint32Array.from(created);
    const r1 = reextract(fit, pos, nrm, cur, P);
    expect(r1.indices.length).toBe(created.length);
    expect([...r1.indices].every((v) => created.includes(v))).toBe(true);
    const r2 = reextract({ ...r1.fit, type: 'Zylinder' }, pos, nrm, r1.indices, P);
    expect(r2.indices.length).toBe(r1.indices.length);
    const grown = reextract(fit, pos, nrm, cur, { ...base, pointBound: false });
    expect(grown.indices.length).toBeGreaterThan(created.length);
  });
});

describe('cone recognition', () => {
  it('a clear taper is a cone, not a cylinder', () => {
    const c = cone([0, 0, 0], [0, 0, 1], (18 * Math.PI) / 180, 10, 28, 500, 0.02, 4);
    const r = autoFit(c.P, c.N);
    expect(r.best.type).toBe('Kegel');
    expect(r.best.halfAngle!).toBeGreaterThan(0.2);
    expect(r.best.halfAngle!).toBeLessThan(0.5);
  });
});

describe('cylinder growing with form error', () => {
  it('follows a wavy cylinder instead of stopping at the seed noise', () => {
    const na = 48, nz = 20, R = 12, H = 24, wave = 0.08;
    const pos: number[] = [], rows: number[] = [];
    for (let j = 0; j <= nz; j++) {
      rows.push(pos.length / 3);
      const z = (H * j) / nz;
      for (let i = 0; i < na; i++) {
        const a = (2 * Math.PI * i) / na;
        const rr = R + wave * Math.sin(3 * a) * Math.sin((Math.PI * z) / H);
        pos.push(rr * Math.cos(a), rr * Math.sin(a), z);
      }
    }
    const tris: number[] = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < na; i++) {
      const a = rows[j] + i, b = rows[j] + ((i + 1) % na), c = rows[j + 1] + i, d = rows[j + 1] + ((i + 1) % na);
      tris.push(a, b, d, a, d, c);
    }
    const mesh = { name: 'cyl', positions: Float32Array.from(pos), indices: Uint32Array.from(tris) };
    computeNormals(mesh);
    const topo = new MeshTopology(mesh);
    const seed = Math.floor(na * nz / 2);
    const v = mesh.indices[3 * seed];
    const pt: Vec3 = [mesh.positions[3 * v], mesh.positions[3 * v + 1], mesh.positions[3 * v + 2]];
    const grown = topo.growRegion(seed, pt, { maxAngleDeg: 20, radius: 0, type: 'Zylinder' });
    const nv = topo.regionVertices(grown).all.length;
    expect(nv).toBeGreaterThan(0.55 * (pos.length / 3));
  });
});
