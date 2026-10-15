// @vitest-environment node
// CAD trimming end-to-end on the public CAD sample (public/samples/cad-sample.igs.gz): cut line, closed polygon,
// islands, boundary offset, then STEP/IGES export + re-import (validity, area, face count).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { gunzipSync } from 'fflate';
import * as C from '../src/cad/occcore';
let oc: any, orig: any[] = [], F: any, q: number[] = [], n: number[] = [], s = 0, A0 = 0;
const log = (t: string) => { fs.appendFileSync('/tmp/cad-sample.txt', t + '\n'); };
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]), cr = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nz = (a: number[]) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
const at = (u: number, v: number, U: number[], V: number[]) => q.map((x, i) => x + u * U[i] + v * V[i]) as [number, number, number];
beforeAll(async () => {
  oc = await (await import('opencascade.js/dist/node.js' as any)).default();
  const sh = C.readCAD(oc, gunzipSync(new Uint8Array(fs.readFileSync('public/samples/cad-sample.igs.gz'))), 'cad-sample.igs'); orig = C.faces(oc, sh);
  // largest face; probe point = centre of its largest triangle, normal of that triangle
  let best = 0; orig.forEach((f, i) => { const a = C.area(oc, f); if (a > A0) { A0 = a; best = i; } }); F = orig[best];
  const t = C.tessellate(oc, F, Math.max(0.05, C.bboxDiag(oc, F) / 200)); let ba = -1;
  for (let i = 0; i < t.indices.length; i += 3) { const p = [0, 1, 2].map((k) => Array.from(t.positions.slice(3 * t.indices[i + k], 3 * t.indices[i + k] + 3))); const c = cr(sub(p[1], p[0]), sub(p[2], p[0])), a = Math.hypot(...c);
    if (a > ba) { ba = a; n = nz(c); q = [0, 1, 2].map((j) => (p[0][j] + p[1][j] + p[2][j]) / 3); } }
  s = Math.sqrt(A0) * 0.08; log(`sample: ${orig.length} faces, largest #${best} area ${A0.toFixed(1)} mm², probe ${q.map((x) => x.toFixed(2))}`);
}, 300000);
describe('CAD sample trimming', () => {
  const basis = () => { const U = nz(cr(n, Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])); return { U, V: cr(n, U), D: n.map((x) => -x) as [number, number, number] }; };
  it('loads as a valid surface model', () => { expect(orig.length).toBeGreaterThan(100); expect(C.isValid(oc, F)).toBe(true); });
  it('closed polygon (first point repeated) removes the inside ≈ s²', () => {
    const { U, V, D } = basis(); const sq = [at(-s, -s, U, V), at(s, -s, U, V), at(s, s, U, V), at(-s, s, U, V)]; sq.push([...sq[0]] as any);
    const r = C.cutByLine(oc, F, sq as any, D, q as any), a = C.area(oc, r); log(`polygon: ${A0.toFixed(1)} → ${a.toFixed(1)} (square ${(4 * s * s).toFixed(1)})`);
    expect(C.isValid(oc, r)).toBe(true); expect(A0 - a).toBeGreaterThan(4 * s * s * 0.85); expect(A0 - a).toBeLessThan(4 * s * s * 1.3);
    // keep the inside instead: click outside the polygon
    const r2 = C.cutByLine(oc, F, sq as any, D, at(3 * s, 0, U, V)), a2 = C.area(oc, r2); log(`polygon keep inside: ${a2.toFixed(1)}`);
    expect(a2).toBeGreaterThan(4 * s * s * 0.85); expect(a2).toBeLessThan(4 * s * s * 1.3);
  }, 300000);
  it('open cut line: both sides add up to the face', () => {
    const { U, V, D } = basis(); const L = [at(0, -s, U, V), at(0, s, U, V)];
    const a = C.area(oc, C.cutByLine(oc, F, L, D, at(-s, 0, U, V))), b = C.area(oc, C.cutByLine(oc, F, L, D, at(s, 0, U, V))); log(`line: ${a.toFixed(1)} + ${b.toFixed(1)} vs ${A0.toFixed(1)}`);
    expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(0); expect(Math.abs(a + b - A0) / A0).toBeLessThan(0.01);
  }, 300000);
  it('islands circle/rect', () => {
    const { U, V, D } = basis();
    const c = C.area(oc, C.cutIsland(oc, F, 'circle', [at(0, 0, U, V), at(s, 0, U, V)], D)); const r = C.area(oc, C.cutIsland(oc, F, 'rect', [at(-s, -s, U, V), at(s, s, U, V)], D, V as any));
    log(`islands: circle −${(A0 - c).toFixed(1)} (πs² ${(Math.PI * s * s).toFixed(1)}), rect −${(A0 - r).toFixed(1)} (${(4 * s * s).toFixed(1)})`);
    expect((A0 - c) / (Math.PI * s * s)).toBeGreaterThan(0.85); expect((A0 - c) / (Math.PI * s * s)).toBeLessThan(1.3);
    expect((A0 - r) / (4 * s * s)).toBeGreaterThan(0.85); expect((A0 - r) / (4 * s * s)).toBeLessThan(1.3);
  }, 300000);
  it('boundary offset shrinks the face and stays valid', () => {
    const r = C.offsetBoundary(oc, F, 0.5), a = C.area(oc, r), P = C.perimeter(oc, F); log(`offset 0.5: ${A0.toFixed(1)} → ${a.toFixed(1)} (≈ −${(0.5 * P).toFixed(1)})`);
    expect(C.isValid(oc, r)).toBe(true); expect(A0 - a).toBeGreaterThan(0.5 * P * 0.7); expect(A0 - a).toBeLessThan(0.5 * P * 1.3);
  }, 300000);
  it('trim several faces, export STEP + IGES, re-import: same face count and area', () => {
    const { U, V, D } = basis(); const sel = [0, 10, 30, 50]; // fast faces (face 20 with ~200 boundary edges alone takes ~90 s)
    const { result, errors } = C.applyOps(oc, orig, [{ kind: 'offset', faces: sel, d: 0.3 } as any, { kind: 'island', faces: [orig.indexOf(F)], shape: 'circle', pts: [at(0, 0, U, V), at(s, 0, U, V)], dir: D } as any]);
    expect(errors.filter(Boolean)).toEqual([]);
    const want = result.reduce((t: number, x: any) => t + C.area(oc, x), 0), nf = result.flatMap((x: any) => C.faces(oc, x)).length;
    for (const fmt of ['step', 'iges'] as const) {
      const back = C.readCAD(oc, C.writeCAD(oc, result, fmt), 'x.' + (fmt === 'step' ? 'stp' : 'igs')); const got = C.area(oc, back), bf = C.faces(oc, back).length;
      log(`export ${fmt}: ${bf}/${nf} faces, area ${got.toFixed(1)} / ${want.toFixed(1)}`);
      expect(bf).toBe(nf); expect(Math.abs(got - want) / want).toBeLessThan(1e-3);
    }
  }, 900000);
});
