import { describe, expect, it } from 'vitest';
import { fillOuterBoundary, insetPlane } from '../src/core/fillplane';
import type { FitResult } from '../src/core/fit';

// CAD-like coarse mesh: 50×50 plate top face of 10×10 quads (5 mm triangles → sparse vertices) with a Ø10-ish square
// opening in the middle cell block. Without triangle coverage the empty cells between vertices looked like openings
// and the boundary exclusion distance removed (almost) everything.
function coarse() {
  const S = 5, n = 10, pos: number[] = [], nrm: number[] = [], tris: number[] = [], id = (i: number, j: number) => j * (n + 1) + i;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { pos.push(i * S, j * S, 0); nrm.push(0, 0, 1); }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { if ((i === 4 || i === 5) && (j === 4 || j === 5)) continue; // opening 10×10 at the centre
    tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1)); }
  const used = new Set(tris); const idx = Uint32Array.from([...used].sort((a, b) => a - b));
  const fit = { type: 'Ebene', center: [25, 25, 0], normal: [0, 0, 1], rms: 0.001, form: 0 } as unknown as FitResult;
  return { pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), tris: Uint32Array.from(tris), idx, fit };
}
describe('boundary exclusion distance on a coarse mesh (triangle coverage)', () => {
  it('insetPlane keeps the interior vertices and drops only those near the outer edge / opening', () => {
    const m = coarse(); const out = insetPlane(m.pos, m.idx, m.fit, 1, m.tris);
    const xy = [...out].map((i) => [m.pos[3 * i], m.pos[3 * i + 1]]);
    expect(xy.every(([x, y]) => x > 0.5 && x < 49.5 && y > 0.5 && y < 49.5)).toBe(true);           // outer row dropped
    expect(xy.some(([x, y]) => x === 15 && y === 15)).toBe(true);                                  // interior kept
    expect(xy.some(([x, y]) => (x === 20 || x === 30) && y >= 20 && y <= 30)).toBe(false);         // opening rim dropped
    expect(out.length).toBeGreaterThan(40);
  });
  it('fillOuterBoundary with inset keeps the interior (not everything excluded)', () => {
    const m = coarse(); const r = fillOuterBoundary(m.pos, m.nrm, m.idx, m.fit, { band: 0.1, excludeRaised: false, islands: true, inset: 1 }, m.tris);
    expect(r.indices.length).toBeGreaterThan(40);
    const xy = [...r.indices].map((i) => [m.pos[3 * i], m.pos[3 * i + 1]]);
    expect(xy.every(([x, y]) => x > 0.5 && x < 49.5 && y > 0.5 && y < 49.5)).toBe(true);
  });
});
