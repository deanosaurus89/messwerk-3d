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

import { axisNominal } from '../src/core/axisan';
describe('nominal axis from the full DRF', () => {
  const F = (id: number, type: any, center: number[], normal: number[], datum: string) => ({ id, name: datum, type, datum, pointCount: 9, measured: { type, center, normal } } as any);
  const A = F(1, 'Ebene', [5, 5, 0], [0, 0, 1], 'A'), B = F(2, 'Ebene', [0, 5, 5], [1, 0, 0], 'B'), C = F(3, 'Ebene', [5, 0, 5], [0, 1, 0], 'C');
  it('position: through basic X/Y from B and C, direction ⟂ A', () => {
    const n = axisNominal('Position', [A, B, C], [20, 30, 0], [0.01, 0, 1])!;
    expect(Math.abs(n.dir[2])).toBeCloseTo(1, 9); expect(n.point![0]).toBeCloseTo(20, 9); expect(n.point![1]).toBeCloseTo(30, 9);
  });
  it('perpendicularity: direction only', () => { const n = axisNominal('Rechtwinkligkeit', [A], undefined, [0, 0, 1])!; expect(n.point).toBeUndefined(); });
});

import { displayPoint } from '../src/core/axisan';
import { straightnessMZ } from '../src/core/median';
describe('median line: minimum-zone straightness and true-location display', () => {
  it('minimum zone tilts the zone: S-shaped line is better than the LSQ direction, never worse', () => {
    // points on a line with an S-bend: LSQ direction tilted vs. the optimum
    const P: Vec3[] = Array.from({ length: 21 }, (_, i) => { const z = -10 + i; return [0.002 * z + (i < 4 ? 0.02 : 0) - (i > 17 ? 0.015 : 0), 0, z] as Vec3; });
    const r = straightnessMZ(P, [0, 0, 1]); expect(r.dia).toBeLessThanOrEqual(r.diaLSQ + 1e-12);
    // brute force over the in-plane tilt (2D problem): optimiser must reach the true minimum
    let best = Infinity; for (let k = -4000; k <= 4000; k++) { const t = 0.002 + k * 1e-6; let lo = Infinity, hi = -Infinity; for (const p of P) { const w = (p[0] - t * p[2]) / Math.hypot(1, t); lo = Math.min(lo, w); hi = Math.max(hi, w); } best = Math.min(best, hi - lo); }
    expect(r.dia).toBeLessThan(best * 1.001 + 1e-9);
    // a case where tilting clearly helps: points on a line, LSQ pulled by one cluster
    const Q: Vec3[] = [...Array.from({ length: 10 }, (_, i) => [0, 0, i] as Vec3), ...Array.from({ length: 10 }, (_, i) => [0.01, 0, 20 + i * 0.1] as Vec3), [0.02, 0, 40] as Vec3];
    const q = straightnessMZ(Q, [0, 0, 1]); expect(q.dia).toBeLessThan(q.diaLSQ * 0.9);
    const T: Vec3[] = Array.from({ length: 11 }, (_, i) => [0.01 * i, 0.005 * i, i] as Vec3); expect(straightnessMZ(T, [0, 0, 1]).dia).toBeLessThan(1e-9);
  });
  it('display: median line stays at its real offset from the nominal axis, only the bend is exaggerated', () => {
    const P: Vec3[] = []; for (let i = 0; i < 4000; i++) { const z = -20 + (40 * i) / 4000, a = i * 0.37, bow = 0.01 * (1 - (z / 20) ** 2); P.push([0.5 + bow + 5 * Math.cos(a), 5 * Math.sin(a), z]); }
    const f: any = { type: 'Zylinder', center: [0.5, 0, 0], normal: [0, 0, 1], radius: 5, length: 40 };
    const an = analyzeAxis(f, P, { dir: [0, 0, 1], point: [0, 0, 0] });
    expect(an.offsetLen).toBeGreaterThan(0.5); expect(an.offsetLen).toBeLessThan(0.52);
    const mid = an.centers[Math.floor(an.centers.length / 2)], dp = displayPoint(an, mid, 100);
    // x of the displayed point: real offset ≈ 0.5 + 100 × (bend relative to own axis, ≤ ~0.01) – NOT 100 × 0.5
    expect(dp[0]).toBeGreaterThan(0.5); expect(dp[0]).toBeLessThan(2);
    const dl = displayPoint(an, mid, 1, 10); expect(dl[0]).toBeGreaterThan(5); expect(dl[0]).toBeLessThan(5.3); // location ×10
  });
});
