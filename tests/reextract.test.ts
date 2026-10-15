import { describe, expect, it } from 'vitest';
import { buildRegion, inRegion, reextract } from '../src/core/reextract';
// plane z=0 grid with noise, a few outliers, and a parallel face at z=5 that must not be picked
describe('re-extraction', () => {
  const pos: number[] = [], nrm: number[] = []; let s = 1; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) { pos.push(i, j, 0.01 * rnd()); nrm.push(0, 0, 1); }
  for (let i = 0; i < 20; i++) { pos.push(5 + i, 5, 0.06); nrm.push(0, 0, 1); }        // outliers within maxDist
  for (let i = 0; i < 40; i++) { pos.push(i, 20, 5); nrm.push(0, 0, 1); }              // other face
  const start = Uint32Array.from({ length: 100 }, (_, k) => (k % 10) * 40 + Math.floor(k / 10)); // small patch
  const fit0: any = { type: 'Ebene', center: [5, 5, 0.02], normal: [0, 0.01, 1], rms: 0, form: 0 };
  it('prism over the contour: stays on the start patch (+ margin), not the whole coplanar face', () => {
    const r = reextract(fit0, pos, nrm, start, { maxDist: 0.1, sigma: 3, maxAngleDeg: 30, margin: 1 });
    expect(r.region.kind).toBe('prism');
    // start patch 10×10 grid points (0..9); margin 1 → about 11×11 … 12×12 points, never the whole 40×40 face
    expect(r.indices.length).toBeGreaterThanOrEqual(100); expect(r.indices.length).toBeLessThanOrEqual(180);
    expect(Math.abs(r.fit.center[2])).toBeLessThan(0.005);
    expect([...r.indices].some((v) => v >= 1620)).toBe(false);
  });
});

describe('search regions from geometry', () => {
  const P = (a: number[][]) => Float32Array.from(a.flat());
  it('cylinder shell over the trimmed height', () => {
    const fit: any = { type: 'Zylinder', center: [0, 0, 0], normal: [0, 0, 1], radius: 5, length: 10 };
    const pos = P([[5, 0, -5], [0, 5, 5]]); const R = buildRegion(fit, pos, Uint32Array.from([0, 1]), { maxDist: 0.1, sigma: 3, maxAngleDeg: 30, margin: 0.5 });
    expect(R.kind).toBe('shell'); expect(inRegion(R, [5.05, 0, 0])).toBe(true); expect(inRegion(R, [5.3, 0, 0])).toBe(false); expect(inRegion(R, [5, 0, 6])).toBe(false); expect(inRegion(R, [5, 0, 5.4])).toBe(true);
  });
  it('sphere shell, circle band, line tube, anchor box', () => {
    const p = { maxDist: 0.1, sigma: 3, maxAngleDeg: 30, margin: 0.5 };
    const S = buildRegion({ type: 'Kugel', center: [0, 0, 0], normal: [0, 0, 1], radius: 4 } as any, P([[4, 0, 0]]), Uint32Array.from([0]), p);
    expect(inRegion(S, [0, 0, -4.05])).toBe(true); expect(inRegion(S, [0, 0, 3.7])).toBe(false);
    const C = buildRegion({ type: 'Kreis', center: [0, 0, 0], normal: [0, 0, 1], radius: 3 } as any, P([[3, 0, 0], [0, 3, -2]]), Uint32Array.from([0, 1]), p);
    expect(inRegion(C, [0, -3.05, -1])).toBe(true); expect(inRegion(C, [0, -3.05, -3])).toBe(false); expect(inRegion(C, [0, 0, -1])).toBe(false);
    const L = buildRegion({ type: 'Linie', center: [0, 0, 0], normal: [0, 0, 1], direction: [1, 0, 0], length: 10 } as any, P([[-5, 0, 0], [5, 0, 0]]), Uint32Array.from([0, 1]), p);
    expect(inRegion(L, [4, 0.05, 0.05])).toBe(true); expect(inRegion(L, [6, 0, 0])).toBe(false);
    const B = buildRegion({ type: 'Ebene', center: [0, 0, 0], normal: [0, 0, 1] } as any, P([]), new Uint32Array(0), p, [[0, 0, 0], [10, 0, 0], [0, 10, 0]]);
    expect(B.kind).toBe('box'); expect(inRegion(B, [5, 5, 0.05])).toBe(true); expect(inRegion(B, [12, 5, 0])).toBe(false);
  });
});
describe('torus region', () => {
  it('toroidal shell', () => {
    const T: any = { type: 'Torus', center: [0, 0, 0], normal: [0, 0, 1], radius: 10, minorRadius: 2 };
    const R = buildRegion(T, Float32Array.from([12, 0, 0]), Uint32Array.from([0]), { maxDist: 0.1, sigma: 3, maxAngleDeg: 30, margin: 0.5 });
    expect(inRegion(R, [12.05, 0, 0])).toBe(true); expect(inRegion(R, [11, 0, 0])).toBe(false); expect(inRegion(R, [0, 10, 2.02])).toBe(true);
  });
});
