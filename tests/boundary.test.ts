// Phase 1 step 4: smoothed boundary display – no triangle zigzag, stays within the tolerance, on the fitted surface.
import { describe, expect, it } from 'vitest';
import { selectionLoops, smoothedBoundary, turning, autoTol, medianEdge } from '../src/core/boundary';
import type { FitResult } from '../src/core/fit';

/** jittered grid mesh 40×40 mm (h = 0.5) in z = 0 */
function gridMesh(h = 0.5, n = 80) {
  let s = 3; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
  const pos: number[] = [], tris: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push(i * h + (i && i < n ? 0.2 * h * rnd() : 0), j * h + (j && j < n ? 0.2 * h * rnd() : 0), 0);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1; tris.push(a, b, d, a, d, c); }
  return { pos: Float64Array.from(pos), tris: Uint32Array.from(tris) };
}
const plane = { type: 'Ebene', center: [20, 20, 0], normal: [0, 0, 1] } as unknown as FitResult;

describe('Smoothed boundary display', () => {
  const { pos, tris } = gridMesh();
  // selection: annulus 6 < r < 14 around (20, 20) → outer + inner loop
  const sel: number[] = []; for (let v = 0; v < pos.length / 3; v++) { const r = Math.hypot(pos[3 * v] - 20, pos[3 * v + 1] - 20); if (r < 14 && r > 6) sel.push(v); }
  it('chains the triangle boundary into closed loops (outer + hole)', () => {
    const L = selectionLoops(tris, sel, pos.length / 3); expect(L.length).toBe(2);
  });
  const raw = smoothedBoundary(plane, pos, tris, sel, 0), sm = smoothedBoundary(plane, pos, tris, sel, null);
  it('raw boundary zigzags, smoothed boundary turns ≈ 2π per loop', () => {
    for (let k = 0; k < 2; k++) { expect(turning(raw[k])).toBeGreaterThan(4 * Math.PI); expect(turning(sm[k])).toBeLessThan(1.6 * 2 * Math.PI); }
  });
  it('every point moves at most the tolerance (auto = 0.7 × edge, ≤ 0.5 mm) and stays in the plane', () => {
    for (let k = 0; k < 2; k++) { const t = autoTol(raw[k]); expect(t).toBeLessThanOrEqual(0.5); expect(t).toBeCloseTo(Math.min(0.5, 0.7 * medianEdge(raw[k])), 9);
      raw[k].forEach((p, i) => { expect(Math.hypot(p[0] - sm[k][i][0], p[1] - sm[k][i][1])).toBeLessThanOrEqual(t + 1e-9); expect(Math.abs(sm[k][i][2])).toBeLessThan(1e-9); }); }
  });
  it('smoothed loop is closer to the true circle than the zigzag', () => {
    const dev = (L: number[][], R: number) => Math.sqrt(L.reduce((s, p) => s + (Math.hypot(p[0] - 20, p[1] - 20) - R) ** 2, 0) / L.length);
    const outer = (L: number[][][]) => L.reduce((a, b) => (dev(a, 14) < dev(b, 14) ? a : b));
    expect(dev(outer(sm), 14)).toBeLessThan(dev(outer(raw), 14));
  });
  it('on a cylinder the smoothed boundary stays on the fitted surface', () => {
    // cylinder R5 along z as a grid in (angle, z)
    const pos2: number[] = [], tr: number[] = [], na = 64, nz = 40;
    for (let j = 0; j <= nz; j++) for (let i = 0; i < na; i++) { const a = (2 * Math.PI * i) / na; pos2.push(5 * Math.cos(a), 5 * Math.sin(a), j * 0.5); }
    for (let j = 0; j < nz; j++) for (let i = 0; i < na; i++) { const a = j * na + i, b = j * na + ((i + 1) % na), c = a + na, d = b + na; tr.push(a, b, d, a, d, c); }
    const sel2: number[] = []; for (let v = 0; v < pos2.length / 3; v++) { const z = pos2[3 * v + 2], x = pos2[3 * v]; if (z > 3 + 0.4 * x * 0.5 && z < 15) sel2.push(v); }
    const cyl = { type: 'Zylinder', center: [0, 0, 0], normal: [0, 0, 1], radius: 5 } as unknown as FitResult;
    const L = smoothedBoundary(cyl, Float64Array.from(pos2), Uint32Array.from(tr), sel2, 0.3);
    expect(L.length).toBe(2); for (const lp of L) for (const p of lp) expect(Math.abs(Math.hypot(p[0], p[1]) - 5)).toBeLessThan(1e-9);
  });
});
