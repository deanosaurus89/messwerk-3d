import { samplePath } from './samplePath';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSTL } from '../src/core/io';
import { MeshTopology, gather } from '../src/core/region';
import { fitType } from '../src/core/fit';
import { fillOuterBoundary } from '../src/core/fillplane';
import { freezeBoundary } from '../src/core/frozen';
import { selectionLoops } from '../src/core/boundary';
import { reextract } from '../src/core/reextract';
import type { Vec3 } from '../src/core/linalg';
// 0.35 (Martin 19.10. 18:32): re-extraction with the frozen boundary of the demo top plane must give EXACTLY the
// creation point set at exclusion distance 0, and a strict subset ≥ the exclusion distance inside the boundary at > 0.
// Cause of the former +1.3 %: the frozen loops are projected 3D selection edges – at the rounded rim they zigzag,
// overlap and form sliver hole loops; a pure position test took rim/fillet vertices and lost selected ones.
const buf = readFileSync(samplePath('beispielteil.stl'));
const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'beispielteil');
const topo = new MeshTopology(mesh); const pos = mesh.positions, nrm = mesh.vertexNormals ?? null, tris = mesh.indices;
function seedTri(pt: Vec3) { let best = -1, bd = Infinity; const f = tris, p = pos, fn = mesh.faceNormals!;
  for (let t = 0; t < f.length / 3; t++) { if (fn[3 * t + 2] < 0.9) continue; let d = 0; 
    const c = [0, 1, 2].map((a) => (p[3 * f[3 * t] + a] + p[3 * f[3 * t + 1] + a] + p[3 * f[3 * t + 2] + a]) / 3); d = (c[0] - pt[0]) ** 2 + (c[1] - pt[1]) ** 2 + (c[2] - pt[2]) ** 2; if (d < bd) { bd = d; best = t; } }
  return best; }
