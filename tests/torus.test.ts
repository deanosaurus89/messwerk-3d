import { describe, expect, it } from 'vitest';
import { fitTorus, autoFit } from '../src/core/fit';
import type { Vec3 } from '../src/core/linalg';
function torus(c: Vec3, R: number, r: number, hmin = -1, noise = 0.005, n = 3000, tilt = 0.2) {
  const p: Vec3[] = [], nn: Vec3[] = [];
  const ax: Vec3 = [Math.sin(tilt), 0, Math.cos(tilt)], u: Vec3 = [Math.cos(tilt), 0, -Math.sin(tilt)], v: Vec3 = [0, 1, 0];
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  while (p.length < n) {
    const a = rnd() * 2 * Math.PI, b = rnd() * 2 * Math.PI;
    if (Math.sin(b) < hmin) continue;
    const nl: Vec3 = [0, 0, 0], pt: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) { nl[k] = Math.cos(b) * (Math.cos(a) * u[k] + Math.sin(a) * v[k]) + Math.sin(b) * ax[k];
      pt[k] = c[k] + R * (Math.cos(a) * u[k] + Math.sin(a) * v[k]) + (r + (rnd() - 0.5) * 2 * noise) * nl[k]; }
    p.push(pt); nn.push(nl);
  }
  return { p, nn };
}
describe('Torus', () => {
  it('Vollring', () => {
    const { p, nn } = torus([10, 5, 3], 8, 2);
    const f = fitTorus(p, nn);
    expect(f.radius!).toBeCloseTo(8, 2); expect(f.minorRadius!).toBeCloseTo(2, 2);
    expect(f.center[0]).toBeCloseTo(10, 2); expect(Math.abs(f.normal[0])).toBeCloseTo(Math.sin(0.2), 3);
  });
  it('teilweise (oberer Teil, eingebettet) + Automatik', () => {
    const { p, nn } = torus([40, 10, 20.8], 6, 2, -0.4, 0.008, 3000, 0);
    const f = fitTorus(p, nn);
    expect(f.radius!).toBeCloseTo(6, 2); expect(f.minorRadius!).toBeCloseTo(2, 2); expect(f.center[2]).toBeCloseTo(20.8, 2);
    expect(autoFit(p, nn).best.type).toBe('Torus');
  });
});
