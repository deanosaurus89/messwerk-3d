import { describe, expect, it } from 'vitest';
import { facePatch, trimLoops } from '../src/core/facetrim';
import { sampleByChord } from '../src/cad/occcore';
import { creationLines, featureTreeParts, pathEnabled, resolveSide, sideChoices, slotCaption } from '../src/core/nominalui';
import { constructionSide, geometryForSide } from '../src/core/construct';
import type { FitResult } from '../src/core/fit';
import type { Vec3 } from '../src/core/linalg';

const fit = (over: Partial<FitResult> & { type: FitResult['type'] }): FitResult => ({
  center: [0, 0, 0], normal: [0, 0, 1], rms: 0, form: 0, maxPos: 0, maxNeg: 0, n: 0, ...over,
});

function covered(tri: Float32Array, x: number, y: number): boolean {
  for (let i = 0; i < tri.length; i += 9) {
    const ax = tri[i], ay = tri[i + 1], bx = tri[i + 3], by = tri[i + 4], cx = tri[i + 6], cy = tri[i + 7];
    const c1 = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    const c2 = (cx - bx) * (y - by) - (cy - by) * (x - bx);
    const c3 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
    const neg = c1 < -1e-7 || c2 < -1e-7 || c3 < -1e-7;
    const pos = c1 > 1e-7 || c2 > 1e-7 || c3 > 1e-7;
    if (!(neg && pos)) return true;
  }
  return false;
}

describe('2026.0.52 exact face wires', () => {
  it('trims a plane to the CAD loop, including a straight edge and an island', () => {
    const plane = fit({ type: 'Ebene' });
    const loop: Vec3[] = [[-5, -5, 0.2], [5, -5, -0.2], [5, 5, 0.2], [-5, 5, 0]];
    const hole: Vec3[] = [[-1, -0.4, 0], [1, -0.4, 0], [1, 0.4, 0], [-1, 0.4, 0]];
    const patch = facePatch(plane, [loop, hole], 8)!;
    expect(patch.tri.length).toBeGreaterThan(9);
    for (let i = 0; i < patch.tri.length; i += 3) {
      expect(Math.abs(patch.tri[i])).toBeLessThanOrEqual(5.001);
      expect(Math.abs(patch.tri[i + 1])).toBeLessThanOrEqual(5.001);
      expect(Math.abs(patch.tri[i + 2])).toBeLessThan(1e-6);
    }
    expect(covered(patch.tri, 0, 0)).toBe(false);
    expect(covered(patch.tri, 3, 3)).toBe(true);
    expect(covered(patch.tri, 5.15, 0)).toBe(false);
  });

  it('keeps a cylinder patch on the analytic surface and inside the wire', () => {
    const cyl = fit({ type: 'Zylinder', radius: 10 });
    const p = (a: number, z: number): Vec3 => [10 * Math.cos(a), 10 * Math.sin(a), z];
    const loop = [p(0, 0), p(Math.PI / 2, 0), p(Math.PI / 2, 10), p(0, 10)];
    const patch = facePatch(cyl, [loop], 16)!;
    for (let i = 0; i < patch.tri.length; i += 3) {
      const x = patch.tri[i], y = patch.tri[i + 1], z = patch.tri[i + 2];
      expect(Math.hypot(x, y)).toBeCloseTo(10, 4);
      expect(z).toBeGreaterThanOrEqual(-1e-6);
      expect(z).toBeLessThanOrEqual(10 + 1e-6);
      expect(x).toBeGreaterThanOrEqual(-0.05);
      expect(y).toBeGreaterThanOrEqual(-0.05);
    }
    let worst = 0;
    for (let i = 0; i < patch.edges.length; i += 6) {
      const mx = (patch.edges[i] + patch.edges[i + 3]) / 2;
      const my = (patch.edges[i + 1] + patch.edges[i + 4]) / 2;
      worst = Math.max(worst, Math.abs(Math.hypot(mx, my) - 10));
    }
    expect(worst).toBeLessThan(0.2);
  });

  it('does not invent a mesh boundary when the face has no wires', () => {
    expect(trimLoops(undefined)).toEqual([]);
    expect(trimLoops([])).toEqual([]);
    const wires: Vec3[][] = [[[0, 0, 0], [1, 0, 0], [0, 1, 0]]];
    expect(trimLoops(wires)).toEqual(wires);
  });

  it('samples a line as its endpoints and a circle along the curve', () => {
    const line = sampleByChord((u) => [u, 0, 0], 0, 10, 0.05);
    expect(line).toEqual([[0, 0, 0], [10, 0, 0]]);
    const arc = sampleByChord((u) => [Math.cos(u), Math.sin(u), 0], 0, Math.PI / 2, 0.02);
    expect(arc.length).toBeGreaterThan(4);
    for (const p of arc) expect(Math.hypot(p[0], p[1])).toBeCloseTo(1, 6);
    for (let i = 1; i < arc.length; i++) {
      const a = arc[i - 1], b = arc[i];
      const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0];
      const u = Math.atan2(mid[1], mid[0]);
      const on: Vec3 = [Math.cos(u), Math.sin(u), 0];
      expect(Math.hypot(on[0] - mid[0], on[1] - mid[1])).toBeLessThanOrEqual(0.021);
    }
  });
});