describe('frozen point set on the demo top plane', () => {
  const grown = topo.regionVertices(topo.growRegion(seedTri([70, 52, 20]), [70, 52, 20], { maxAngleDeg: 20, radius: 0 })).all;
  const g = gather(mesh, grown); const fit0 = { ...fitType('Ebene', g.p, g.n), type: 'Ebene' as const };
  const fr = fillOuterBoundary(pos, nrm, grown, fit0, { band: 0.1, maxWallDeg: 75, closeMm: 2, excludeRaised: false, islands: true, inset: 0 }, tris);
  const created = Uint32Array.from(fr.indices).sort();
  const cg = gather(mesh, created); const fit = { ...fitType('Ebene', cg.p, cg.n), type: 'Ebene' as const };
  const F = freezeBoundary(fit, pos, tris, created)!; F.band = 0.1;
  const P = { maxDist: 0.1, sigma: 3, sigmaOn: false, maxAngleDeg: 30, angleOn: false, margin: 0, frozen: F } as any;
  // 0.36 (Martin 19.10. 20:15): robust neighbourhood normals + closing + isotropic demo mesh -> no sliver loops.
  // Before (0.35, CAD-tessellated needle mesh): 352 frozen loops (339 slivers < 1 mm²), 1913 unselected points > 1 mm from a real edge.
  const rawLoops = selectionLoops(tris, created, pos.length / 3);
  const cadEdge = (x: number, y: number) => { const r = (cx: number, cy: number) => Math.hypot(x - cx, y - cy);
    return Math.min(x, 100 - x, y, 60 - y, Math.abs(r(20, 20) - 6.04), Math.abs(r(85, 10) - 3), Math.abs(r(55.05, 30) - 8), Math.abs(r(82, 38) - 10), Math.abs(r(60, 8) - Math.sqrt(40)),
      Math.abs(r(40, 10) - 4.167), Math.abs(r(40, 10) - 7.833), Math.abs(Math.hypot(x - Math.min(30, Math.max(10, x)), y - 45) - 5)); };
  const onFace = (x: number, y: number) => { const r = (cx: number, cy: number) => Math.hypot(x - cx, y - cy);
    return x > 0 && x < 100 && y > 0 && y < 60 && r(20, 20) > 6.04 && r(85, 10) > 3 && r(55.05, 30) > 8 && r(82, 38) > 10 && r(60, 8) > Math.sqrt(40) && r(40, 10) > 7.833 && Math.hypot(x - Math.min(30, Math.max(10, x)), y - 45) > 5; };
  it('creation set is the filled top plane; few loops (outer + real islands), no slivers', () => {
    expect(created.length).toBeGreaterThan(18000);
    console.log('[0.36] created', created.length, 'raw loops', rawLoops.length, 'frozen loops', F.loops.length);
    expect(rawLoops.length).toBeLessThanOrEqual(12); expect(F.loops.length).toBeLessThanOrEqual(12);
    for (const l of F.loops) { let a = 0, per = 0; for (let i = 0; i < l.length; i += 2) { const j = (i + 2) % l.length; a += l[i] * l[j + 1] - l[j] * l[i + 1]; per += Math.hypot(l[j] - l[i], l[j + 1] - l[i + 1]); }
      expect(Math.abs(a) / 2).toBeGreaterThan(1); expect(Math.abs(a) / per).toBeGreaterThan(0.25); }
  });
  it('no unselected points in the middle of the plane (> 1 mm from any real edge)', () => {
    const s = new Set(created); let n = 0, tot = 0;
    for (let v = 0; v < pos.length / 3; v++) { const x = pos[3 * v], y = pos[3 * v + 1], z = pos[3 * v + 2];
      if (Math.abs(z - 20) > 0.05 || !onFace(x, y) || cadEdge(x, y) <= 1) continue; tot++; if (!s.has(v)) n++; }
    console.log('[0.36] mid-plane points', tot, 'unselected', n);
    expect(tot).toBeGreaterThan(15000); expect(n).toBeLessThanOrEqual(5);
  });
  it('exclusion 0: re-extraction returns exactly the creation set – repeatedly', () => {
    let cur: Uint32Array = created;
    for (let k = 0; k < 2; k++) { const r = reextract(fit, pos, nrm, cur, { ...P, frozenIdx: created }, [], tris); expect(r.indices.length).toBe(created.length); expect(r.indices.every((v, i) => v === created[i])).toBe(true); cur = r.indices; }
  });
  it('beispielteil top plane: exclusion 0 keeps the creation set when the search distance is tighter than the creation band', () => {
    const r = reextract(fit, pos, nrm, created, { ...P, maxDist: 1e-4, frozenIdx: created }, [], tris);
    expect(r.indices.length).toBe(created.length);
    expect(r.indices.every((v, i) => v === created[i])).toBe(true);
  });
  it('polygon only (without the frozen point set) now nearly matches too (0.35: +1.3 %)', () => {
    const r = reextract(fit, pos, nrm, created, P, [], tris); const s = new Set(created); const extra = Array.from(r.indices).filter((v) => !s.has(v)).length;
    console.log('[0.36] polygon-only reex', r.indices.length, 'extra', extra, 'of', created.length);
    expect(Math.abs(r.indices.length - created.length) / created.length).toBeLessThan(0.005);
  });
  it('exclusion 1 mm: strict subset, every point ≥ 1 mm inside the frozen boundary', () => {
    const r = reextract(fit, pos, nrm, created, { ...P, inset: 1, frozenIdx: created }, [], tris); const s = new Set(created);
    expect(r.indices.length).toBeLessThan(created.length); expect(Array.from(r.indices).every((v) => s.has(v))).toBe(true);
    const segs: number[] = []; for (const l of F.loops) for (let i = 0; i < l.length; i += 2) { const j = (i + 2) % l.length; segs.push(l[i], l[i + 1], l[j], l[j + 1]); }
    let minD = Infinity; for (let k = 0; k < r.indices.length; k += 25) { const v = r.indices[k], w = [0, 1, 2].map((a) => pos[3 * v + a] - F.o[a]);
      const x = w[0] * F.u[0] + w[1] * F.u[1] + w[2] * F.u[2], y = w[0] * F.v[0] + w[1] * F.v[1] + w[2] * F.v[2];
      for (let s2 = 0; s2 < segs.length; s2 += 4) { const ax = segs[s2], ay = segs[s2 + 1], bx = segs[s2 + 2] - ax, by = segs[s2 + 3] - ay, L = bx * bx + by * by; const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by) / L)) : 0; minD = Math.min(minD, Math.hypot(x - ax - t * bx, y - ay - t * by)); } }
    expect(minD).toBeGreaterThanOrEqual(1 - 1e-9);
  });
});
