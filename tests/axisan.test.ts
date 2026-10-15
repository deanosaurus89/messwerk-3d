import { describe, expect, it } from 'vitest';
import { analyzeAxis } from '../src/core/axisan';
import type { Vec3 } from '../src/core/linalg';
// cylinder r=5, length 40, axis tilted by 0.1 mm over 40 mm in x; nominal axis = z through origin
describe('axis analysis', () => {
  const pts: Vec3[] = []; const k = 0.1 / 40;
  for (let i = 0; i < 4000; i++) { const z = -20 + (40 * i) / 4000, a = i * 0.37; pts.push([5 * Math.cos(a) + k * z, 5 * Math.sin(a), z]); }
  const fit: any = { type: 'Zylinder', center: [0, 0, 0], normal: [k, 0, 1], radius: 5, length: 40 };
  it('tilt, section centres and zone vs nominal z axis', () => {
    const r = analyzeAxis(fit, pts, { dir: [0, 0, 1], point: [0, 0, 0] }, 0.05);
    expect(r.tiltDeg).toBeCloseTo(Math.atan(k) * 180 / Math.PI, 4);
    expect(r.centers.length).toBe(8);
    expect(r.zone).toBeCloseTo(0.1, 2);          // ends at ±0.05 → Ø 0.1
    expect(Math.max(...r.devs)).toBeLessThan(0.05 + 1e-3);
  });
  it('without nominal → deviations from the fitted axis ≈ 0', () => {
    const r = analyzeAxis(fit, pts); expect(r.tiltDeg).toBeCloseTo(0, 6); expect(Math.max(...r.devs)).toBeLessThan(5e-3);
  });
});
