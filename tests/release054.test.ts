import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import { gunzipSync } from 'fflate';
import { islandDrawerStaysOpen, measuredPointByGrow, nominalHighlightsFace, attachCadAux } from '../src/core/nominalui';
import { nominalFromCad, nominalOnCad, type TessFace } from '../src/core/cadnominal';
import { facePatch, wireOversized, wireToEdgeGap, wiresForFace } from '../src/core/facetrim';
import { angularGapDeg, canJoin, fitAsAnalytic, joinedFit, joinLoops, nominalSurface, wallClosed } from '../src/core/cadjoin';
import { inNominalArc, nominalArcLocal } from '../src/core/trim';
import { add, basis, dot, scale, sub, type Vec3 } from '../src/core/linalg';
import type { FitResult } from '../src/core/fit';
import type { CadAnalytic, CadCurve } from '../src/cad/analytic';
import * as C from '../src/cad/occcore';

const Z = { rms: 0, form: 0, maxPos: 0, maxNeg: 0, n: 0 };
const fit = (over: Partial<FitResult> & { type: FitResult['type'] }): FitResult => ({ center: [0, 0, 0], normal: [0, 0, 1], ...Z, ...over });

function covers(tri: Float32Array, n: Vec3, o: Vec3, p: Vec3): boolean {
  const [u, v] = basis(n);
  const uv = (q: Vec3): [number, number] => { const d = sub(q, o); return [dot(d, u), dot(d, v)]; };
  const [x, y] = uv(p);
  for (let i = 0; i < tri.length; i += 9) {
    const a = uv([tri[i], tri[i + 1], tri[i + 2]]);
    const b = uv([tri[i + 3], tri[i + 4], tri[i + 5]]);
    const c = uv([tri[i + 6], tri[i + 7], tri[i + 8]]);
    const c1 = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    const c2 = (c[0] - b[0]) * (y - b[1]) - (c[1] - b[1]) * (x - b[0]);
    const c3 = (a[0] - c[0]) * (y - c[1]) - (a[1] - c[1]) * (x - c[0]);
    const neg = c1 < -1e-6 || c2 < -1e-6 || c3 < -1e-6;
    const pos = c1 > 1e-6 || c2 > 1e-6 || c3 > 1e-6;
    if (!(neg && pos)) return true;
  }
  return false;
}

