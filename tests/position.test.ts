import { describe, expect, it } from 'vitest';
import { buildDRF } from '../src/core/datum';
import { evaluate, Feature, Control } from '../src/core/features';
import { bonus, evalPositionGroup, PosMember } from '../src/core/position';
import type { Vec3 } from '../src/core/linalg';

const fit = (type: any, center: Vec3, normal: Vec3, extra: any = {}) => ({ type, center, normal, rms: 0.001, form: 0.002, maxPos: 0.001, maxNeg: -0.001, n: 100, ...extra });
const F = (id: number, name: string, type: any, m: any, datum?: string, extra: Partial<Feature> = {}): Feature => ({ id, name, type, measured: m, pointCount: 100, method: 'Klick', datum, ...extra });
const A = F(1, 'A', 'Ebene', fit('Ebene', [50, 50, 0], [0, 0, 1]), 'A');
const B = F(2, 'B', 'Ebene', fit('Ebene', [50, 0, 10], [0, -1, 0]), 'B');
const C = F(3, 'C', 'Ebene', fit('Ebene', [0, 50, 10], [-1, 0, 0]), 'C');
const line = (p: Vec3): Vec3[] => [[p[0], p[1], 0], [p[0], p[1], 10]];
const mem = (q: Vec3, nom: Vec3, t = 0.1): PosMember => ({ ML: line(q), nomP: nom, g: [0, 0, 1], t });

describe('position group solver', () => {
  it('free translations remove the location error; fixed ones keep it', () => {
    const m = mem([10.03, 5, 0], [10, 5, 0]);
    expect(evalPositionGroup([m], { freeT: [], freeR: false, shiftR: 0 }).dia[0]).toBeCloseTo(0.06, 6);
    expect(evalPositionGroup([m], { freeT: [[1, 0, 0]], freeR: false, shiftR: 0 }).dia[0]).toBeLessThan(1e-5);
    expect(evalPositionGroup([m], { freeT: [[0, 1, 0]], freeR: false, shiftR: 0 }).dia[0]).toBeCloseTo(0.06, 6);
  });
  it('a rotated pattern is OK when rotation is free, not when it is fixed', () => {
    const w = 0.002, ms = [0, 1, 2, 3].map((k) => { const a = (k * Math.PI) / 2; const nom: Vec3 = [20 * Math.cos(a), 20 * Math.sin(a), 0];
      return mem([20 * Math.cos(a + w), 20 * Math.sin(a + w), 0], nom); });
    expect(evalPositionGroup(ms, { freeT: [], freeR: false, shiftR: 0 }).dia[0]).toBeCloseTo(2 * 20 * 2 * Math.sin(w / 2), 5);
    expect(Math.max(...evalPositionGroup(ms, { freeT: [], freeR: true, shiftR: 0 }).dia)).toBeLessThan(1e-4);
  });
  it('common zone vs separate zones and the datum-shift bound', () => {
    // pattern shifted as a whole by 0.05 in X, one member additionally by 0.02 in Y
    const ms = [mem([10.05, 0, 0], [10, 0, 0]), mem([-9.95, 0.02, 0], [-10, 0, 0])];
    const fr = { freeT: [[1, 0, 0], [0, 1, 0]] as Vec3[], freeR: false, shiftR: 0 };
    const cz = evalPositionGroup(ms, fr, true), sep = evalPositionGroup(ms, fr, false);
    expect(Math.max(...cz.dia)).toBeCloseTo(0.02, 3); expect(Math.max(...sep.dia)).toBeLessThan(1e-4);
    // fixed location: shift bounded to |δ| ≤ 0.03 → remaining 0.02 in X
    const one = [mem([10.05, 0, 0], [10, 0, 0])];
    expect(evalPositionGroup(one, { freeT: [], freeR: false, shiftR: 0.03 }).dia[0]).toBeCloseTo(0.04, 3);
  });
  it('bonus rules (ISO 2692)', () => {
    expect(bonus('M', true, 12.05, 12, 0.1, 0).bonus).toBeCloseTo(0.05, 9);   // hole MMC 12.00
    expect(bonus('M', false, 11.97, 12, 0, -0.1).bonus).toBeCloseTo(0.03, 9); // shaft MMC 12.00
    expect(bonus('L', true, 12.06, 12, 0.1, 0).bonus).toBeCloseTo(0.04, 9);   // hole LMC 12.10
    const r = bonus('M', true, 11.99, 12, 0.1, 0); expect(r.bonus).toBe(0); expect(r.beyond).toBe(true);
  });
});

describe('DRF degrees of freedom', () => {
  const hole = F(7, 'H', 'Zylinder', fit('Zylinder', [30, 30, 5], [0, 0, 1], { radius: 5, diameter: 10, length: 10 }), 'B');
  it('A, A|B, A|B|C, A|hole', () => {
    let d = buildDRF([A]); expect(d.freeT).toEqual([0, 1]); expect(d.freeR).toBe(true);
    d = buildDRF([A, B]); expect(d.freeT).toEqual([0]); expect(d.freeR).toBe(false);
    d = buildDRF([A, B, C]); expect(d.freeT).toEqual([]); expect(d.freeR).toBe(false);
    d = buildDRF([A, hole]); expect(d.freeT).toEqual([]); expect(d.freeR).toBe(true);
  });
  it('a bolt-circle pattern as secondary datum also fixes the rotation', () => {
    const pat = F(8, 'P', 'Kreis', fit('Kreis', [30, 30, 0], [0, 0, 1], { radius: 20, direction: [0, 1, 0], pattern: { n: 4, angles: [], pitch: 90, pitchDev: 0, radialDev: 0 } }), 'B', { cons: { key: 'bc-pattern', refs: [] } });
    const d = buildDRF([A, pat]); expect(d.freeT).toEqual([]); expect(d.freeR).toBe(false); expect(d.o[0]).toBeCloseTo(30, 9);
  });
});

