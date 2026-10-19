import { describe, expect, it } from 'vitest';
import { applyCrit, formByCrit } from '../src/core/chebyshev';
import { fitCircle3D, fitType, type FitResult } from '../src/core/fit';
import type { Vec3 } from '../src/core/linalg';

let s = 3; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5);
const circ = (pts: Vec3[]) => fitCircle3D(pts, [0, 0, 1]);
const ring = (n: number, r: (t: number) => number, c: [number, number] = [0, 0]) => Array.from({ length: n }, (_, i) => { const t = (2 * Math.PI * i) / n; const R = r(t); return [c[0] + R * Math.cos(t), c[1] + R * Math.sin(t), 0] as Vec3; });

describe('fit criteria (minimum zone, circumscribed, inscribed)', () => {
  it('minimum zone circle: 3-lobed ring → roundness = 2 × amplitude, centre exact', () => {
    const P = ring(720, (t) => 10 + 0.05 * Math.cos(3 * t) + 0.002 * rnd(), [1, 2]);
    const F = circ(P), mz = applyCrit(F, P, 'mz');
    expect(mz.form).toBeLessThanOrEqual(F.form + 1e-9);
    expect(mz.form).toBeGreaterThan(0.098); expect(mz.form).toBeLessThan(0.105);
    expect(Math.hypot(mz.center[0] - 1, mz.center[1] - 2)).toBeLessThan(0.005);
    expect(Math.abs(mz.maxPos + mz.maxNeg)).toBeLessThan(1e-6); // symmetric zone
  });
  it('minimum circumscribed / maximum inscribed circle', () => {
    const P = ring(360, () => 5); P.push([4.8, 0, 0]);
    const F = circ(P);
    const mic = applyCrit(F, P, 'mic'); expect(mic.radius!).toBeGreaterThan(4.89); expect(mic.radius!).toBeLessThan(4.905); expect(mic.maxNeg).toBeGreaterThan(-1e-6);
    const Q: Vec3[] = [[1, 1, 0], [-1, 1, 0], [-1, -1, 0], [1, -1, 0], [0.2, 0.1, 0], [0.5, -0.3, 0], [-0.2, 0.6, 0]];
    const mcc = applyCrit(circ(Q), Q, 'mcc'); expect(Math.abs(mcc.radius! - Math.SQRT2)).toBeLessThan(1e-3); expect(mcc.maxPos).toBeLessThan(1e-6);
  });
  it('plane: minimum zone flatness ≤ least squares, tangent planes one-sided', () => {
    const P: Vec3[] = []; for (let i = 0; i < 30; i++) for (let j = 0; j < 30; j++) P.push([i, j, 0.001 * i + 0.01 * Math.sin(i * 0.7) * Math.cos(j * 0.4) + (i === 3 && j === 4 ? 0.05 : 0)]);
    const F = fitType('Ebene', P, [], false) as FitResult;
    const mz = applyCrit(F, P, 'mz'), out = applyCrit(F, P, 'mcc'), inn = applyCrit(F, P, 'mic');
    expect(mz.form).toBeLessThanOrEqual(F.form + 1e-9);
    expect(out.maxPos).toBeLessThan(1e-9); expect(inn.maxNeg).toBeGreaterThan(-1e-9);
    expect(Math.abs(out.form - mz.form)).toBeLessThan(1e-9);
  });
  it('cylinder: minimum zone cylindricity ≤ least squares; roundness per fit table', () => {
    const P: Vec3[] = []; for (let k = 0; k < 20; k++) for (let i = 0; i < 72; i++) { const t = (2 * Math.PI * i) / 72, r = 6 + 0.02 * Math.cos(2 * t) + 0.003 * rnd(); P.push([r * Math.cos(t), r * Math.sin(t), k]); }
    const F = fitType('Zylinder', P, P.map((p) => [p[0], p[1], 0] as Vec3), false);
    const mz = applyCrit(F, P, 'mz'); expect(mz.form).toBeLessThanOrEqual(F.form + 1e-9);
    const tab = formByCrit(F, P); expect(Object.keys(tab).sort()).toEqual(['lsq', 'mcc', 'mic', 'mz']);
    expect(tab.mz!).toBeLessThanOrEqual(tab.lsq! + 1e-9);
  });
});
