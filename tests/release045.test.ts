// 2026.0.45: triangle-edge boundary (no Taubin outline) and a dismissed island closes the surface.
import { describe, expect, it } from 'vitest';
import { dropSealedLoops, openingFans, rawLoops, selectionHoles, smoothedBoundary } from '../src/core/boundary';
import type { FitResult } from '../src/core/fit';

function grid(n: number, hole: (i: number, j: number) => boolean) {
  const pos: number[] = [], tris: number[] = [], verts: number[] = [];
  const id = (i: number, j: number) => j * n + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    pos.push(i, j, 0);
    if (!hole(i, j)) verts.push(id(i, j));
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
    if (hole(i, j) || hole(i + 1, j) || hole(i, j + 1) || hole(i + 1, j + 1)) continue;
    tris.push(a, b, c, a, c, d);
  }
  return { pos: Float32Array.from(pos), tris: Uint32Array.from(tris), verts: Uint32Array.from(verts) };
}

describe('2026.0.45 selection boundary', () => {
  const g = grid(11, (i, j) => i >= 4 && i <= 6 && j >= 4 && j <= 6);
  const fit: FitResult = { type: 'Ebene', center: [5, 5, 0], normal: [0, 0, 1], rms: 0, form: 0, maxPos: 0, maxNeg: 0, n: g.verts.length };

  it('draws the mesh vertices themselves, not a Taubin-smoothed outline', () => {
    const raw = rawLoops(g.pos, g.tris, g.verts);
    expect(raw.length).toBeGreaterThanOrEqual(2);
    const onMesh = raw.every((L) => L.every((p) => {
      for (let i = 0; i < g.pos.length; i += 3) if (g.pos[i] === p[0] && g.pos[i + 1] === p[1] && g.pos[i + 2] === p[2]) return true;
      return false;
    }));
    expect(onMesh).toBe(true);
    const smooth = smoothedBoundary(fit, g.pos, g.tris, g.verts, 0.5);
    const onVertex = (p: number[]) => {
      for (let i = 0; i < g.pos.length; i += 3) if (g.pos[i] === p[0] && g.pos[i + 1] === p[1] && g.pos[i + 2] === p[2]) return true;
      return false;
    };
    expect(smooth.some((L) => L.some((p) => !onVertex(p)))).toBe(true);
  });

  it('a dismissed island closes the opening in the geometry and drops its edge loop', () => {
    const holes = selectionHoles(g.pos, g.tris, g.verts);
    expect(holes.length).toBe(1);
    expect(holes[0].c[0]).toBeGreaterThan(3);
    expect(holes[0].c[0]).toBeLessThan(7);
    const loops = rawLoops(g.pos, g.tris, g.verts);
    const open = dropSealedLoops(loops, []);
    const shut = dropSealedLoops(loops, [{ c: holes[0].c, r: holes[0].r }]);
    expect(shut.length).toBe(open.length - 1);
    const cap = openingFans(fit, loops, [{ c: holes[0].c, r: holes[0].r }]);
    expect(cap.length).toBeGreaterThan(9);
    const cx = holes[0].c[0], cy = holes[0].c[1];
    let hit = false;
    for (let i = 0; i < cap.length; i += 9) {
      const ax = cap[i], ay = cap[i + 1], bx = cap[i + 3], by = cap[i + 4], qx = cap[i + 6], qy = cap[i + 7];
      const d = (by - qy) * (ax - qx) + (qx - bx) * (ay - qy);
      if (Math.abs(d) < 1e-9) continue;
      const l1 = ((by - qy) * (cx - qx) + (qx - bx) * (cy - qy)) / d;
      const l2 = ((qy - ay) * (cx - qx) + (ax - qx) * (cy - qy)) / d;
      if (l1 >= -1e-6 && l2 >= -1e-6 && l1 + l2 <= 1 + 1e-6) hit = true;
    }
    expect(hit).toBe(true);
  });

  it('projects a cylinder opening onto the fitted wall', () => {
    const cyl: FitResult = { type: 'Zylinder', center: [0, 0, 0], normal: [0, 0, 1], radius: 10, rms: 0, form: 0, maxPos: 0, maxNeg: 0, n: 8 };
    const hole = [[10, 0, 0], [10, 1, 0], [9, 1, 0], [9, 0, 0], [9, -1, 0], [10, -1, 0]] as [number, number, number][];
    const outer = [[-30, -30, 0], [30, -30, 0], [30, 30, 0], [-30, 30, 0], [-30, 0, 0], [0, -30, 0]] as [number, number, number][];
    const cap = openingFans(cyl, [outer, hole], [{ c: [9.5, 0, 0], r: 2 }]);
    expect(cap.length).toBeGreaterThan(0);
    // fan centre is the hole centre projected onto the cylinder (radius 10)
    const r = Math.hypot(cap[0], cap[1]);
    expect(r).toBeCloseTo(10, 5);
  });
});
