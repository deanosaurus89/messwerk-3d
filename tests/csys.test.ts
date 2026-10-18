import { describe, expect, it } from 'vitest';
import { computeCSys, newCSys, toLocal, dirLocal } from '../src/core/csys';
const F = (id: number, type: any, center: number[], normal: number[], extra: any = {}) => ({ id, name: 'f' + id, type, pointCount: 10, method: 'Klick', measured: { type, center, normal, rms: 0, form: 0, maxPos: 0, maxNeg: 0, n: 10, ...extra } } as any);
describe('coordinate systems 3-2-1', () => {
  const s = Math.SQRT1_2;
  const feats = new Map([
    [1, F(1, 'Ebene', [5, 5, 10], [0, 0, 1])],              // top plane z=10
    [2, F(2, 'Ebene', [0, 3, 4], [s, s, 0])],               // side plane, rotated 45°
    [3, F(3, 'Kreis', [20, 30, 10], [0, 0, 1], { radius: 2 })],
    [4, F(4, 'Kreis', [30, 40, 10], [0, 0, 1], { radius: 2 })],
  ]);
  it('plane / plane / circle', () => {
    const cs = newCSys(1, 'A'); cs.primary.fid = 1; cs.secondary.fid = 2; cs.origin.Z.fid = 1; cs.origin.X.fid = 3; cs.origin.Y.fid = 3;
    const r = computeCSys(cs, feats); expect(r.error).toBeUndefined(); expect(r.dof).toBe(6);
    const fr = r.frame!; expect(dirLocal(fr, [0, 0, 1])[2]).toBeCloseTo(1);
    expect(toLocal(fr, [20, 30, 10]).map((v) => +v.toFixed(9))).toEqual([0, 0, 0]);
    const q = toLocal(fr, [30, 40, 10]); expect(q[0]).toBeCloseTo(Math.hypot(10, 10)); expect(q[1]).toBeCloseTo(0);
  });
  it('secondary from two circles, offsets, flip', () => {
    const cs = newCSys(1, 'B'); cs.primary.fid = 1; cs.secondary.fid = 4; cs.origin.X.fid = 3; cs.origin.Y.fid = 3; cs.origin.Z.fid = 1; cs.origin.Z.off = 2;
    const fr = computeCSys(cs, feats).frame!; const q = toLocal(fr, [30, 40, 10]);
    expect(q[0]).toBeCloseTo(Math.hypot(10, 10)); expect(q[1]).toBeCloseTo(0); expect(q[2]).toBeCloseTo(-2);
    cs.primary.flip = true; const f2 = computeCSys(cs, feats).frame!; expect(dirLocal(f2, [0, 0, 1])[2]).toBeCloseTo(-1);
    const R = f2.R; expect(R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0])).toBeCloseTo(1);
  });
  it('nearly parallel secondary is rejected', () => {
    const fm = new Map([[1, F(1, 'Ebene', [0, 0, 10], [0, 0, 1])], [2, F(2, 'Ebene', [0, 0, 0], [0, 0.0005, 1])]]);
    const cs = newCSys(1, 'P'); cs.primary.fid = 1; cs.secondary.fid = 2; expect(computeCSys(cs, fm).error).toMatch(/parallel/);
  });
  it('errors', () => {
    const cs = newCSys(1, 'C'); cs.primary.fid = 1; cs.secondary.fid = 1;
    expect(computeCSys(cs, feats).error).toMatch(/parallel/);
    cs.secondary.fid = 99; expect(computeCSys(cs, feats).error).toMatch(/missing/);
  });
});

import { nextEmptyField, suggestOrigin } from '../src/core/csys';
describe('free step order', () => {
  const feats = new Map([[1, F(1, 'Ebene', [0, 0, 10], [0, 0, 1])], [3, F(3, 'Kreis', [20, 30, 10], [0, 0, 1], { radius: 2 })], [5, F(5, 'Zylinder', [1, 2, 0], [0, 0, 1], { radius: 2 })]]);
  it('origin first, then primary: manual origin kept, autos follow the current primary', () => {
    const cs = newCSys(1, 'A'); cs.origin.X = { fid: 3, off: 0 }; cs.origin.Y = { fid: 3, off: 0 };
    expect(nextEmptyField(cs, 'Y')).toBe('Z'); expect(nextEmptyField(cs, 'Z')).toBe('p');
    cs.primary.fid = 5; suggestOrigin(cs, feats as any); expect(cs.origin.X.fid).toBe(3); expect(cs.origin.Z.fid).toBe(null);
    cs.primary.fid = 1; suggestOrigin(cs, feats as any); expect(cs.origin.Z.fid).toBe(1); expect(cs.origin.Z.auto).toBeTruthy();
    cs.primary.fid = 5; suggestOrigin(cs, feats as any); expect(cs.origin.Z.fid).toBe(null); // stale auto from the plane dropped
    const r = computeCSys(cs, feats as any); expect(r.error).toBeUndefined(); expect(r.frame!.o[0]).toBeCloseTo(20, 9); expect(r.frame!.o[1]).toBeCloseTo(30, 9);
  });
  it('secondary before primary works', () => {
    const cs = newCSys(2, 'B'); cs.secondary.fid = 3; expect(computeCSys(cs, feats as any).error).toBeUndefined(); expect(nextEmptyField(cs, 's')).toBe('t');
  });
});

import { rotate90, smartAxis } from '../src/core/csys';
describe('three slots: smart axes, rotate 90°, tertiary', () => {
  const feats = new Map([[1, F(1, 'Ebene', [0, 0, 10], [0, 0, -1])], [2, F(2, 'Ebene', [0, -5, 5], [0, 1, 0])], [4, F(4, 'Ebene', [-3, 0, 5], [1, 0, 0])]]);
  it('primary plane → +Z out of material, secondary → X, tertiary → Y and locks its translation', () => {
    const cs = newCSys(1, 'A');
    cs.primary.fid = 1; smartAxis(cs, 'p', feats.get(1) as any, [0, 0, 1]); expect(cs.primary.axis).toBe('Z'); expect(cs.primary.flip).toBe(false); expect(cs.primary.inv).toBe(true);
    cs.secondary.fid = 2; smartAxis(cs, 's', feats.get(2) as any, [0, -1, 0]); expect(cs.secondary.axis).toBe('X'); expect(cs.secondary.flip).toBe(false); expect(cs.secondary.inv).toBe(true); expect(cs.tertiary!.axis).toBe('Y');
    cs.tertiary!.fid = 4; suggestOrigin(cs, feats as any);
    const r = computeCSys(cs, feats as any); expect(r.error).toBeUndefined(); expect(r.dof).toBe(6);
    expect(r.frame!.R[2][2]).toBeCloseTo(1, 9);                 // +Z out of material (up)
    expect(r.frame!.R[0][1]).toBeCloseTo(-1, 9);                // +X = out of the secondary face (−Y global)
    expect(cs.origin.Z.fid).toBe(1); expect(cs.origin.X.fid).toBe(2); expect(cs.origin.Y.fid).toBe(4);
  });
  it('rotate 90° cycles the secondary axis about the primary, tertiary follows', () => {
    const cs = newCSys(2, 'B'); rotate90(cs); expect([cs.secondary.axis, cs.secondary.flip, cs.tertiary!.axis]).toEqual(['Y', false, 'X']);
    rotate90(cs); expect([cs.secondary.axis, cs.secondary.flip]).toEqual(['X', true]); rotate90(cs); rotate90(cs); expect([cs.secondary.axis, cs.secondary.flip]).toEqual(['X', false]);
  });
});
