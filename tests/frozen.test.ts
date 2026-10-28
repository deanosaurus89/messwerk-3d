import { describe, expect, it } from 'vitest';
import { freezeBoundary, frozenCells, sealedFans } from '../src/core/frozen';
import { reextract } from '../src/core/reextract';
// 0.33 (Martin 15:49): frozen boundary – a plane whose gap was closed by an added region keeps no gap on re-extraction,
// and repeated re-extractions are stable (zone never derived from the shrinking current points again)
describe('frozen boundary of planes', () => {
  const N = 41, pos: number[] = [], nrm: number[] = [], tris: number[] = []; let s = 3; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { pos.push(i * 0.5, j * 0.5, 0.004 * rnd()); nrm.push(0, 0, 1); }
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = j * N + i; tris.push(a, a + 1, a + N + 1, a, a + N + 1, a + N); }
  const all = (pred: (i: number, j: number) => boolean) => { const r: number[] = []; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (pred(i, j)) r.push(j * N + i); return Uint32Array.from(r); };
  const first = all((i) => i < 15 || i > 25);              // first selection: a 5 mm gap in the middle
  const union = all(() => true);                            // + added region closes the gap
  const fit: any = { type: 'Ebene', center: [10, 10, 0], normal: [0, 0, 1], rms: 0, form: 0 };
  const F = freezeBoundary(fit, pos, tris, union)!;
  it('freezes one outer loop for the union (no inner loop at the closed gap)', () => {
    expect(F.loops.length).toBe(1);
    const F1 = freezeBoundary(fit, pos, tris, first)!; expect(F1.loops.length).toBe(2); // two separate strips
  });
  it('re-extraction inside the frozen boundary: no gap, stable over repeats', () => {
    // the current points are only the first selection (e.g. a refit lost the added region) – the frozen zone still holds
    let cur: Uint32Array = first; const counts: number[] = [];
    for (let k = 0; k < 3; k++) { const r = reextract(fit, pos, nrm, cur, { maxDist: 0.1, sigma: 3, maxAngleDeg: 30, margin: 0, frozen: F }, [], tris); counts.push(r.indices.length); cur = r.indices; }
    const mid = 20 * N + 20; expect(counts[0]).toBeGreaterThan(N * N * 0.97);
    expect(new Set(counts).size).toBe(1);
    const r = reextract(fit, pos, nrm, cur, { maxDist: 0.1, sigma: 3, maxAngleDeg: 30, margin: 0, frozen: F }, [], tris); expect([...r.indices].includes(mid)).toBe(true);
  });
  it('exclusion distance offsets the frozen boundary (outer and masked interior areas) – once, not per run', () => {
    const holed = all((i, j) => !(i >= 18 && i <= 22 && j >= 18 && j <= 22)); const Fh = freezeBoundary(fit, pos, tris, holed)!;
    expect(Fh.loops.length).toBe(2);
    const g0 = frozenCells(Fh, 0), g1 = frozenCells(Fh, -1); const c = (g: any) => g.cells.reduce((a: number, b: number) => a + b, 0);
    expect(c(g1)).toBeLessThan(c(g0));
    let cur: Uint32Array = holed; const counts: number[] = [];
    for (let k = 0; k < 3; k++) { const r = reextract(fit, pos, nrm, cur, { maxDist: 0.1, sigma: 3, maxAngleDeg: 30, margin: 0, inset: 1, frozen: Fh }, [], tris); counts.push(r.indices.length); cur = r.indices; }
    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toBeLessThan(holed.length * 0.85); // ≈ 1 mm off the outer edge and around the masked hole
  });
  it('a sealed opening closes the frozen domain; the fit points stay out, a later extract can use the opening', () => {
    const holed = all((i, j) => !(i >= 18 && i <= 22 && j >= 18 && j <= 22));
    const open = freezeBoundary(fit, pos, tris, holed)!;
    const shut = freezeBoundary(fit, pos, tris, holed, [{ c: [10, 10, 0], r: 2 }])!;
    expect(open.loops.length).toBe(2);
    expect(shut.loops.length).toBe(1);
    expect(shut.sealed?.length).toBe(1);
    const mid = 20 * N + 20;
    const inside = (F: NonNullable<typeof shut>, p: number[]) => {
      const x = (p[0] - F.o[0]) * F.u[0] + (p[1] - F.o[1]) * F.u[1] + (p[2] - F.o[2]) * F.u[2];
      const y = (p[0] - F.o[0]) * F.v[0] + (p[1] - F.o[1]) * F.v[1] + (p[2] - F.o[2]) * F.v[2];
      let w = false;
      for (const l of F.loops) for (let i = 0; i < l.length; i += 2) {
        const j = (i + 2) % l.length, ay = l[i + 1], by = l[j + 1];
        if ((ay > y) !== (by > y) && x < l[i] + ((y - ay) / (by - ay)) * (l[j] - l[i])) w = !w;
      }
      return w;
    };
    expect(inside(open, [10, 10, 0])).toBe(false);
    expect(inside(shut, [10, 10, 0])).toBe(true);
    const cap = sealedFans(pos, tris, holed, shut);
    expect(cap.length).toBeGreaterThan(9);
    let hit = false;
    for (let i = 0; i < cap.length; i += 9) {
      const ax = cap[i], ay = cap[i + 1], bx = cap[i + 3], by = cap[i + 4], cx = cap[i + 6], cy = cap[i + 7];
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(d) < 1e-9) continue;
      const l1 = ((by - cy) * (10 - cx) + (cx - bx) * (10 - cy)) / d, l2 = ((cy - ay) * (10 - cx) + (ax - cx) * (10 - cy)) / d;
      if (l1 >= -1e-6 && l2 >= -1e-6 && l1 + l2 <= 1 + 1e-6) hit = true;
    }
    expect(hit).toBe(true);
    const locked = reextract(fit, pos, nrm, holed, { maxDist: 0.1, sigma: 3, sigmaOn: false, maxAngleDeg: 30, margin: 0, frozen: shut, frozenIdx: holed }, [], tris);
    expect([...locked.indices].includes(mid)).toBe(false);
    const later = reextract(fit, pos, nrm, holed, { maxDist: 0.1, sigma: 3, sigmaOn: false, maxAngleDeg: 30, margin: 1, frozen: shut }, [], tris);
    expect([...later.indices].includes(mid)).toBe(true);
  });
});
