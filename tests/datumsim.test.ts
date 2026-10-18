import { describe, expect, it } from 'vitest';
import { simulateDatums, maxInscribed } from '../src/core/datumsim';
import type { Feature } from '../src/core/features';
import { Vec3, dot, norm, sub, cross, unit } from '../src/core/linalg';
const fit = (type: any, center: Vec3, normal: Vec3, extra: any = {}) => ({ type, center, normal, rms: 0.002, form: 0.01, maxPos: 0.005, maxNeg: -0.005, n: 100, ...extra });
const F = (id: number, type: any, m: any, datum: string): Feature => ({ id, name: type + id, type, measured: m, pointCount: 100, method: 'Klick', datum });

// plane z = 0 (outward +z), 40×40 grid
const grid = (h: (x: number, y: number) => number): Vec3[] => { const P: Vec3[] = []; for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) P.push([i, j, h(i, j)]); return P; };
describe('ISO 5459 datum simulation', () => {
  it('primary plane: tangent (minimax) plane touches the high points from outside the material', () => {
    const P = grid((x, y) => 0.0005 * x + (x === 20 && y === 20 ? 0.001 : 0)); // start normal not tilted → minimax must tilt
    const A = F(1, 'Ebene', fit('Ebene', [20, 20, 0.0003], [0, 0, 1]), 'A');
    const { feats, info } = simulateDatums([A], { points: () => P, normals: () => P.map(() => [0, 0, 1] as Vec3), datumFilter: false });
    const n = feats[0].measured!.normal, c = feats[0].measured!.center;
    for (const q of P) expect(dot(sub(q, c), n)).toBeLessThan(1e-9); // all points inside the material
    let mn = Infinity; for (const q of P) mn = Math.min(mn, dot(sub(q, c), n));
    expect(-mn).toBeLessThan(0.0011); // tilted onto the ramp: zone ≈ the 0.001 bump instead of 0.02
    expect(info[0].method).toContain('tangent plane');
  });
  it('central bump: plane lifts onto the bump (shift ≈ 0.02 vs. LSQ)', () => {
    const P = grid((x, y) => (Math.hypot(x - 20, y - 20) < 1 ? 0.02 : 0));
    const A = F(1, 'Ebene', fit('Ebene', [20, 20, 0], [0, 0, 1]), 'A');
    const r = simulateDatums([A], { points: () => P, normals: () => P.map(() => [0, 0, 1] as Vec3), datumFilter: false });
    expect(r.info[0].shift).toBeCloseTo(0.02, 4); expect(r.feats[0].measured!.center[2]).toBeCloseTo(0.02, 4);
  });
  it('outward side comes from vertex normals (normal pointing into the material is flipped for the contact)', () => {
    const P = grid((x, y) => (Math.hypot(x - 20, y - 20) < 1 ? -0.02 : 0)); // dent; material above (outward −z)
    const A = F(1, 'Ebene', fit('Ebene', [20, 20, 0], [0, 0, 1]), 'A');
    const r = simulateDatums([A], { points: () => P, normals: () => P.map(() => [0, 0, -1] as Vec3), datumFilter: false });
    expect(r.feats[0].measured!.center[2]).toBeCloseTo(-0.02, 4); expect(r.feats[0].measured!.normal[2]).toBeGreaterThan(0.999); // reported normal keeps the fit's sign
  });
  it('secondary plane is constrained exactly ⟂ the primary, tertiary fixed ⟂ both', () => {
    const A = F(1, 'Ebene', fit('Ebene', [20, 20, 0], [0, 0, 1]), 'A');
    const t = 0.01; const PB: Vec3[] = []; for (let i = 0; i <= 30; i++) for (let k = 1; k <= 10; k++) PB.push([i, Math.sin(t) * k, k]); // B tilted 0.57° towards A
    const B = F(2, 'Ebene', fit('Ebene', [15, 0.05, 5], unit([0, -1, Math.sin(t)])), 'B');
    const PC: Vec3[] = []; for (let j = 0; j <= 30; j++) for (let k = 1; k <= 10; k++) PC.push([0.002 * j, j, k]);
    const C = F(3, 'Ebene', fit('Ebene', [0.03, 15, 5], unit([-1, 0.002, 0])), 'C');
    const pts = (id: number) => (id === 1 ? grid(() => 0) : id === 2 ? PB : PC);
    const nrm = (id: number) => pts(id).map(() => (id === 1 ? [0, 0, 1] : id === 2 ? [0, -1, 0] : [-1, 0, 0]) as Vec3);
    const { feats, info } = simulateDatums([A, B, C], { points: pts, normals: nrm });
    expect(Math.abs(dot(feats[1].measured!.normal, [0, 0, 1]))).toBeLessThan(1e-12);
    const c3 = feats[2].measured!.normal; expect(norm(cross(c3, [1, 0, 0]))).toBeLessThan(1e-9);
    expect(info[1].method).toContain('⟂ previous'); expect(info[2].method).toContain('fixed');
    for (const q of PB) expect(dot(sub(q, feats[1].measured!.center), [0, -1, 0])).toBeLessThan(1e-9);
  });
  it('hole → maximum inscribed cylinder, shaft → minimum circumscribed', () => {
    const P: Vec3[] = [], N: Vec3[] = [];
    for (let k = 0; k < 20; k++) for (let i = 0; i < 90; i++) { const a = (i / 90) * 2 * Math.PI, r = i === 0 ? 5.98 : 6; P.push([r * Math.cos(a), r * Math.sin(a), k]); N.push([-Math.cos(a), -Math.sin(a), 0]); }
    const m = fit('Zylinder', [0, 0, 10], [0, 0, 1], { radius: 6, diameter: 12, length: 19 });
    const hole = simulateDatums([F(1, 'Zylinder', m, 'A')], { points: () => P, normals: () => N, datumFilter: false });
    const h = hole.feats[0].measured!; expect(hole.info[0].method).toContain('maximum inscribed');
    for (const q of P) expect(Math.hypot(q[0] - h.center[0], q[1] - h.center[1])).toBeGreaterThan(h.radius! - 1e-6);
    expect(h.radius!).toBeGreaterThan(5.985); expect(h.radius!).toBeLessThan(6); expect(h.center[0]).toBeLessThan(-0.002);
    const shaft = simulateDatums([F(2, 'Zylinder', m, 'A')], { points: () => P, normals: () => N.map((n) => [-n[0], -n[1], 0] as Vec3), datumFilter: false });
    expect(shaft.info[0].method).toContain('minimum circumscribed'); expect(shaft.feats[0].measured!.radius!).toBeCloseTo(6, 3);
  });
  it('3σ spike filter (default) ignores a single spike, keeps the contact on noise', () => {
    const P = grid((x, y) => 0.001 * Math.sin(x * 1.7 + y * 2.3) + (x === 20 && y === 20 ? 0.05 : 0));
    const A = F(1, 'Ebene', fit('Ebene', [20, 20, 0], [0, 0, 1]), 'A'), N = () => P.map(() => [0, 0, 1] as Vec3);
    const on = simulateDatums([A], { points: () => P, normals: N }), off = simulateDatums([A], { points: () => P, normals: N, datumFilter: false });
    expect(on.info[0].method).toContain('1 spike'); expect(on.info[0].shift).toBeLessThan(0.0011); expect(off.info[0].shift).toBeGreaterThan(0.049);
  });
  it('maximum inscribed circle of a square is its incircle', () => {
    const Q: [number, number][] = []; for (let i = 0; i <= 100; i++) { const t = i / 100 * 2 - 1; Q.push([t, -1], [t, 1], [-1, t], [1, t]); }
    const c = maxInscribed(Q, [0.2, -0.1], 1); expect(c.r).toBeCloseTo(1, 3); expect(Math.hypot(c.x, c.y)).toBeLessThan(2e-3);
  });
  it('least-squares mode and missing normals keep the Gauss datum', () => {
    const A = F(1, 'Zylinder', fit('Zylinder', [0, 0, 0], [0, 0, 1], { radius: 6 }), 'A');
    expect(simulateDatums([A], { points: () => grid(() => 0), datumAssoc: 'lsq' }).feats[0]).toBe(A);
    expect(simulateDatums([A], { points: () => grid(() => 0) }).info[0].method).toContain('least squares');
  });
});
