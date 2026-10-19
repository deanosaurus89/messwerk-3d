// 0.30 (Phase 1 step 3): Create = raw fit – every selected point counts. Robust fits stay available (detection, filters).
import { describe, expect, it } from 'vitest';
import { fitInPlane } from '../src/core/aux';
import { fitType, FitResult } from '../src/core/fit';
import type { Vec3 } from '../src/core/linalg';

const plane: FitResult = { type: 'Ebene', center: [0, 0, 0], normal: [0, 0, 1], rms: 0, form: 0, maxPos: 0, maxNeg: 0, n: 0 };
const ring = (r: number, n: number, spike = 0): Vec3[] => Array.from({ length: n }, (_, i) => { const a = (2 * Math.PI * i) / n, rr = r + (i === 0 ? spike : 0.001 * Math.sin(7 * a));
  return [rr * Math.cos(a), rr * Math.sin(a), 0]; });
describe('raw fit at creation', () => {
  it('circle in plane: raw keeps every point (spike included), robust drops it', () => {
    const p = ring(5, 360, 0.3);
    const raw = fitInPlane('Kreis', p, plane, false), rob = fitInPlane('Kreis', p, plane);
    expect(raw.outliers).toBe(0); expect(rob.outliers).toBeGreaterThan(0);
    expect(raw.form).toBeGreaterThan(rob.form); // the spike is part of the raw form deviation
  });
  it('plane: fitType(…, 0) is raw', () => {
    const p: Vec3[] = []; for (let i = 0; i < 400; i++) p.push([i % 20, Math.floor(i / 20), i === 7 ? 0.5 : 0.001 * Math.sin(i)]);
    const n = p.map(() => [0, 0, 1] as Vec3);
    expect(fitType('Ebene', p, n, 0).outliers).toBeUndefined();
    expect(fitType('Ebene', p, n).outliers).toBeGreaterThan(0);
  });
});