describe('2026.0.54 islands, point, curves', () => {
  it('keeps the Islands list open when a chip is selected or dismissed', () => {
    expect(islandDrawerStaysOpen(true, 'select')).toBe(true);
    expect(islandDrawerStaysOpen(false, 'select')).toBe(true);
    expect(islandDrawerStaysOpen(true, 'dismiss')).toBe(true);
    expect(islandDrawerStaysOpen(true, 'summary')).toBe(false);
    expect(islandDrawerStaysOpen(false, 'summary')).toBe(true);
  });

  it('does not grow a measured point, and a nominal point is not a surface', () => {
    expect(measuredPointByGrow('Punkt')).toBe(false);
    expect(measuredPointByGrow('Ebene')).toBe(true);
    expect(nominalHighlightsFace('Punkt')).toBe(false);
    expect(nominalHighlightsFace('Kreis')).toBe(false);
    expect(nominalHighlightsFace('Langloch')).toBe(false);
    expect(nominalHighlightsFace('Linie')).toBe(false);
    expect(nominalHighlightsFace('Ebene')).toBe(true);
    expect(nominalHighlightsFace('Zylinder')).toBe(true);
    const edge: CadCurve = { kind: 'circle', mid: [8, 0, 0], length: 50, center: [0, 0, 0], normal: [0, 0, 1], radius: 8 };
    const face: CadAnalytic = { type: 'Zylinder', origin: [0, 0, 0], normal: [0, 0, 1], radius: 8, edges: [edge] };
    const tess: TessFace = { id: 3, geom: face, positions: new Float32Array([8, 0, 0, 0, 8, 1, -8, 0, 2]), normals: new Float32Array([1, 0, 0, 0, 1, 0, -1, 0, 0]) };
    const pt = nominalOnCad([tess], 3, [8, 0, 1], 'Punkt', 2, [1, 0, 0])!;
    expect(pt.pick.fit.type).toBe('Punkt');
    expect(pt.pick.fit.center[0]).toBeCloseTo(8);
    expect(pt.pick.fit.normal[0]).toBeCloseTo(1);
    expect(Math.abs(pt.pick.fit.normal[2])).toBeLessThan(1e-9);
    expect(nominalOnCad([tess], 3, [0, 0, 1], 'Kreis', 2)).toBeNull();
    expect(nominalOnCad([tess], 3, [8, 0.2, 1], 'Kreis', 2)!.pick.fit.type).toBe('Kreis');
    expect(nominalOnCad([tess], 3, [8, 0, 1], 'auto', 1.5)?.pick.fit.type).not.toBe('Punkt');
  });

  it('trims a nominal circle to the CAD arc and does not attach an aux plane', () => {
    const edge: CadCurve = {
      kind: 'circle', mid: [10, 0, 0], length: (Math.PI * 10) / 2, center: [0, 0, 0], normal: [0, 0, 1], radius: 10, ang0: 0, sweep: Math.PI / 2,
    };
    const face: CadAnalytic = { type: 'Ebene', origin: [0, 0, 0], normal: [0, 0, 1], edges: [edge] };
    const hit = nominalFromCad(face, [10, 0.2, 0], 'Kreis', 2)!;
    expect(hit.fit.type).toBe('Kreis');
    expect(hit.fit.arcSweep).toBeCloseTo(Math.PI / 2);
    expect(attachCadAux('soll', 'Kreis', hit.aux)).toBeUndefined();
    expect(attachCadAux('ist', 'Kreis', hit.aux)?.type).toBe('Ebene');
    const [u, v] = basis(hit.fit.normal);
    const at = (a: number): Vec3 => add(hit.fit.center, add(scale(u, 10 * Math.cos(a)), scale(v, 10 * Math.sin(a))));
    expect(inNominalArc(hit.fit, at(hit.fit.arc0! + 0.2))).toBe(true);
    expect(inNominalArc(hit.fit, at(hit.fit.arc0! + Math.PI))).toBe(false);
    const local = nominalArcLocal(hit.fit)!;
    expect(local.length).toBeGreaterThan(4);
    expect(local.length).toBeLessThan(40);
    const full = fit({ type: 'Kreis', radius: 10 });
    expect(nominalArcLocal(full)).toBeNull();
    expect(inNominalArc(full, [10, 0, 0])).toBe(true);
    expect(nominalFromCad(face, [0, 0, 0], 'Kreis', 2)).toBeNull();
    expect(nominalFromCad(face, [0, 0, 0], 'Linie', 2)).toBeNull();
  });
});

