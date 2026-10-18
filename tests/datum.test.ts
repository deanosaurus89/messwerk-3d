import { describe, expect, it } from 'vitest';
import { buildDRF, toLocal } from '../src/core/datum';
import { evaluate, Feature, Control } from '../src/core/features';
import type { Vec3 } from '../src/core/linalg';
const fit = (type: any, center: Vec3, normal: Vec3, extra: any = {}) => ({ type, center, normal, rms: 0.002, form: 0.01, maxPos: 0.005, maxNeg: -0.005, n: 100, ...extra });
const F = (id: number, name: string, type: any, m: any, datum?: string): Feature => ({ id, name, type, measured: m, pointCount: 100, method: 'Klick', datum });
const A = F(1, 'Ebene 1', 'Ebene', fit('Ebene', [50, 30, 20], [0, 0, 1]), 'A');
const B = F(2, 'Ebene 2', 'Ebene', fit('Ebene', [50, 0, 10], [0, -1, 0]), 'B');
const C = F(3, 'Ebene 3', 'Ebene', fit('Ebene', [0, 30, 10], [-1, 0, 0]), 'C');
const tilt = 0.001;
const Z1 = F(4, 'Zylinder 1', 'Zylinder', fit('Zylinder', [20.03, 19.98, 10], [Math.sin(tilt), 0, Math.cos(tilt)], { radius: 6, diameter: 12, length: 20 }));
const map = () => new Map([A, B, C, Z1].map((f) => [f.id, f]));
const ctl = (kind: any, datumIds: number[], extra: Partial<Control> = {}): Control => ({ id: 1, kind, featureIds: [4], nominal: 0, tolUp: 0.1, tolLo: 0, datumIds, ...extra });

describe('Bezugssystem A|B|C', () => {
  it('Ursprung im Schnitt der drei Ebenen, X/Y wie Welt', () => {
    const d = buildDRF([A, B, C]);
    expect(d.o[0]).toBeCloseTo(0, 9); expect(d.o[1]).toBeCloseTo(0, 9); expect(d.o[2]).toBeCloseTo(20, 9);
    expect(d.x).toEqual([1, 0, 0].map((v) => expect.closeTo(v, 9))); expect(d.z[2]).toBeCloseTo(1, 9);
    const l = toLocal(d, [20, 20, 5]); expect(l[0]).toBeCloseTo(20, 9); expect(l[1]).toBeCloseTo(20, 9); expect(l[2]).toBeCloseTo(-15, 9);
  });
  it('Position Ø (zylindrische Zone) und IO/NIO', () => {
    const r = evaluate(ctl('Position', [1, 2, 3], { basic: [20, 20, 0] }), map());
    expect(r.measured!).toBeCloseTo(2 * Math.hypot(0.03 + 10 * Math.sin(tilt), 0.02), 4); expect(r.status).toBe('IO');
    expect(evaluate(ctl('Position', [1, 2, 3], { basic: [20, 20, 0], tolUp: 0.05 }), map()).status).toBe('NIO');
  });
  it('Rechtwinkligkeit Achse zu A, Parallelität zu B fehlerhaft', () => {
    expect(evaluate(ctl('Rechtwinkligkeit', [1]), map()).measured!).toBeCloseTo(20 * Math.sin(tilt), 6);
    expect(evaluate(ctl('Parallelität', [1]), map()).measured!).toBeCloseTo(20 * Math.cos(tilt), 3);
  });
  it('Bezug umbenennen bleibt gültig, entfernen markiert', () => {
    const m = map(); m.get(1)!.datum = 'D';
    const c = ctl('Position', [1, 2, 3], { basic: [20, 20, 0] });
    expect(evaluate(c, m).status).toBe('IO');
    m.get(2)!.datum = undefined;
    const r = evaluate(c, m); expect(r.status).toBe('—'); expect(r.flag).toBe('Bezug entfernt');
    m.get(1)!.datum = 'A'; m.get(2)!.datum = 'B';
  });
  it('Parallelität einer Ebene aus Punkten', () => {
    const top = F(5, 'Ebene 4', 'Ebene', fit('Ebene', [50, 30, 40], [0, 0, 1]));
    const pts: Vec3[] = []; for (let i = 0; i <= 10; i++) pts.push([i * 10, 30, 40 + i * 0.002]);
    const m = map(); m.set(5, top);
    const r = evaluate({ id: 2, kind: 'Parallelität', featureIds: [5], nominal: 0, tolUp: 0.05, tolLo: 0, datumIds: [1] }, m, { points: (id: number) => (id === 5 ? pts : null) });
    expect(r.measured!).toBeCloseTo(0.02, 9);
  });
  it('Koaxialität und Rundlauf', () => {
    const ax = F(6, 'Zylinder 2', 'Zylinder', fit('Zylinder', [20, 20, 10], [0, 0, 1], { radius: 6, diameter: 12, length: 20 }), 'D');
    const m = map(); m.set(6, ax);
    expect(evaluate(ctl('Koaxialität', [6]), m).measured!).toBeCloseTo(2 * Math.hypot(0.03 + 10 * Math.sin(tilt), 0.02), 4);
    const pts: Vec3[] = []; for (let k = 0; k < 360; k += 5) { const a = k * Math.PI / 180; pts.push([20.03 + 6 * Math.cos(a), 19.98 + 6 * Math.sin(a), 5]); }
    const r = evaluate(ctl('Rundlauf', [6]), m, { points: () => pts });
    expect(r.measured!).toBeCloseTo(2 * Math.hypot(0.03, 0.02), 2);
  });
});