describe('2026.0.52 nominal / measured and construct dialog', () => {
  it('offers a side only when that data or an existing feature of it is present', () => {
    expect(sideChoices(true, false)).toEqual({ soll: true, ist: false });
    expect(sideChoices(false, true)).toEqual({ soll: false, ist: true });
    expect(sideChoices(true, true)).toEqual({ soll: true, ist: true });
    expect(resolveSide('ist', true, false)).toBe('soll');
    expect(resolveSide('soll', false, true)).toBe('ist');
    expect(resolveSide('soll', true, true)).toBe('soll');
    expect(pathEnabled('soll', 'interactive', { cad: true, mesh: true, soll: false, ist: false })).toBe(true);
    expect(pathEnabled('soll', 'construct', { cad: true, mesh: false, soll: false, ist: false })).toBe(false);
    expect(pathEnabled('ist', 'interactive', { cad: true, mesh: false, soll: true, ist: false })).toBe(false);
    expect(pathEnabled('ist', 'construct', { cad: false, mesh: true, soll: false, ist: true })).toBe(true);
  });

  it('lists nominal, then measured, and the auxiliary plane only under a measured curve', () => {
    expect(featureTreeParts({ type: 'Ebene', soll: { fit: {} } })).toEqual(['soll']);
    expect(featureTreeParts({ type: 'Ebene', measured: {} })).toEqual(['ist']);
    expect(featureTreeParts({ type: 'Ebene', measured: {}, soll: { fit: {} }, aux: {} })).toEqual(['soll', 'ist']);
    expect(featureTreeParts({ type: 'Kreis', measured: {}, aux: {} })).toEqual(['ist', 'aux']);
    expect(featureTreeParts({ type: 'Kreis', soll: { fit: {} }, aux: {} })).toEqual(['soll']);
    expect(featureTreeParts({ type: 'Kreis', measured: {}, soll: { fit: {} }, aux: {} })).toEqual(['soll', 'ist', 'aux']);
    expect(slotCaption(0, 2, 'Plane 1')).toBe('From');
    expect(slotCaption(1, 2, 'Plane 2')).toBe('To');
    expect(slotCaption(2, 3, 'Plane 3')).toBe('Plane 3');
  });

  it('records how each component was created and which side a construction writes', () => {
    expect(creationLines({ soll: { source: 'cad', fit: {} } })).toEqual([{ role: 'soll', method: 'From CAD' }]);
    expect(creationLines({ measured: {}, method: 'Klick' })).toEqual([{ role: 'ist', method: 'Click & grow' }]);
    expect(creationLines({ measured: {}, soll: { source: 'cad', fit: {} }, method: 'aus Soll' })).toEqual([
      { role: 'soll', method: 'From CAD' }, { role: 'ist', method: 'From nominal' },
    ]);
    const nominal = { soll: { source: 'constructed' as const, fit: fit({ type: 'Linie' }) }, cons: { side: 'soll' as const }, method: 'Konstruiert' };
    expect(creationLines(nominal)[0]).toEqual({ role: 'soll', method: 'Construction' });
    expect(constructionSide(nominal)).toBe('soll');
    expect(geometryForSide({ soll: { fit: fit({ type: 'Ebene' }) } }, 'soll', false)?.type).toBe('Ebene');
    expect(geometryForSide({ soll: { fit: fit({ type: 'Ebene' }) } }, 'ist', false)).toBeNull();
    expect(geometryForSide({ soll: { fit: fit({ type: 'Ebene' }) } }, 'ist', true)?.type).toBe('Ebene');
    expect(constructionSide({ measured: fit({ type: 'Ebene' }), cons: { side: 'ist' } })).toBe('ist');
  });
});
