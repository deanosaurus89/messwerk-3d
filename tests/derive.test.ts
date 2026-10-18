import { describe, expect, it } from 'vitest';
import { runDerive, derivesFor } from '../src/core/derive';
import { hardParentsOf } from '../src/core/provenance';
import type { Feature } from '../src/core/features';
import { Vec3, dot } from '../src/core/linalg';
const fit = (type: any, center: Vec3, normal: Vec3, extra: any = {}) => ({ type, center, normal, rms: 0.002, form: 0.01, maxPos: 0.005, maxNeg: -0.005, n: 100, ...extra });
describe('Derive feature from Analyze', () => {
  it('flatness: upper/lower planes of the minimum zone (width = flatness, all points between)', () => {
    const P: Vec3[] = []; for (let i = 0; i <= 30; i++) for (let j = 0; j <= 30; j++) P.push([i, j, 0.0003 * i + 0.004 * Math.sin(i * 0.9 + j * 1.3)]);
    const pl: Feature = { id: 1, name: 'P', type: 'Ebene', measured: fit('Ebene', [15, 15, 0.0045], [0, 0, 1]), pointCount: P.length, method: 'Klick' };
    const up = runDerive('zone-upper', pl, P), lo = runDerive('zone-lower', pl, P);
    for (const q of P) { expect(dot(q, up.normal) - dot(up.center, up.normal)).toBeLessThan(1e-9); expect(dot(q, lo.normal) - dot(lo.center, lo.normal)).toBeGreaterThan(-1e-9); }
    const w = dot(up.center, up.normal) - dot(lo.center, up.normal); expect(w).toBeGreaterThan(0.007); expect(w).toBeLessThan(0.0081);
    expect(up.normal[0] * lo.normal[0] + up.normal[1] * lo.normal[1] + up.normal[2] * lo.normal[2]).toBeCloseTo(1, 12);
  });
  it('cylinder: median line as Polyline and minimum-zone axis as Line', () => {
    const P: Vec3[] = []; for (let i = 0; i < 4000; i++) { const z = (20 * i) / 4000, a = i * 0.37, bow = 0.02 * (1 - ((z - 10) / 10) ** 2); P.push([bow + 6 * Math.cos(a), 6 * Math.sin(a), z]); }
    const cy: Feature = { id: 2, name: 'C', type: 'Zylinder', measured: fit('Zylinder', [0.013, 0, 10], [0, 0, 1], { radius: 6, length: 20 }), pointCount: P.length, method: 'Klick' };
    const ml = runDerive('median-line', cy, P); expect(ml.type).toBe('Linienzug'); expect(ml.pts!.length).toBeGreaterThan(8); expect(ml.length!).toBeGreaterThan(18);
    const ax = runDerive('mz-axis', cy, P); expect(ax.type).toBe('Linie'); expect(Math.abs(ax.direction![2])).toBeGreaterThan(0.9999); expect(ax.form!).toBeLessThan(0.025);
    expect(derivesFor('Zylinder').map((d) => d.key)).toEqual(['median-line', 'mz-axis']); expect(derivesFor('Ebene').length).toBe(2);
    expect(() => runDerive('median-line', cy, null)).toThrow();
  });
  it('derived features are hard children of their parent (recompute + cascade delete)', () => {
    const d: Feature = { id: 3, name: 'L', type: 'Linienzug', pointCount: 0, method: 'Abgeleitet', derived: { key: 'median-line', parent: 2 } };
    expect(hardParentsOf(d)).toEqual([2]);
  });
});
