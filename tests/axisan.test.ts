import { describe, expect, it } from 'vitest';
import { analyzeAxis, minCircle } from '../src/core/axisan';
import type { Vec3 } from '../src/core/linalg';
// cylinder r=5, length 40, axis tilted by 0.1 mm over 40 mm in x; nominal axis = z through origin
describe('axis analysis', () => {
  const pts: Vec3[] = []; const k = 0.1 / 40;
  for (let i = 0; i < 4000; i++) { const z = -20 + (40 * i) / 4000, a = i * 0.37; pts.push([5 * Math.cos(a) + k * z, 5 * Math.sin(a), z]); }
  const fit: any = { type: 'Zylinder', center: [0, 0, 0], normal: [k, 0, 1], radius: 5, length: 40 };
  it('tilt, section centres and zone vs nominal z axis', () => {
    const r = analyzeAxis(fit, pts, { dir: [0, 0, 1], point: [0, 0, 0] }, 0.05);
    expect(r.tiltDeg).toBeCloseTo(Math.atan(k) * 180 / Math.PI, 4);
    expect(r.centers.length).toBe(40);           // automatic: 4000 pts → 40 sections
    expect(r.mode).toBe('position');
    expect(r.zone).toBeGreaterThan(0.095); expect(r.zone).toBeLessThan(0.1 + 1e-3); // median line spans ±0.05 → Ø ≈ 0.1
    expect(Math.max(...r.devs)).toBeLessThan(0.05 + 1e-3);
  });
  it('without nominal → deviations from the fitted axis ≈ 0', () => {
    const r = analyzeAxis(fit, pts); expect(r.tiltDeg).toBeCloseTo(0, 6); expect(Math.max(...r.devs)).toBeLessThan(5e-3);
  });
  it('orientation floats sideways, position does not', () => {
    const P = pts.map((p) => [p[0] - k * p[2] + 1, p[1], p[2]] as Vec3), f: any = { ...fit, center: [1, 0, 0], normal: [0, 0, 1] };
    const o = analyzeAxis(f, P, { dir: [0, 0, 1] }); expect(o.mode).toBe('orientation'); expect(o.zone).toBeLessThan(2e-3);
    const p = analyzeAxis(f, P, { dir: [0, 0, 1], point: [0, 0, 0] }); expect(p.zone).toBeCloseTo(2, 2);
  });
  it('straightness of a bent median line', () => {
    const P: Vec3[] = []; for (let i = 0; i < 4000; i++) { const z = -20 + (40 * i) / 4000, a = i * 0.37, b = 0.04 * (1 - (z / 20) ** 2); P.push([5 * Math.cos(a) + b, 5 * Math.sin(a), z]); }
    const r = analyzeAxis({ ...fit, normal: [0, 0, 1] }, P); expect(r.straightness).toBeGreaterThan(0.03); expect(r.straightness).toBeLessThan(0.045);
  });
  it('minCircle', () => { const c = minCircle([[0, 0], [2, 0], [1, 0.2], [1, -0.5]]); expect(c.r).toBeCloseTo(1, 6); expect(c.x).toBeCloseTo(1, 6); });
});