describe('2026.0.54 plane wires and half shells', () => {
  it('keeps the real trim when an untrimmed rectangle is also present', () => {
    const pos = new Float32Array([0, 0, 0, 10, 0, 0, 10, 6, 0, 0, 6, 0]);
    const idx = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const huge: Vec3[][] = [[[-400, -400, 0], [400, -400, 0], [400, 400, 0], [-400, 400, 0]]];
    const exact: Vec3[] = [[0, 0, 0], [10, 0, 0], [10, 6, 0], [0, 6, 0]];
    expect(wireOversized(huge[0], pos)).toBe(true);
    expect(wireOversized(exact, pos)).toBe(false);
    const kept = wiresForFace([huge[0], exact], pos, idx);
    expect(kept.some((L) => L.length === 4 && Math.hypot(L[1][0] - L[0][0]) < 20)).toBe(true);
    expect(kept.some((L) => Math.hypot(L[1][0] - L[0][0]) > 100)).toBe(false);
  });

  it('spans two coplanar regions and keeps two islands', () => {
    const plane = fit({ type: 'Ebene' });
    const a: Vec3[] = [[0, 0, 0], [10, 0, 0], [10, 8, 0], [0, 8, 0]];
    const b: Vec3[] = [[16, 0, 0], [26, 0, 0], [26, 8, 0], [16, 8, 0]];
    const patch = facePatch(plane, [a, b])!;
    expect(covers(patch.tri, plane.normal, plane.center, [5, 4, 0])).toBe(true);
    expect(covers(patch.tri, plane.normal, plane.center, [21, 4, 0])).toBe(true);
    expect(covers(patch.tri, plane.normal, plane.center, [13, 4, 0])).toBe(false);
    const outer: Vec3[] = [[0, 0, 0], [20, 0, 0], [20, 12, 0], [0, 12, 0]];
    const h1: Vec3[] = [[3, 3, 0], [6, 3, 0], [6, 6, 0], [3, 6, 0]];
    const h2: Vec3[] = [[12, 3, 0], [16, 3, 0], [16, 7, 0], [12, 7, 0]];
    const holed = facePatch(plane, [outer, h1, h2])!;
    expect(covers(holed.tri, plane.normal, plane.center, [4.5, 4.5, 0])).toBe(false);
    expect(covers(holed.tri, plane.normal, plane.center, [14, 5, 0])).toBe(false);
    expect(covers(holed.tri, plane.normal, plane.center, [10, 2, 0])).toBe(true);
    expect(wireToEdgeGap([outer, h1, h2], holed.edges)).toBeLessThan(0.2);
  });

  it('joins a second half-shell into one full cylinder, cone or sphere', () => {
    const arc = (a0: number, a1: number, z0: number, z1: number, r = 10): Vec3[] => {
      const n = 16, up: Vec3[] = [], dn: Vec3[] = [];
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        up.push([r * Math.cos(a), r * Math.sin(a), z0]);
        dn.push([r * Math.cos(a), r * Math.sin(a), z1]);
      }
      return [...up, ...dn.reverse()];
    };
    const left = arc(0, Math.PI, 0, 12);
    const right = arc(Math.PI, Math.PI * 2, 0, 12);
    const cyl = fit({ type: 'Zylinder', radius: 10, length: 12, center: [0, 0, 6] });
    const face: CadAnalytic = { type: 'Zylinder', origin: [0, 0, 0], normal: [0, 0, 1], radius: 10, t0: 0, t1: 12, edges: [] };
    expect(canJoin(cyl, face)).toBe(true);
    expect(wallClosed(cyl, [left])).toBe(false);
    expect(angularGapDeg(cyl, [left])).toBeGreaterThan(90);
    const both = joinLoops([left], [right]);
    expect(wallClosed(cyl, both)).toBe(true);
    const joined = joinedFit(cyl, face, both);
    expect(joined.closedSolid).toBe(true);
    expect(joined.length).toBeGreaterThan(10);
    const half = nominalSurface(cyl, [left])!;
    let halfMin = Infinity;
    for (let i = 1; i < half.tri.length; i += 3) halfMin = Math.min(halfMin, half.tri[i]);
    expect(halfMin).toBeGreaterThan(-1);
    const full = nominalSurface(joined, both)!;
    let fullMin = Infinity;
    for (let i = 1; i < full.tri.length; i += 3) fullMin = Math.min(fullMin, full.tri[i]);
    expect(fullMin).toBeLessThan(-5);
    const north: CadAnalytic = { type: 'Kugel', origin: [0, 0, 0], normal: [0, 0, 1], radius: 18, edges: [] };
    const south: CadAnalytic = { type: 'Kugel', origin: [0, 0, 0], normal: [0, 0, -1], radius: 18, edges: [] };
    const cap = fit({ type: 'Kugel', radius: 18, normal: [0, 0, 1] });
    expect(canJoin(cap, south)).toBe(true);
    const sphere = joinedFit(cap, south, []);
    expect(sphere.closedSolid).toBe(true);
    expect(nominalSurface(sphere, [[[18, 0, 0], [0, 18, 0], [-18, 0, 0], [0, -18, 0]]])!.tri.length).toBeGreaterThan(100);
    expect(canJoin(cap, north)).toBe(true);
    expect(joinedFit(cap, north, []).closedSolid).toBeFalsy();
  });
});

