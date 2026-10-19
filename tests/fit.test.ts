import { describe, expect, it } from 'vitest';
import { autoFit, fitCircle3D, fitCone, fitCylinder, fitPlane, fitSlot, fitSphere, fitType } from '../src/core/fit';
import { eigSym3, levenbergMarquardt } from '../src/core/linalg';
import * as S from './synth';

const ang = (a: number[], b: number[]) => Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b)));

describe('Lineare Algebra', () => {
  it('Eigenwerte symmetrisch 3x3', () => {
    const e = eigSym3([[2, 1, 0], [1, 2, 0], [0, 0, 5]]);
    expect(e.values[0]).toBeCloseTo(1); expect(e.values[1]).toBeCloseTo(3); expect(e.values[2]).toBeCloseTo(5);
  });
  it('Levenberg-Marquardt Exponentialfit', () => {
    const xs = Array.from({ length: 20 }, (_, i) => i / 4), ys = xs.map((x) => 2 * Math.exp(-0.7 * x));
    const r = levenbergMarquardt((q, o) => xs.forEach((x, i) => (o[i] = q[0] * Math.exp(q[1] * x) - ys[i])), [1, 0], 20);
    expect(r.x[0]).toBeCloseTo(2, 6); expect(r.x[1]).toBeCloseTo(-0.7, 6);
  });
});

describe('Regelgeometrie-Fits (synthetisch, Rauschen 0.01 mm)', () => {
  it('Ebene', () => {
    const { P } = S.plane([10, 20, 30], [0.1, 0.2, 1], 50, 2000, 0.01);
    const f = fitPlane(P);
    expect(ang(f.normal, [0.1, 0.2, 1])).toBeLessThan(1e-3);
    expect(f.rms).toBeGreaterThan(0.007); expect(f.rms).toBeLessThan(0.013);
  });
  it('Kreis 3D', () => {
    const { P } = S.cylinder([5, 5, 5], [0, 0, 1], 6, 0.001, 500, 0.005);
    const f = fitCircle3D(P, [0, 0, 1]);
    expect(f.radius!).toBeCloseTo(6, 2); expect(f.center[0]).toBeCloseTo(5, 2);
  });
  it('Kugel (Halbkugel)', () => {
    const { P } = S.sphere([1, 2, 3], 7.5, 3000, 0.01, 3, Math.PI / 2);
    const f = fitSphere(P);
    expect(f.radius!).toBeCloseTo(7.5, 2); expect(f.center[2]).toBeCloseTo(3, 2);
  });
  it('Zylinder schräg mit gestörtem Achs-Startwert', () => {
    const ax: [number, number, number] = [0.3, -0.2, 1];
    const { P } = S.cylinder([10, -4, 2], ax, 8, 30, 4000, 0.01);
    const f = fitCylinder(P, [0.35, -0.1, 1]);
    expect(f.diameter!).toBeCloseTo(16, 2); expect(ang(f.normal, ax)).toBeLessThan(1e-3);
  });
  it('Kegel', () => {
    const a = (15 * Math.PI) / 180;
    const { P, N } = S.cone([0, 0, 0], [0, 0, 1], a, 10, 25, 4000, 0.01);
    const f = fitCone(P, N);
    expect((2 * f.halfAngle! * 180) / Math.PI).toBeCloseTo(30, 1);
    expect(f.apex![2]).toBeCloseTo(0, 1);
  });
  it('Langloch', () => {
    const { P } = S.slot([3, 4, 0], 30, 10, 12, 4000, 0.01);
    const f = fitSlot(P, [0, 0, 1]);
    expect(f.length!).toBeCloseTo(30, 2); expect(f.width!).toBeCloseTo(10, 2);
    expect(f.center[0]).toBeCloseTo(3, 2); expect(Math.abs(f.direction![0])).toBeCloseTo(1, 3);
  });
  it('Robuster Fit ignoriert Ausreißer', () => {
    const { P, N } = S.plane([0, 0, 0], [0, 0, 1], 40, 2000, 0.005);
    for (let i = 0; i < 40; i++) P[i] = [P[i][0], P[i][1], 2];
    const f = fitType('Ebene', P, N);
    expect(f.center[2]).toBeCloseTo(0, 2); expect(f.form).toBeLessThan(0.05);
  });
});

describe('Automatische Typerkennung', () => {
  const cases: [string, () => { P: any; N: any }][] = [
    ['Ebene', () => S.plane([0, 0, 0], [0, 1, 1], 30, 3000, 0.01)],
    ['Zylinder', () => S.cylinder([0, 0, 0], [1, 0, 1], 6, 20, 3000, 0.01)],
    ['Kugel', () => S.sphere([0, 0, 0], 10, 3000, 0.01, 3, 1.2)],
    ['Kegel', () => S.cone([0, 0, 0], [0, 0, 1], 0.4, 10, 20, 3000, 0.01)],
    ['Langloch', () => S.slot([0, 0, 0], 40, 12, 10, 3000, 0.01)],
    ['Kreis', () => S.cylinder([0, 0, 0], [0, 0, 1], 10, 2, 3000, 0.01)],
  ];
  for (const [t, gen] of cases) it(t, () => { const { P, N } = gen(); expect(autoFit(P, N).best.type).toBe(t); });
});