// four holes Ø10 on PCD 40 around (50,50), rotated by `rot` rad and shifted by `sh`
function patternMap(rot: number, sh: Vec3 = [0, 0, 0]) {
  const holes = [0, 1, 2, 3].map((k) => { const a = (k * Math.PI) / 2 + rot;
    return F(10 + k, 'H' + k, 'Zylinder', fit('Zylinder', [50 + sh[0] + 20 * Math.cos(a), 50 + sh[1] + 20 * Math.sin(a), 5], [0, 0, 1], { radius: 5, diameter: 10, length: 10 })); });
  const pat = F(20, 'Pattern', 'Kreis', fit('Kreis', [50 + sh[0], 50 + sh[1], 5], [0, 0, 1], { radius: 20, direction: [Math.cos(rot), Math.sin(rot), 0], pattern: { n: 4, angles: [], pitch: 90, pitchDev: 0, radialDev: 0 } }), undefined, { cons: { key: 'bc-pattern', refs: holes.map((h) => h.id) } });
  return new Map([A, B, C, ...holes, pat].map((f) => [f.id, f]));
}
const pc = (datumIds: number[], basic: (number | null)[], extra: Partial<Control> = {}): Control => ({ id: 9, kind: 'Position', featureIds: [20], nominal: 0, tolUp: 0.1, tolLo: 0, datumIds, basic, ...extra });

describe('pattern position', () => {
  const rot = 0.001; // ≈ 0.02 mm at R 20
  it('A|B|C with centre, PCD and start angle', () => {
    const r = evaluate(pc([1, 2, 3], [50, 50, null, null, null, 40, 0]), patternMap(rot));
    expect(r.measured!).toBeCloseTo(2 * 20 * 2 * Math.sin(rot / 2), 4); expect(r.status).toBe('IO');
    expect(r.detail).toContain('pattern of 4');
  });
  it('per-hole members: Ø, margin, worst-margin hole and the nominal axis on the pitch circle', () => {
    const r = evaluate(pc([1, 2, 3], [50, 50, null, null, null, 40, 0]), patternMap(rot));
    expect(r.members!.length).toBe(4); const w = r.members![r.worst!];
    expect(w.margin).toBeCloseTo(0.1 - r.measured!, 9); expect(Math.min(...r.members!.map((m) => m.margin))).toBeCloseTo(w.margin, 9);
    for (const m of r.members!) expect(Math.hypot(m.nomW[0] - 50, m.nomW[1] - 50)).toBeCloseTo(20, 6);
  });
  it('datum A only: location and rotation float → ~0', () => {
    const r = evaluate(pc([1], [null, null, null, null, null, 40, null]), patternMap(rot, [0.3, -0.2, 0]));
    expect(r.measured!).toBeLessThan(1e-3);
  });
  it('PCD not entered → actual PCD suggested, flagged unconfirmed', () => {
    expect(evaluate(pc([1, 2, 3], [50, 50, null, null, null, null, 0]), patternMap(rot)).flag).toBe('Nominal unconfirmed');
  });
});

describe('maximum material requirement', () => {
  // hole Ø10.06 actual, nominal Ø10 +0.1/0, at (20.04,20) → position Ø0.08 > t 0.05, but bonus 0.06 → OK with Ⓜ
  const P: Vec3[] = [], N: Vec3[] = [];
  for (let i = 0; i < 720; i++) { const a = i * 0.0873, z = (i % 20) * 0.5; P.push([20.04 + 5.03 * Math.cos(a), 20 + 5.03 * Math.sin(a), z]); N.push([-Math.cos(a), -Math.sin(a), 0]); }
  const H = F(30, 'Hole', 'Zylinder', fit('Zylinder', [20.04, 20, 5], [0, 0, 1], { radius: 5.03, diameter: 10.06, length: 10 }));
  const map = new Map([A, B, C, H].map((f) => [f.id, f]));
  const size: Control = { id: 31, kind: 'Durchmesser', featureIds: [30], nominal: 10, tolUp: 0.1, tolLo: 0 };
  const pos = (extra: Partial<Control> = {}): Control => ({ id: 32, kind: 'Position', featureIds: [30], nominal: 0, tolUp: 0.05, tolLo: 0, datumIds: [1, 2, 3], basic: [20, 20, null], ...extra });
  const ctx = { points: (id: number) => (id === 30 ? P : null), normals: (id: number) => (id === 30 ? N : null), controls: [size] };
  it('without modifier NOK, with Ⓜ OK by bonus', () => {
    expect(evaluate(pos(), map, ctx).status).toBe('NIO');
    const r = evaluate(pos({ mod: 'M' }), map, ctx);
    expect(r.measured!).toBeCloseTo(0.08, 3); expect(r.bonus!).toBeCloseTo(0.06, 3); expect(r.status).toBe('IO');
  });
  it('Ⓜ without a size control is flagged', () => {
    const r = evaluate(pos({ mod: 'M' }), map, { ...ctx, controls: [] }); expect(r.status).toBe('—'); expect(r.flag).toContain('size nominal missing');
  });
});
