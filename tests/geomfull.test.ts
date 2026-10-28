// 0.44: cone and sphere geometry follow the fitted analytic surface, not the selected patch.
// A cone the mesh only covers as a frustum stays trimmed at those open ends (no invented apex).
// A cylinder keeps the 0.27 point-height span.
import { describe, expect, it } from 'vitest';
import { analyticShell, analyticSphere, surfaceAxial } from '../src/core/trim';
import { buildRegion, inRegion, reextract } from '../src/core/reextract';
import type { FitResult } from '../src/core/fit';

const base = { maxDist: 0.4, sigma: 3, sigmaOn: false as const, maxAngleDeg: 30, angleOn: false as const, margin: 0 };

function frustum() {
  const a = (18 * Math.PI) / 180, na = 36, hs = [10, 14, 18, 22, 26, 30];
  const pos: number[] = [], nrm: number[] = [], rows: number[][] = [];
  for (const h of hs) {
    const row: number[] = [], r = h * Math.tan(a), ca = Math.cos(a), sa = Math.sin(a);
    for (let i = 0; i < na; i++) {
      const t = (2 * Math.PI * i) / na;
      row.push(pos.length / 3);
      pos.push(r * Math.cos(t), r * Math.sin(t), h);
      nrm.push(ca * Math.cos(t), ca * Math.sin(t), -sa);
    }
    rows.push(row);
  }
  pos.push(0, 0, 80); nrm.push(0, 0, 1); // off the cone, must not stretch the frustum
  const tm = 20;
  const fit: FitResult = {
    type: 'Kegel', center: [0, 0, tm], normal: [0, 0, 1], apex: [0, 0, 0], halfAngle: a,
    radius: tm * Math.tan(a), length: 4, rms: 0, form: 0, maxPos: 0, maxNeg: 0, n: na,
  };
  return { pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), mid: Uint32Array.from(rows[3]), fit, nCone: hs.length * na };
}

describe('full fitted cone and sphere', () => {
  const M = frustum();
  it('cone surface span is the mesh frustum, not the selected ring and not the apex', () => {
    const pts = analyticShell(M.fit, M.pos, M.mid);
    const surf = analyticShell(M.fit, M.pos, M.mid, 72, { span: 'surface' });
    expect(pts.t1 - pts.t0).toBeLessThan(1);
    expect(surf.t1 - surf.t0).toBeGreaterThan(18);
    expect(surf.t1 - surf.t0).toBeLessThan(22);
    expect(surf.closed).toBe(true);
    expect(surf.t0).toBeGreaterThan(-12); // centre at z=20; apex (t=-20) is not in the mesh
    expect(surf.t1).toBeLessThan(12);
    const ax = surfaceAxial(M.fit, M.pos)!;
    expect(ax[1] - ax[0]).toBeGreaterThan(18);
    expect(ax[0]).toBeGreaterThan(-12);
  });
  it('cone extract from the middle ring collects the frustum; a cylinder does not grow past its points', () => {
    const grown = buildRegion(M.fit, M.pos, M.mid, { ...base, fullGeom: true });
    expect(grown.kind).toBe('shell');
    if (grown.kind === 'shell') {
      expect(grown.t1 - grown.t0).toBeGreaterThan(18);
      expect(inRegion(grown, [0, 0, 80])).toBe(false);
      expect(inRegion(grown, [14 * Math.tan(M.fit.halfAngle!), 0, 14])).toBe(true);
    }
    const r = reextract(M.fit, M.pos, M.nrm, M.mid, { ...base, fullGeom: true });
    expect(r.indices.length).toBeGreaterThan(M.nCone * 0.9);
    expect([...r.indices].includes(M.nCone)).toBe(false); // the stray vertex
    const cyl: FitResult = { ...M.fit, type: 'Zylinder', radius: M.fit.radius };
    const cR = buildRegion(cyl, M.pos, M.mid, { ...base, fullGeom: true });
    expect(cR.kind).toBe('shell');
    if (cR.kind === 'shell') expect(cR.t1 - cR.t0).toBeLessThan(1);
  });
  it('sphere region and display are the complete sphere, not the selected cap', () => {
    const fit: FitResult = { type: 'Kugel', center: [0, 0, 0], normal: [0, 0, 1], radius: 10, rms: 0, form: 0, maxPos: 0, maxNeg: 0, n: 3 };
    const pos = Float32Array.from([10, 0, 0, 0, 10, 0, 0, 0, 10, 0, 0, -10, -10, 0, 0]);
    const cap = Uint32Array.from([0, 1, 2]);
    const R = buildRegion(fit, pos, cap, base);
    expect(R.kind).toBe('sphere');
    expect(inRegion(R, [0, 0, -10])).toBe(true);
    expect(inRegion(R, [0, 0, -9.5])).toBe(false);
    const s = analyticSphere(fit);
    let z0 = Infinity, z1 = -Infinity;
    for (let i = 2; i < s.tri.length; i += 3) { z0 = Math.min(z0, s.tri[i]); z1 = Math.max(z1, s.tri[i]); }
    expect(z0).toBeLessThan(-9);
    expect(z1).toBeGreaterThan(9);
    const rx = reextract(fit, pos, null, cap, base);
    expect(rx.indices.length).toBe(5);
  });
});
