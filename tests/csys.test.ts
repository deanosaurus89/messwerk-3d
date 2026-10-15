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
