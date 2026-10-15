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