describe('Abstand', () => {
  it('Regeln Mittelpunkt/Ebene', async () => {
    const { computeDistance } = await import('../src/core/features');
    const base = { rms: 0, form: 0, maxPos: 0, maxNeg: 0, n: 0 };
    const pl = { ...base, type: 'Ebene' as const, center: [0, 0, 0] as any, normal: [0, 0, 1] as any };
    const c1 = { ...base, type: 'Zylinder' as const, center: [10, 5, 7] as any, normal: [0, 0, 1] as any };
    const c2 = { ...base, type: 'Kugel' as const, center: [13, 9, 7] as any, normal: [0, 0, 1] as any };
    expect(computeDistance(c1, c2).distance).toBeCloseTo(5);
    const d = computeDistance(pl, c1);
    expect(d.distance).toBeCloseTo(7); expect(d.p1).toEqual([10, 5, 0]);
    expect(computeDistance(c1, pl).delta![2]).toBeCloseTo(-7);
  });
  it('Max. +/- Abweichung', () => {
    const { P } = S.plane([0, 0, 0], [0, 0, 1], 10, 500, 0.01);
    const f = fitPlane(P);
    expect(f.maxPos).toBeGreaterThan(0); expect(f.maxNeg).toBeLessThan(0);
    expect(f.form).toBeCloseTo(f.maxPos - f.maxNeg, 9);
  });
});

describe('Katalog', () => {
  it('Formtoleranz je Typ und Winkel', async () => {
    const F = await import('../src/core/features');
    expect(F.controlCatalog('Kreis')[0].items[0].label).toBe('Roundness');
    expect(F.controlCatalog('Ebene')[0].items[0].symbol).toBe('⏥');
    expect(F.availableControls('Abstand')).toEqual(['Abstand 3D', 'Abstand X', 'Abstand Y', 'Abstand Z']);
    const f = { id: 1, name: 'E', type: 'Ebene' as const, pointCount: 0, method: 'Klick' as const,
      measured: { type: 'Ebene' as const, center: [0, 0, 0] as any, normal: [0, Math.sin(0.1), Math.cos(0.1)] as any, rms: 0, form: 0, maxPos: 0, maxNeg: 0, n: 0 } };
    const v = F.measuredValue({ id: 1, kind: 'Winkel Z', featureIds: [1], nominal: 0, tolUp: 1, tolLo: -1 }, new Map([[1, f]]));
    expect(v!).toBeCloseTo(0.1 * 180 / Math.PI, 6);
  });
});

describe('Bericht', () => {
  it('Momentaufnahme, CSV und HTML', async () => {
    const F = await import('../src/core/features');
    const R = await import('../src/core/report');
    const m = { type: 'Kreis' as const, center: [1, 2, 3] as any, normal: [0, 0, 1] as any, radius: 5, diameter: 10.02, rms: 0.01, form: 0.03, maxPos: 0.01, maxNeg: -0.02, n: 100 };
    const f: any = { id: 1, name: 'Kreis 1', type: 'Kreis', measured: m, pointCount: 100, method: 'Klick',
      aux: { plane: { ...m, type: 'Ebene', form: 0.004 }, pointCount: 50, source: 'automatisch' } };
    const c = [{ id: 1, kind: 'Durchmesser' as const, featureIds: [1], nominal: 10, tolUp: 0.01, tolLo: -0.01 },
      { id: 2, kind: 'Form' as const, featureIds: [1], nominal: 0, tolUp: 0.05, tolLo: 0 }];
    const r = R.buildReport(1, [f], c, 'teil.stl');
    expect(r.name).toBe('Table 1'); expect(r.nio).toBe(1); expect(r.io).toBe(1);
    expect(r.controls[1].control).toBe('Roundness');
    m.diameter = 99; // Momentaufnahme bleibt unverändert
    expect(r.controls[0].measured).toBeCloseTo(10.02, 6);
    const csv = R.reportCSV(r);
    // tolerance tables off (default): pre-0.24 columns, no “Tol. source”
    expect(csv).toContain('Kreis 1;Diameter;10,0000;10,0200;0,0200;0,0100;-0,0100;NOK');
    expect(csv).not.toContain('Tol. source');
    const csvT = R.reportCSV({ ...r, tolCol: true }); expect(R.buildReport(1, [f], c, 'x', new Date(), {}, { tolTables: true }).tolCol).toBe(true);
    expect(csvT).toContain('Kreis 1;Diameter;10,0000;10,0200;0,0200;0,0100;-0,0100;;NOK');
    expect(csv).toContain('Aux. plane (automatisch');
    expect(R.reportHTML(r)).toContain('<span class="st NIO">NOK</span>');
    void F;
  });
});