describe('Position from the derived median line', () => {
  it('uses the section centres when points are available (bent axis → larger than from end points)', () => {
    // cylinder axis through (20,20) straight, but bowed by 0.03 mm in the middle
    const P: Vec3[] = []; for (let i = 0; i < 4000; i++) { const z = (20 * i) / 4000, a = i * 0.37, bow = 0.03 * (1 - ((z - 10) / 10) ** 2); P.push([20 + bow + 6 * Math.cos(a), 20 + 6 * Math.sin(a), z]); }
    const Zs = F(9, 'Z', 'Zylinder', fit('Zylinder', [20, 20, 10], [0, 0, 1], { radius: 6, diameter: 12, length: 20 }));
    const m = new Map([A, B, C, Zs].map((f) => [f.id, f])), c = ctl('Position', [1, 2, 3], { basic: [20, 20, 0] }); c.featureIds = [9];
    const noPts = evaluate(c, m), withPts = evaluate(c, m, { points: (id: number) => (id === 9 ? P : null) } as any);
    expect(noPts.measured!).toBeLessThan(1e-6); expect(withPts.measured!).toBeGreaterThan(0.05); expect(withPts.measured!).toBeLessThan(0.062); expect(withPts.detail).toContain("median line");
  });
});

import { requiredBasic, NOMINAL_MISSING } from '../src/core/datum';
describe('TED never prefilled: nominal missing', () => {
  it('Position of a hole: X and Y (⟂ axis) required, Z not; missing → flag, no OK/NOK', () => {
    expect(requiredBasic({ kind: 'Position' }, Z1, [A, B, C])).toEqual([0, 1]);
    const r = evaluate(ctl('Position', [1, 2, 3], { basic: [null, null, null] }), map()); expect(r.flag).toBe(NOMINAL_MISSING); expect(r.status).toBe('—'); expect(r.measured).toBeNull();
    const half = evaluate(ctl('Position', [1, 2, 3], { basic: [20, null, null] }), map()); expect(half.flag).toBe(NOMINAL_MISSING);
    const ok = evaluate(ctl('Position', [1, 2, 3], { basic: [20, 20, null] }), map()); expect(ok.flag).toBeUndefined(); expect(ok.measured).toBeGreaterThan(0);
  });
  it('Angularity needs the angle; plane position needs only the normal component', () => {
    expect(evaluate(ctl('Neigung', [1], { basic: [null] }), map()).flag).toBe(NOMINAL_MISSING);
    expect(evaluate(ctl('Neigung', [1], {}), map()).flag).toBe(NOMINAL_MISSING);
    const P2 = F(7, 'Ebene 7', 'Ebene', fit('Ebene', [50, 30, 25], [0, 0, 1])); expect(requiredBasic({ kind: 'Position' }, P2, [A, B, C])).toEqual([2]);
  });
});

