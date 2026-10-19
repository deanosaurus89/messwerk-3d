import { describe, expect, it } from 'vitest';
import { reextract } from '../src/core/reextract';
// 0.32 blocker fix: re-extraction of a circle/slot with an aux plane keeps that plane (never re-detected / moved)
describe('re-extraction respects the aux plane', () => {
  // bore wall r=6 from z=0 (aux plane, top face) down to z=-10, slightly tilted noise
  const pos: number[] = [], nrm: number[] = []; let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let k = 0; k < 40; k++) for (let i = 0; i < 72; i++) { const a = (i / 72) * 2 * Math.PI, z = -0.25 * k, r = 6 + 0.005 * rnd(); pos.push(r * Math.cos(a) + 0.02 * z, r * Math.sin(a), z); nrm.push(-Math.cos(a), -Math.sin(a), 0); }
  const idx = Uint32Array.from({ length: 72 * 8 }, (_, k) => k); // only the top ring was selected originally
  const plane: any = { type: 'Ebene', center: [10, 10, 0], normal: [0, 0, 1] };
  const fit0: any = { type: 'Kreis', center: [0, 0, 0], normal: [0, 0, 1], radius: 6, rms: 0 };
  it('circle: centre stays in the aux plane, normal = plane normal', () => {
    const r = reextract(fit0, pos, nrm, idx, { maxDist: 0.2, sigma: 3, maxAngleDeg: 30, margin: 10 }, [], null, plane);
    expect(Math.abs(r.fit.center[2])).toBeLessThan(1e-9);
    expect(r.fit.normal).toEqual([0, 0, 1]);
    expect(Math.abs(r.fit.radius! - 6)).toBeLessThan(0.01);
  });
  it('without aux plane the old behaviour moves the centre down the bore (documents the bug)', () => {
    const r = reextract(fit0, pos, nrm, idx, { maxDist: 0.2, sigma: 3, maxAngleDeg: 30, margin: 10 });
    expect(Math.abs(r.fit.center[2])).toBeGreaterThan(1);
  });
});
