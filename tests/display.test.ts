import { describe, expect, it, afterEach } from 'vitest';
import { setDec, decFor, getDec } from '../src/core/display';
import * as R from '../src/core/report';
// Options ▸ Decimal places: display only – values stay exact, unit vectors keep their places.
describe('decimal places', () => {
  afterEach(() => setDec(4));
  it('maps displayed places to the setting, clamps 0…6', () => {
    setDec(2); expect(decFor(4)).toBe(2); expect(decFor(3)).toBe(2); expect(decFor(1)).toBe(1); expect(decFor(6)).toBe(6);
    setDec(9); expect(getDec()).toBe(6); setDec(-1); expect(getDec()).toBe(0);
  });
  it('report CSV uses the setting, the snapshot keeps full precision', () => {
    const f = { id: 1, name: 'Kreis 1', type: 'Kreis' as const, pointCount: 10, measured: { type: 'Kreis', center: [0, 0, 0], normal: [0, 0, 1], radius: 5.01234, diameter: 10.02468, rms: 0.001, form: 0.004, residuals: [] } as any };
    const c = [{ id: 1, kind: 'Durchmesser' as const, featureIds: [1], nominal: 10, tolUp: 0.05, tolLo: -0.05 }];
    setDec(2); const r = R.buildReport(1, [f as any], c, 'x.stl');
    expect(r.controls[0].measured).toBeCloseTo(10.02468, 8);
    expect(R.reportCSV(r)).toContain('Kreis 1;Diameter;10,00;10,02;0,02;0,05;-0,05;OK');
    setDec(4); expect(R.reportCSV(r)).toContain('10,0247');
  });
});
