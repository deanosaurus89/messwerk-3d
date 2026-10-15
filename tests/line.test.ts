import { describe, expect, it } from 'vitest';
import { fitLine, fitType, signedDistance } from '../src/core/fit';
import type { Vec3 } from '../src/core/linalg';

describe('Line feature + deviation', () => {
  it('fits a line inside an auxiliary plane (straightness in plane)', () => {
    const plane = { center: [0, 0, 5] as Vec3, normal: [0, 0, 1] as Vec3 };
    // wall points of a vertical face x=2 between z=0..5, slightly wavy in x
    const p: Vec3[] = [];
    for (let i = 0; i <= 40; i++) for (let k = 0; k <= 5; k++) p.push([2 + 0.01 * Math.sin(i), -10 + i * 0.5, k]);
    const f = fitLine(p, plane);
    expect(f.type).toBe('Linie');
    expect(Math.abs(f.direction![1])).toBeCloseTo(1, 4);
    expect(f.center[2]).toBeCloseTo(5, 9);
    expect(f.center[0]).toBeCloseTo(2, 2);
    expect(f.length!).toBeCloseTo(20, 6);
    expect(f.form).toBeLessThan(0.021); expect(f.form).toBeGreaterThan(0.015);
    // 3D variant through fitType
    expect(fitType('Linie', p, []).type).toBe('Linie');
  });
  it('signed distance: plane, cylinder, sphere', () => {
    const pl = fitType('Ebene', [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]], [[0, 0, 1]]);
    expect(signedDistance(pl, [0.3, 0.3, 0.2])).toBeCloseTo(0.2 * Math.sign(pl.normal[2]), 9);
    expect(signedDistance({ type: 'Kugel', center: [0, 0, 0], normal: [0, 0, 1], radius: 2, rms: 0, form: 0, maxPos: 0, maxNeg: 0, n: 0 }, [0, 3, 0])).toBeCloseTo(1, 9);
    expect(signedDistance({ type: 'Zylinder', center: [0, 0, 0], normal: [0, 0, 1], radius: 2, rms: 0, form: 0, maxPos: 0, maxNeg: 0, n: 0 }, [1.5, 0, 7])).toBeCloseTo(-0.5, 9);
  });
});
