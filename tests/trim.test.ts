import { describe, expect, it } from 'vitest';
import { projectOnto, trimmedSurface } from '../src/core/trim';
describe('trimmed geometry', () => {
  it('projects onto plane/cylinder', () => {
    expect(projectOnto({ type: 'Ebene', center: [0, 0, 0], normal: [0, 0, 1] } as any, [1, 2, 3])).toEqual([1, 2, 0]);
    const q = projectOnto({ type: 'Zylinder', center: [0, 0, 0], normal: [0, 0, 1], radius: 2 } as any, [4, 0, 5]); expect(q[0]).toBeCloseTo(2); expect(q[2]).toBeCloseTo(5);
  });
  it('square of 2 triangles → 4 boundary edges, diagonal is interior', () => {
    const pos = [0, 0, 0.1, 1, 0, -0.1, 1, 1, 0.1, 0, 1, 0, 5, 5, 5], tris = [0, 1, 2, 0, 2, 3, 2, 3, 4];
    const r = trimmedSurface({ type: 'Ebene', center: [0, 0, 0], normal: [0, 0, 1] } as any, pos, tris, Uint32Array.from([0, 1, 2, 3]));
    expect(r.tri.length).toBe(18); expect(r.edges.length).toBe(4 * 6); for (let i = 2; i < r.tri.length; i += 3) expect(r.tri[i]).toBeCloseTo(0);
  });
});

import { trimmedCurve } from '../src/core/trim';
describe('trimmed curves and torus', () => {
  const C: any = { type: 'Kreis', center: [0, 0, 0], normal: [0, 0, 1], radius: 2 };
  const arc = (a0: number, a1: number) => Array.from({ length: 50 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / 49; return [2 * Math.cos(a), 2 * Math.sin(a), 0.3] as any; });
  it('full circle → null, half circle → arc of ≈ π·r', () => {
    expect(trimmedCurve(C, arc(0, 2 * Math.PI * 0.99))).toBeNull();
    const s = trimmedCurve(C, arc(-Math.PI / 2, Math.PI / 2))!; let L = 0; for (let i = 0; i < s.length; i += 6) L += Math.hypot(s[i + 3] - s[i], s[i + 4] - s[i + 1], s[i + 5] - s[i + 2]);
    expect(L).toBeCloseTo(Math.PI * 2, 1); for (let i = 0; i < s.length; i += 3) expect(s[i]).toBeGreaterThan(-1e-6); // right half only
  });
  it('slot: one end arc only; line: covered segment', () => {
    const S: any = { type: 'Langloch', center: [0, 0, 0], normal: [0, 0, 1], direction: [1, 0, 0], radius: 1, length: 6 };
    const pts = Array.from({ length: 30 }, (_, i) => { const a = -Math.PI / 2 + (Math.PI * i) / 29; return [2 + Math.cos(a), Math.sin(a), 0] as any; });
    const s = trimmedCurve(S, pts)!; for (let i = 0; i < s.length; i += 3) expect(s[i]).toBeGreaterThan(2 - 1e-6);
    const L: any = { type: 'Linie', center: [0, 0, 0], normal: [0, 0, 1], direction: [1, 0, 0], length: 20 };
    expect(Array.from(trimmedCurve(L, [[-1, 0, 0], [3, 0, 0], [1, 0, 0]] as any)!)).toEqual([-1, 0, 0, 3, 0, 0]);
  });
  it('torus projection lands on the tube', () => {
    const T: any = { type: 'Torus', center: [0, 0, 0], normal: [0, 0, 1], radius: 10, minorRadius: 2 };
    const q = projectOnto(T, [13, 0, 1]); expect(Math.hypot(q[0] - 10, q[2])).toBeCloseTo(2, 9);
  });
});