import { orientNominal, orientZone } from '../src/core/median';
import { analyzeAxis, axisNominal } from '../src/core/axisan';
import { controlCatalog } from '../src/core/features';
describe('Orientation / coaxiality / straightness of axis from the derived median line', () => {
  // bowed hole axis: bend 0.03 mm in X in the middle, otherwise ∥ Z
  const P: Vec3[] = []; for (let i = 0; i < 4000; i++) { const z = (20 * i) / 4000, a = i * 0.37, bow = 0.03 * (1 - ((z - 10) / 10) ** 2); P.push([20 + bow + 6 * Math.cos(a), 20 + 6 * Math.sin(a), z]); }
  const Zs = F(9, 'Z', 'Zylinder', fit('Zylinder', [20.02, 20, 10], [0, 0, 1], { radius: 6, diameter: 12, length: 20 }));
  const m = new Map([A, B, C, Zs].map((f) => [f.id, f])), ctx = { points: (id: number) => (id === 9 ? P : null) } as any;
  it('perpendicularity to plane A = floating Ø zone of the median line (≈ bow), same value as the axis view', () => {
    const c = ctl('Rechtwinkligkeit', [1]); c.featureIds = [9];
    const r = evaluate(c, m, ctx); expect(r.detail).toContain('median line'); expect(r.measured!).toBeGreaterThan(0.025); expect(r.measured!).toBeLessThan(0.032);
    const an = analyzeAxis(Zs.measured!, P, axisNominal('Rechtwinkligkeit', [A], undefined, [0, 0, 1]), 0.1);
    expect(an.zone).toBeCloseTo(r.measured!, 9);
  });
  it('parallelism of an axis to a plane = width between two planes along the plane normal', () => {
    const nom = orientNominal('Parallelität', true, [0, 1, 0], [0, 0, 1]); expect(nom.planeN).toEqual([0, 1, 0]);
    const ML: Vec3[] = [[0, 0, 0], [0, 0.02, 5], [0.5, -0.01, 10]]; expect(orientZone(ML, nom)).toBeCloseTo(0.03, 12);
    expect(orientNominal('Rechtwinkligkeit', false, [1, 0, 0], [0, 0, 1]).planeN).toEqual([1, 0, 0]);
    expect(orientNominal('Rechtwinkligkeit', true, [0, 0, 1], [0, 0, 1]).planeN).toBeUndefined();
  });
  it('angularity: nominal direction tilted by the TED angle', () => {
    const nom = orientNominal('Neigung', true, [0, 0, 1], [0.5, 0, 0.8], 60); // 60° to the plane → 30° to its normal
    expect(Math.acos(nom.dir[2]) * 180 / Math.PI).toBeCloseTo(30, 9);
  });
  it('coaxiality uses the median line (bow counts), straightness of axis via minimum zone', () => {
    const D = F(10, 'D', 'Zylinder', fit('Zylinder', [20, 20, 10], [0, 0, 1], { radius: 8, length: 20 }), 'D'); const m2 = new Map([...m, [10, D]]);
    const c = ctl('Koaxialität', [10]); c.featureIds = [9]; const r = evaluate(c, m2, ctx);
    expect(JSON.stringify(r)).toContain('median line'); expect(r.measured!).toBeGreaterThan(0.055); expect(r.measured!).toBeLessThan(0.062);
    const s = ctl('Geradheit Achse', [], { tolUp: 0.05 }); s.featureIds = [9]; const rs = evaluate(s, m2, ctx);
    expect(rs.measured!).toBeGreaterThan(0.025); expect(rs.measured!).toBeLessThan(0.032); expect(rs.status).toBe('IO');
    expect(evaluate(s, m2).measured).toBeNull(); // no points → no value
  });
  it('catalog offers "Straightness of axis" for cylinders and cones', () => {
    for (const t of ['Zylinder', 'Kegel'] as const) expect(controlCatalog(t).flatMap((g) => g.items.map((i) => i.kind))).toContain('Geradheit Achse');
  });
});