describe('2026.0.54 plane trim on the CAD sample', () => {
  let loaded: C.LoadedFace[] = [];
  beforeAll(async () => {
    const oc = await (await import('opencascade.js/dist/node.js' as any)).default();
    const sh = C.readCAD(oc, gunzipSync(new Uint8Array(fs.readFileSync('public/samples/cad-sample.igs.gz'))), 'cad-sample.igs');
    loaded = C.loadDisplayFaces(oc, sh).faces;
  }, 180000);

  function asTess(faces: C.LoadedFace[]): TessFace[] {
    return faces.map((f) => ({ id: f.id, geom: f.geom, positions: f.tess.positions, normals: f.tess.normals }));
  }

  it('trims every planar face to its outer wire and islands', () => {
    const faces = asTess(loaded);
    const rows: string[] = [];
    const fails: string[] = [];
    let planes = 0;
    for (const f of loaded) {
      if (!f.geom || f.tess.indices.length < 3) continue;
      const hit = nominalOnCad(faces, f.id, f.geom.origin, 'Ebene', 0.4);
      if (hit?.pick.fit.type !== 'Ebene') continue;
      planes++;
      const loops = wiresForFace(f.geom.loops, f.tess.positions, f.tess.indices);
      const patch = loops.length ? facePatch(hit.pick.fit, loops, 24) : null;
      const reasons: string[] = [];
      if (!loops.length) reasons.push('no wire');
      if (!patch?.tri.length) reasons.push('no patch');
      else {
        const gap = wireToEdgeGap(loops, patch.edges);
        if (!(gap < 0.65)) reasons.push(`wire gap ${gap.toFixed(2)} mm`);
        const n = hit.pick.fit.normal, o = hit.pick.fit.center;
        let outside = false;
        const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        for (const L of loops) for (const p of L) for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; }
        for (let i = 0; i < patch.tri.length; i += 3) {
          const p = [patch.tri[i], patch.tri[i + 1], patch.tri[i + 2]] as Vec3;
          for (let k = 0; k < 3; k++) if (p[k] < mn[k] - 0.75 || p[k] > mx[k] + 0.75) outside = true;
        }
        if (outside) reasons.push('patch leaves the wire');
        const pos = f.tess.positions, idx = f.tess.indices;
        const [uu, vv] = basis(n);
        const uvOf = (q: Vec3): [number, number] => { const d = sub(q, o); return [dot(d, uu), dot(d, vv)]; };
        const pip = (poly: [number, number][], x: number, y: number) => {
          let w = false;
          for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const [xi, yi] = poly[i], [xj, yj] = poly[j];
            if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi) w = !w;
          }
          return w;
        };
        const polys = loops.map((L) => L.map(uvOf));
        const inWire = (q: Vec3) => {
          const [x, y] = uvOf(q);
          let depth = 0;
          for (const poly of polys) if (pip(poly, x, y)) depth++;
          return depth % 2 === 1;
        };
        let insideN = 0, hitN = 0;
        const step = Math.max(1, Math.floor(idx.length / 3 / 40));
        for (let t = 0; t < idx.length; t += 3 * step) {
          const mid = [0, 1, 2].map((k) => (pos[3 * idx[t] + k] + pos[3 * idx[t + 1] + k] + pos[3 * idx[t + 2] + k]) / 3) as Vec3;
          if (!inWire(mid)) continue;
          insideN++;
          if (covers(patch.tri, n, o, mid)) hitN++;
        }
        if (insideN >= 3 && hitN < insideN * 0.75) reasons.push(`interior ${hitN}/${insideN}`);
        const out = [mx[0] + 8, mx[1] + 8, mx[2]] as Vec3;
        if (covers(patch.tri, n, o, out)) reasons.push('outside covered');
      }
      if (reasons.length) {
        let off = 0;
        const n = hit.pick.fit.normal, o = hit.pick.fit.center;
        for (const L of loops) for (const p of L) off = Math.max(off, Math.abs(dot(sub(p, o), n)));
        reasons.push(`type ${f.geom?.type} pts ${loops.reduce((s, L) => s + L.length, 0)} offPlane ${off.toFixed(2)} tris ${patch?.tri.length ?? 0}`);
      }
      const line = `face ${f.id} wires ${loops.length} ${reasons.length ? 'FAIL ' + reasons.join(', ') : 'ok'}`;
      rows.push(line);
      if (reasons.length) fails.push(line);
    }
    console.log(`plane trim matrix: ${planes - fails.length}/${planes} ok\n` + rows.join('\n'));
    expect(planes).toBeGreaterThan(8);
    expect(fails, fails.join('\n')).toEqual([]);
  }, 180000);

  it('finds half shells on the sample when two coaxial faces close a wall', () => {
    const faces = asTess(loaded);
    const cyl = loaded.flatMap((f) => {
      if (!f.geom?.loops?.length || f.tess.indices.length < 8) return [];
      const h = nominalOnCad(faces, f.id, f.geom.origin, 'Zylinder', 0.5);
      return h?.pick.fit.type === 'Zylinder' ? [{ f, fit: h.pick.fit }] : [];
    });
    let pairs = 0, closed = 0;
    for (let i = 0; i < cyl.length; i++) for (let j = i + 1; j < cyl.length; j++) {
      const a = cyl[i], b = cyl[j];
      const other = fitAsAnalytic(b.fit);
      if (!other || !canJoin(a.fit, other)) continue;
      const gapA = angularGapDeg(a.fit, a.f.geom!.loops ?? []);
      const gapB = angularGapDeg(b.fit, b.f.geom!.loops ?? []);
      if (gapA < 80 && gapB < 80) continue;
      pairs++;
      const loops = joinLoops(a.f.geom!.loops, b.f.geom!.loops);
      const joined = joinedFit(a.fit, other, loops);
      if (joined.closedSolid || wallClosed(joined, loops)) {
        closed++;
        const mesh = nominalSurface(joined, loops);
        expect(mesh && mesh.tri.length).toBeGreaterThan(9);
      }
    }
    const open = cyl.filter((c) => angularGapDeg(c.fit, c.f.geom!.loops ?? []) > 80).length;
    // The sample's coaxial open walls are separate shells, not two halves of one cylinder.
    // Two real halves are covered by the synthetic test above; a pair that does close must draw.
    console.log(`cylinder fits ${cyl.length}, open walls (gap>80°) ${open}, coaxial open pairs ${pairs}, closed after join ${closed}`);
    expect(open).toBeGreaterThan(0);
    expect(closed).toBeLessThanOrEqual(pairs);
  }, 180000);

  it('documents that the training part is a scan mesh, not a trimmed CAD solid', () => {
    const idx = JSON.parse(fs.readFileSync('public/samples/index.json', 'utf8')) as { key: string; file: string; cad?: boolean }[];
    const train = idx.find((s) => s.key === 'beispielteil')!;
    expect(train.file.endsWith('.stl') || train.file.endsWith('.stl.gz')).toBe(true);
    expect(train.cad).toBeFalsy();
    expect(idx.some((s) => s.cad && s.file.includes('cad-sample'))).toBe(true);
  });
});
