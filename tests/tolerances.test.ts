import { describe, expect, it } from 'vitest';
import { generalTol, iso2768Angle, iso2768Linear, iso2768Straight, iso286 } from '../src/core/tolerances';
const r = (x: { up: number; lo: number } | null) => x && [Math.round(x.up * 1000), Math.round(x.lo * 1000)];
describe('ISO 2768 / ISO 286', () => {
  it('ISO 2768-1 linear and angular', () => {
    expect(iso2768Linear('m', 25)).toBe(0.2); expect(iso2768Linear('f', 100)).toBe(0.15); expect(iso2768Linear('c', 500)).toBe(2); expect(iso2768Linear('v', 2)).toBeNull(); expect(iso2768Linear('m', 0.3)).toBeNull();
    expect(iso2768Angle('m', 8)).toBe(1); expect(iso2768Angle('m', 60)).toBeCloseTo(1 / 3); expect(iso2768Angle('c', 30)).toBe(1);
  });
  it('ISO 2768-2 straightness/flatness and roundness rule', () => {
    expect(iso2768Straight('K', 100)).toBe(0.2); expect(iso2768Straight('H', 150)).toBe(0.2); expect(iso2768Straight('L', 5)).toBe(0.1);
    expect(generalTol('round', { lin: 'm', geo: 'K' }, 12, 0)!.up).toBe(0.2); // 2×0.2 = 0.4 > run-out 0.2
    expect(generalTol('round', { lin: 'f', geo: 'K' }, 5, 0)!.up).toBe(0.1);  // 2×0.05
  });
  it('ISO 286 fits (known table values)', () => {
    expect(r(iso286('H7', 25))).toEqual([21, 0]); expect(r(iso286('g6', 25))).toEqual([-7, -20]);
    expect(r(iso286('K7', 25))).toEqual([6, -15]); expect(r(iso286('M7', 25))).toEqual([0, -21]); expect(r(iso286('N7', 25))).toEqual([-7, -28]); expect(r(iso286('P7', 25))).toEqual([-14, -35]);
    expect(r(iso286('h6', 40))).toEqual([0, -16]); expect(r(iso286('k6', 40))).toEqual([18, 2]); expect(r(iso286('f7', 12))).toEqual([-16, -34]);
    expect(r(iso286('JS9', 10))).toEqual([18, -18]); expect(r(iso286('H11', 100))).toEqual([220, 0]); expect(r(iso286('F8', 50))).toEqual([64, 25]);
    expect(iso286('X7', 10)).toBeNull(); expect(iso286('H7', 600)).toBeNull();
  });
});
