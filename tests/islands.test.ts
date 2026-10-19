// Phase 1 step 4 (0.31): plane “All inside boundary” – islands detected at creation (hole vs local bump), excluded by
// default, “not an island” includes one again, “refine” grows/shrinks its excluded zone. Islands demo part.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { samplePath } from './samplePath';
import { parseByName } from '../src/core/io';
import { MeshTopology, gather } from '../src/core/region';
import { autoExtract } from '../src/core/aux';
import { fillOuterBoundary, type FillParams } from '../src/core/fillplane';
import { fitType } from '../src/core/fit';
import type { Vec3 } from '../src/core/linalg';

describe('Islands at creation (inseldemo)', () => {
  const buf = readFileSync(samplePath('inseldemo.stl.gz'));
  const mesh = parseByName('inseldemo.stl.gz', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const topo = new MeshTopology(mesh), P = mesh.positions, F = mesh.indices;
  let seed = -1, bd = Infinity; for (let t = 0; t < F.length / 3; t++) { if (mesh.faceNormals![3 * t + 2] < 0.9) continue; const v = F[3 * t], d = Math.hypot(P[3 * v] - 70, P[3 * v + 1] - 50, P[3 * v + 2] - 10); if (d < bd) { bd = d; seed = t; } }
  const v0 = F[3 * seed], grown = autoExtract(mesh, topo, seed, [P[3 * v0], P[3 * v0 + 1], P[3 * v0 + 2]] as Vec3, { maxAngleDeg: 20, radius: 0 }, 1000);
  const fill = (x: Partial<FillParams>) => fillOuterBoundary(P, mesh.vertexNormals ?? null, grown.indices, grown.fit, { band: 0.1, ...x }, F);
  const form = (ix: Uint32Array) => { const q = gather(mesh, ix); return fitType('Ebene', q.p, q.n, 0).form!; };
  const auto = fill({ isl: [] }), I = auto.islands!;
  const at = (x: number, y: number) => I.find((i) => Math.hypot(i.c[0] - x, i.c[1] - y) < 1.5)!;
  it('grown region = plane', () => { expect(grown.fit.type).toBe('Ebene'); });
  it('detects the holes, the raised rims and the local bumps', () => {
    for (const a of [0, 120, 240]) { const r = at(40 + 20 * Math.cos(a * Math.PI / 180), 30 + 20 * Math.sin(a * Math.PI / 180)); expect(r.kind).toBe('hole'); expect(r.rim).toBe(true); expect(r.h).toBeGreaterThan(0.2); }
    const sp = at(50, 47.3); expect(sp.kind).toBe('hole'); expect(sp.rim).toBe(true);
    for (const [x, y] of [[50, 12.7], [20, 30], [40, 30], [15, 12]]) { const h = at(x, y); expect(h.kind).toBe('hole'); expect(h.rim).toBeFalsy(); }
    const b = at(12, 48); expect(b.kind).toBe('bump'); expect(b.h).toBeGreaterThan(0.4);
    expect(I.every((i) => !i.inc)).toBe(true);
  });
  it('islands are excluded by default: flatness of the plain face', () => {
    expect(form(auto.indices)).toBeLessThan(0.12);
    expect(form(fill({}).indices)).toBeGreaterThan(0.3); // old behaviour (islands included) keeps the rims
  });
  it('“not an island” puts the rim points back; holes cannot be included', () => {
    const r = at(60, 30), h = at(40, 30);
    const g = fill({ isl: [{ c: r.c, inc: true }, { c: h.c, inc: true }] });
    expect(g.indices.length).toBeGreaterThan(auto.indices.length + 100);
    expect(form(g.indices)).toBeGreaterThan(0.2);
    expect(g.islands!.find((i) => Math.hypot(i.c[0] - 40, i.c[1] - 30) < 1.5)!.inc).toBe(false);
  });
  it('refine: + grows, − shrinks the excluded zone of one island', () => {
    const h = at(40, 30), n0 = auto.indices.length;
    const grow = fill({ isl: [{ c: h.c, m: 2 }] }).indices.length, shrink = fill({ isl: [{ c: at(60, 30).c, m: -0.7 }] }).indices.length;
    expect(grow).toBeLessThan(n0 - 300); expect(shrink).toBeGreaterThan(n0);
  });
});