import { positionNominal } from '../src/core/datum';
describe('Oblique TEDs (θ/φ) for position', () => {
  // hole tilted 30° from Z towards +X, passing through (20,20,0) on datum A (z=0)
  const th = 30 * Math.PI / 180, dir: Vec3 = [Math.sin(th), 0, Math.cos(th)];
  const P: Vec3[] = []; const [u, v] = [[Math.cos(th), 0, -Math.sin(th)] as Vec3, [0, 1, 0] as Vec3];
  for (let i = 0; i < 4000; i++) { const t = (20 * i) / 4000, a = i * 0.37; P.push([20 + 0.01 + dir[0] * t + 5 * (Math.cos(a) * u[0] + Math.sin(a) * v[0]), 20 + dir[1] * t + 5 * (Math.cos(a) * u[1] + Math.sin(a) * v[1]), dir[2] * t + 5 * (Math.cos(a) * u[2] + Math.sin(a) * v[2])]); }
  const ctr: Vec3 = [20.01 + dir[0] * 10, 20, dir[2] * 10];
  const Zo = F(11, 'Zo', 'Zylinder', fit('Zylinder', ctr, dir, { radius: 5, diameter: 10, length: 20 }));
  const m = new Map([A, B, C, Zo].map((f) => [f.id, f])), ctx = { points: (id: number) => (id === 11 ? P : null) } as any;
  const A0 = F(1, 'Ebene 1', 'Ebene', fit('Ebene', [50, 30, 0], [0, 0, 1]), 'A'); m.set(1, A0);
  it('nominal direction from θ/φ, TED point on the datum plane; offset 0.01 in X → Ø ≈ 0.02·cos30°', () => {
    const c = ctl('Position', [1, 2, 3], { basic: [20, 20, null, 30, 0] }); c.featureIds = [11];
    const r = evaluate(c, m, ctx); expect(r.detail).toContain('oblique');
    expect(r.measured!).toBeCloseTo(2 * 0.01 * Math.cos(th), 4);
  });
  it('without angles the nominal snaps to the nearest DRF axis (Z) → large value', () => {
    const c = ctl('Position', [1, 2, 3], { basic: [20, 20, null] }); c.featureIds = [11];
    expect(evaluate(c, m, ctx).measured!).toBeGreaterThan(5);
  });
  it('positionNominal: θ=90, φ=90 → nominal ∥ Y', () => {
    const N = positionNominal({ o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], text: '', free: [], freeT: [], freeR: false }, Zo, [1, 2, 3, 90, 90]);
    expect(N.ax).toBe(1); expect(N.g[1]).toBeCloseTo(1, 12); expect(N.b).toEqual([1, 2, 3]);
  });
});

import { worstPlaneN, defaultDia } from '../src/core/median';
describe('Orientation zone shape: Ø vs. two parallel planes', () => {
  const s = 0.02, ML: Vec3[] = [[0, 0, 0], [s, 0, 5], [s / 2, s * Math.sqrt(3) / 2, 10]]; // equilateral triangle in XY
  it('defaults: Ø for axis ⟂ plane / ∥ axis / angularity; planes for axis ∥ plane / ⟂ axis', () => {
    expect(defaultDia('Rechtwinkligkeit', true)).toBe(true); expect(defaultDia('Parallelität', false)).toBe(true); expect(defaultDia('Neigung', true)).toBe(true);
    expect(defaultDia('Parallelität', true)).toBe(false); expect(defaultDia('Rechtwinkligkeit', false)).toBe(false);
  });
  it('axis ⟂ plane: Ø zone = enclosing circle (1.155·s), without Ø = worst-direction plane pair (s)', () => {
    expect(orientZone(ML, orientNominal('Rechtwinkligkeit', true, [0, 0, 1], [0, 0, 1]))).toBeCloseTo(2 * s / Math.sqrt(3), 9);
    const nom = orientNominal('Rechtwinkligkeit', true, [0, 0, 1], [0, 0, 1], 0, false); expect(nom.worst).toBe(true);
    expect(orientZone(ML, nom)).toBeCloseTo(s, 7); const n = worstPlaneN(ML, [0, 0, 1]); expect(Math.abs(n[2])).toBeLessThan(1e-12);
  });
  it('control flag dia=false switches the table value to the plane pair', () => {
    const P: Vec3[] = []; for (let i = 0; i < 4000; i++) { const z = (20 * i) / 4000, a = i * 0.37, bow = 0.03 * (1 - ((z - 10) / 10) ** 2); P.push([20 + bow + 6 * Math.cos(a), 20 + 6 * Math.sin(a), z]); }
    const Zs = F(9, 'Z', 'Zylinder', fit('Zylinder', [20.02, 20, 10], [0, 0, 1], { radius: 6, diameter: 12, length: 20 }));
    const m = new Map([A, B, C, Zs].map((f) => [f.id, f])), ctx = { points: (id: number) => (id === 9 ? P : null) } as any;
    const c = ctl('Rechtwinkligkeit', [1]); c.featureIds = [9]; const d = evaluate(c, m, ctx).measured!;
    c.dia = false; const p = evaluate(c, m, ctx); expect(p.detail).toContain('two planes'); expect(p.measured!).toBeLessThanOrEqual(d + 1e-9); expect(p.measured!).toBeGreaterThan(0.02);
  });
});
