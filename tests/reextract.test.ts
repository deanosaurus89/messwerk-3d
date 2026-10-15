import { describe, expect, it } from 'vitest';
import { reextract } from '../src/core/reextract';
// plane z=0 grid with noise, a few outliers, and a parallel face at z=5 that must not be picked
describe('re-extraction', () => {
  const pos: number[] = [], nrm: number[] = []; let s = 1; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) { pos.push(i, j, 0.01 * rnd()); nrm.push(0, 0, 1); }
  for (let i = 0; i < 20; i++) { pos.push(5 + i, 5, 0.06); nrm.push(0, 0, 1); }        // outliers within maxDist
  for (let i = 0; i < 40; i++) { pos.push(i, 20, 5); nrm.push(0, 0, 1); }              // other face
  const start = Uint32Array.from({ length: 100 }, (_, k) => (k % 10) * 40 + Math.floor(k / 10)); // small patch
  const fit0: any = { type: 'Ebene', center: [5, 5, 0.02], normal: [0, 0.01, 1], rms: 0, form: 0 };
  it('collects the whole face, drops outliers via n·σ, ignores the far face', () => {
    const r = reextract(fit0, pos, nrm, start, { maxDist: 0.1, sigma: 3, maxAngleDeg: 30, margin: 50 });
    expect(r.indices.length).toBeGreaterThanOrEqual(1590); expect(r.indices.length).toBeLessThanOrEqual(1600);
    expect(Math.abs(r.fit.center[2])).toBeLessThan(0.005);
    expect([...r.indices].some((v) => v >= 1620)).toBe(false);
  });
});
