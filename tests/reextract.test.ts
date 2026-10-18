import { describe, expect, it } from 'vitest';
import { buildRegion, inRegion, lateralOf, normReex, reextract } from '../src/core/reextract';
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
describe('unified search region (0.19)', () => {
  it('migrates old parameters: larger of max. distance / band → search distance, fill on, margin → lateral', () => {
    const q = normReex({ maxDist: 1, sigma: 3, maxAngleDeg: 30, margin: 0.5, fillBand: 3 });
    expect(q.maxDist).toBe(3); expect(q.fill).toBe(true); expect(q.margin).toBe(0.5); expect('fillBand' in q).toBe(false);
    const r = normReex({ maxDist: 0.2, sigma: 3, maxAngleDeg: 30, margin: 1, fillBand: 0 }); expect(r.fill).toBeFalsy(); expect(r.maxDist).toBe(0.2);
  });
  it('lateral extension: default 0 (zone = original contour), explicit value extends', () => {
    expect(lateralOf(normReex({ maxDist: 0.1 }))).toBe(0); expect(lateralOf(normReex({ maxDist: 2, margin: null }))).toBe(0); expect(lateralOf(normReex({ maxDist: 2, margin: 0.2 }))).toBe(0.2);
    const fit: any = { type: 'Zylinder', center: [0, 0, 0], normal: [0, 0, 1], radius: 5, length: 10 };
    const R = buildRegion(fit, Float32Array.from([5, 0, -5, 0, 5, 5]), Uint32Array.from([0, 1]), { maxDist: 0.1, sigma: 3, maxAngleDeg: 30 });
    expect(inRegion(R, [5, 0, 4.95])).toBe(true); expect(inRegion(R, [5, 0, 5.2])).toBe(false);
    const R2 = buildRegion(fit, Float32Array.from([5, 0, -5, 0, 5, 5]), Uint32Array.from([0, 1]), { maxDist: 0.1, sigma: 3, maxAngleDeg: 30, margin: 0.5 });
    expect(inRegion(R2, [5, 0, 5.45])).toBe(true);
  });
  it('plane zone follows the original region exactly; exclusion distance ± shrinks / grows it', () => {
    // 20×20 mm patch of 1 mm quads (the original region), mesh continues to 30×30
    const pos: number[] = [], tris: number[] = [], n = 31, id = (i: number, j: number) => j * n + i;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pos.push(i, j, 0);
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
    const cur: number[] = []; for (let j = 0; j <= 20; j++) for (let i = 0; i <= 20; i++) cur.push(id(i, j));
    const fit: any = { type: 'Ebene', center: [10, 10, 0], normal: [0, 0, 1] }, P = Float32Array.from(pos), C = Uint32Array.from(cur), T = Uint32Array.from(tris);
    const base = { maxDist: 0.1, sigma: 3, maxAngleDeg: 30 };
    const R0 = buildRegion(fit, P, C, base, [], T);
    expect(inRegion(R0, [19.8, 10, 0])).toBe(true); expect(inRegion(R0, [20.6, 10, 0])).toBe(false); expect(inRegion(R0, [20.6, 20.6, 0])).toBe(false); // no hidden margin
    const Rin = buildRegion(fit, P, C, { ...base, inset: 2 }, [], T);
    expect(inRegion(Rin, [17.5, 10, 0])).toBe(true); expect(inRegion(Rin, [19, 10, 0])).toBe(false);
    const Rout = buildRegion(fit, P, C, { ...base, inset: -2 }, [], T);
    expect(inRegion(Rout, [21.5, 10, 0])).toBe(true); expect(inRegion(Rout, [23, 10, 0])).toBe(false);
    const nrm = new Float32Array(pos.length); for (let k = 2; k < nrm.length; k += 3) nrm[k] = 1;
    const out = reextract(fit, P, nrm, C, { ...base, inset: -2 }, [], T); expect(out.indices.length).toBeGreaterThan(C.length);
    const inn = reextract(fit, P, nrm, C, { ...base, inset: 2 }, [], T); expect(inn.indices.length).toBeLessThan(C.length);
  });
  it('outlier removal 0 = off keeps all points; n × RMS removes the largest deviations', () => {
    const pos: number[] = [], nrm: number[] = [];
    for (let i = 0; i < 30; i++) for (let j = 0; j < 30; j++) { pos.push(i, j, ((i * 7 + j * 3) % 5 - 2) * 0.002); nrm.push(0, 0, 1); }
    for (let k = 0; k < 10; k++) { pos.push(3 + k, 7, 0.08); nrm.push(0, 0, 1); }
    const start = Uint32Array.from({ length: 910 }, (_, k) => k), fit0: any = { type: 'Ebene', center: [15, 15, 0], normal: [0, 0, 1], rms: 0, form: 0 };
    const off = reextract(fit0, pos, nrm, start, { maxDist: 0.1, sigma: 0, maxAngleDeg: 30 });
    const on = reextract(fit0, pos, nrm, start, { maxDist: 0.1, sigma: 3, maxAngleDeg: 30 });
    expect(off.indices.length).toBe(910); expect(off.removedSigma).toBe(0);
    expect(on.indices.length).toBeLessThanOrEqual(900); expect([...on.indices].some((v) => v >= 900)).toBe(false);
  });
});

import { trimPass } from '../src/core/reextract';
describe('zone trims (lasso)', () => {
  it('identity view: keep / remove inside a square', () => {
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], sq: [number, number][] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    expect(trimPass([{ m: I, poly: sq, keep: false }], [0, 0, 0])).toBe(false);
    expect(trimPass([{ m: I, poly: sq, keep: false }], [0.9, 0, 0])).toBe(true);
    expect(trimPass([{ m: I, poly: sq, keep: true }], [0.9, 0, 0])).toBe(false);
    expect(trimPass(undefined, [0, 0, 0])).toBe(true);
  });
});
