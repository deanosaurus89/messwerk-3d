// B-Spline-Flächenrückführung gegen die bekannte Freiformfläche des Freiform-Demoteils.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseByName } from '../src/core/io';
import { MeshTopology, gather } from '../src/core/region';
import { boundaryLoop, evalSurface, fitFreeform, tessellate, toIGES, toSTEP, toJSON } from '../src/core/nurbs';
import type { Vec3 } from '../src/core/linalg';

const Z = (x: number, y: number) => 20 + Math.sin((Math.PI * x) / 70) * (17 + 3 * Math.cos((2 * Math.PI * y) / 80) + 2.5 * y / 80);
/** Abweichung der Fläche von der Formel (vertikal, an Flächenpunkten) – max / RMS. */
function vsFormula(f: ReturnType<typeof fitFreeform>, margin = 0.02) {
  let mx = 0, s = 0, n = 0;
  for (let i = 0; i <= 60; i++) for (let j = 0; j <= 60; j++) {
    const u = margin + (1 - 2 * margin) * i / 60, v = margin + (1 - 2 * margin) * j / 60;
    const P = evalSurface(f.surface, u, v, 0)[0]; const d = P[2] - Z(P[0], P[1]);
    mx = Math.max(mx, Math.abs(d)); s += d * d; n++;
  }
  return { max: mx, rms: Math.sqrt(s / n) };
}

describe('Freiformfläche (B-Spline)', () => {
  it('synthetisches Gitter der Formel', () => {
    const p: Vec3[] = [], n: Vec3[] = [];
    for (let i = 0; i <= 70; i++) for (let j = 0; j <= 80; j++) { p.push([i, j, Z(i, j)]); n.push([0, 0, 1]); }
    const f = fitFreeform(p, n, null, { nu: 10, nv: 10, deg: 3, smooth: 0 });
    const e = vsFormula(f); console.log('synthetisch', f.rms, e);
    expect(f.rms).toBeLessThan(0.01); expect(e.max).toBeLessThan(0.02);
  });
  it('Scan-Netz des Freiform-Demoteils (Regionenwachstum ab Flächenmitte)', () => {
    const buf = readFileSync(new URL('../public/samples/freiform.stl.gz', import.meta.url));
    const mesh = parseByName('freiform.stl.gz', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const topo = new MeshTopology(mesh);
    const pt: Vec3 = [35, 40, Z(35, 40)]; const P = mesh.positions, F = mesh.indices; let best = 0, bd = Infinity;
    for (let t = 0; t < F.length / 3; t++) { const a = 3 * F[3 * t]; const d = (P[a] - pt[0]) ** 2 + (P[a + 1] - pt[1]) ** 2 + (P[a + 2] - pt[2]) ** 2; if (d < bd) { bd = d; best = t; } }
    const tris = topo.growRegion(best, pt, { maxAngleDeg: 20, radius: 0, freeform: true } as any);
    const idx = topo.regionVertices(tris).all;
    const { p, n } = gather(mesh, idx);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const q of p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    console.log('Region', idx.length, 'Punkte, x', x0.toFixed(2), x1.toFixed(2), 'y', y0.toFixed(2), y1.toFixed(2));
    const loop: Vec3[] = boundaryLoop(mesh.indices, idx, P.length / 3).map((v) => [P[3 * v], P[3 * v + 1], P[3 * v + 2]]);
    const t0 = performance.now();
    const f = fitFreeform(p, n, loop, { nu: 12, nv: 12, deg: 3, smooth: 1e-4 });
    const e = vsFormula(f, 0.03);
    console.log('Scan', { ms: performance.now() - t0, kind: f.kind, rms: f.rms, std: f.std, maxPos: f.maxPos, maxNeg: f.maxNeg, loop: loop.length, curves: f.boundary.length, vsFormel: e });
    expect(x1 - x0).toBeGreaterThan(60); expect(y1 - y0).toBeGreaterThan(70);
    expect(f.kind).toBe('vierseitig'); expect(f.boundary.length).toBe(4);
    expect(e.max).toBeLessThan(0.01); expect(f.rms).toBeLessThan(0.012);
    const ig = toIGES(f), st = toSTEP(f); expect(ig.split('\n').every((l) => !l || l.length === 80)).toBe(true);
    expect(st).toContain('B_SPLINE_SURFACE_WITH_KNOTS'); expect(toJSON(f).countU).toBe(12);
    expect(tessellate(f, 20).indices.length).toBe(20 * 20 * 6);
    const fs = require('node:fs'); fs.mkdirSync('/workspace/tmp-nurbs', { recursive: true }); fs.writeFileSync('/workspace/tmp-nurbs/freiform.igs', ig); fs.writeFileSync('/workspace/tmp-nurbs/freiform.stp', st);
  });
});
