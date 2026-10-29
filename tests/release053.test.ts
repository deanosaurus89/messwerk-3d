import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import { gunzipSync } from 'fflate';
import { controlsSeededOnCreate, nominalControlKinds } from '../src/core/nominalvalue';
import { attachCadAux, modeAfterConfirm } from '../src/core/nominalui';
import { explicitSurfaceMiss, explicitSurfaceRejected, nominalOnCad, type TessFace } from '../src/core/cadnominal';
import { materialForOpacity, referenceOpacity } from '../src/core/cadview';
import { facePatch, wiresForFace } from '../src/core/facetrim';
import { runConstruction } from '../src/core/construct';
import { basis, dot, sub, type Vec3 } from '../src/core/linalg';
import type { FitResult } from '../src/core/fit';
import * as C from '../src/cad/occcore';

const R = { rms: 0, form: 0, maxPos: 0, maxNeg: 0, n: 0 };

function boxOf(pos: ArrayLike<number>) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = pos[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v;
  }
  return { mn, mx, span: Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) };
}
function uvOf(n: Vec3, o: Vec3, p: Vec3): [number, number] {
  const [u, v] = basis(n), d = sub(p, o);
  return [dot(d, u), dot(d, v)];
}
function covers(tri: Float32Array, n: Vec3, o: Vec3, p: Vec3): boolean {
  const [x, y] = uvOf(n, o, p);
  for (let i = 0; i < tri.length; i += 9) {
    const a = uvOf(n, o, [tri[i], tri[i + 1], tri[i + 2]]);
    const b = uvOf(n, o, [tri[i + 3], tri[i + 4], tri[i + 5]]);
    const c = uvOf(n, o, [tri[i + 6], tri[i + 7], tri[i + 8]]);
    const c1 = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    const c2 = (c[0] - b[0]) * (y - b[1]) - (c[1] - b[1]) * (x - b[0]);
    const c3 = (a[0] - c[0]) * (y - c[1]) - (a[1] - c[1]) * (x - c[0]);
    const neg = c1 < -1e-6 || c2 < -1e-6 || c3 < -1e-6;
    const pos = c1 > 1e-6 || c2 > 1e-6 || c3 > 1e-6;
    if (!(neg && pos)) return true;
  }
  return false;
}

describe('2026.0.53 controls, aux plane, type lock, opacity, construct', () => {
  it('seeds no controls on a new feature, including a nominal plane', () => {
    expect(controlsSeededOnCreate('Ebene')).toEqual([]);
    expect(controlsSeededOnCreate('Zylinder')).toEqual([]);
    expect(controlsSeededOnCreate('Kreis')).toEqual([]);
    expect(nominalControlKinds('Ebene')).toEqual(['X', 'Y', 'Z']);
    expect(nominalControlKinds('Ebene').length).toBeGreaterThan(0);
  });

  it('keeps Create or Construct open after confirm and clears only on leave', () => {
    expect(modeAfterConfirm('fit', false)).toBe('fit');
    expect(modeAfterConfirm('con', false)).toBe('con');
    expect(modeAfterConfirm('fit', true)).toBeNull();
  });

  it('does not attach an auxiliary plane to a nominal curve', () => {
    const plane = { type: 'Ebene' as const };
    expect(attachCadAux('soll', 'Kreis', plane)).toBeUndefined();
    expect(attachCadAux('soll', 'Langloch', plane)).toBeUndefined();
    expect(attachCadAux('soll', 'Linie', plane)).toBeUndefined();
    expect(attachCadAux('ist', 'Kreis', plane)).toBe(plane);
    expect(attachCadAux('soll', 'Ebene', plane)).toBe(plane);
    expect(attachCadAux('soll', 'Kreis', undefined)).toBeUndefined();
  });

  it('locks an explicit plane or cylinder to that face type', () => {
    expect(explicitSurfaceRejected('Ebene', 'Kugel')).toBe(true);
    expect(explicitSurfaceRejected('Ebene', 'Zylinder')).toBe(true);
    expect(explicitSurfaceRejected('Zylinder', 'Ebene')).toBe(true);
    expect(explicitSurfaceRejected('Ebene', 'Ebene')).toBe(false);
    expect(explicitSurfaceRejected('auto', 'Kugel')).toBe(false);
    expect(explicitSurfaceRejected('Ebene', 'NURBS')).toBe(false);
    expect(explicitSurfaceMiss('Ebene', 'Kugel')).toBe(true);
    expect(explicitSurfaceMiss('Ebene', null)).toBe(true);
    expect(explicitSurfaceMiss('Ebene', 'Ebene')).toBe(false);
    expect(explicitSurfaceMiss('auto', null)).toBe(false);
    const plane: TessFace = { id: 1, geom: { type: 'Ebene', origin: [0, 0, 0], normal: [0, 0, 1], edges: [] }, positions: new Float32Array([0, 0, 0, 4, 0, 0, 0, 3, 0]), normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]) };
    const spherePts: number[] = [], sphereN: number[] = [];
    for (let i = 1; i < 8; i++) for (let j = 0; j < 12; j++) {
      const u = Math.PI * i / 8, v = (j / 12) * Math.PI * 2;
      const p = [18 * Math.sin(u) * Math.cos(v), 18 * Math.sin(u) * Math.sin(v), 18 * Math.cos(u)];
      spherePts.push(...p); sphereN.push(p[0] / 18, p[1] / 18, p[2] / 18);
    }
    const sphere: TessFace = { id: 2, geom: { type: 'Kugel', origin: [0, 0, 0], normal: [0, 0, 1], radius: 18, edges: [] }, positions: new Float32Array(spherePts), normals: new Float32Array(sphereN) };
    expect(nominalOnCad([sphere, plane], 2, [0, 0, 18], 'Ebene', 2)).toBeNull();
    expect(nominalOnCad([sphere, plane], 2, [0, 0, 18], 'Zylinder', 2)).toBeNull();
    expect(nominalOnCad([sphere, plane], 2, [0, 0, 18], 'auto', 2)?.pick.fit.type).toBe('Kugel');
    expect(nominalOnCad([sphere, plane], 1, [1, 1, 0], 'Ebene', 2)?.pick.fit.type).toBe('Ebene');
    expect(nominalOnCad([sphere, plane], 1, [1, 1, 0], 'Zylinder', 2)).toBeNull();
  });

  it('turns reference CAD fully opaque when transparency is off', () => {
    expect(referenceOpacity(false, 40)).toBe(1);
    expect(referenceOpacity(false, 5)).toBe(1);
    expect(referenceOpacity(false, 95)).toBe(1);
    expect(referenceOpacity(true, 40)).toBeCloseTo(0.6);
    expect(referenceOpacity(true, 5)).toBeCloseTo(0.95);
    const off = materialForOpacity(referenceOpacity(false, 60));
    expect(off).toEqual({ opacity: 1, transparent: false, depthWrite: true, side: 'double' });
    const on = materialForOpacity(referenceOpacity(true, 40));
    expect(on.transparent).toBe(true);
    expect(on.side).toBe('front');
    expect(on.opacity).toBeCloseTo(0.6);
  });

  it('intersects a cylinder or cone axis with a plane as a point', () => {
    const pl = { type: 'Ebene', center: [0, 0, 4], normal: [0, 0, 1], ...R } as FitResult;
    const cy = { type: 'Zylinder', center: [3, 5, 0], normal: [0, 0, 1], radius: 8, diameter: 16, length: 20, ...R } as FitResult;
    const cone = { type: 'Kegel', center: [1, 2, 6], normal: [0, 0, 1], apex: [1, 2, 0], halfAngle: Math.PI / 6, radius: 4, ...R } as FitResult;
    const a = runConstruction('pt-axis-plane', [pl, cy]);
    expect(a.type).toBe('Punkt');
    expect(a.center[0]).toBeCloseTo(3);
    expect(a.center[1]).toBeCloseTo(5);
    expect(a.center[2]).toBeCloseTo(4);
    const b = runConstruction('pt-axis-plane', [pl, cone]);
    expect(b.type).toBe('Punkt');
    expect(b.center[0]).toBeCloseTo(1);
    expect(b.center[1]).toBeCloseTo(2);
    expect(b.center[2]).toBeCloseTo(4);
    const tilt = { ...pl, normal: [0, 0.6, 0.8] } as FitResult;
    const c = runConstruction('pt-axis-plane', [tilt, cy]);
    expect(c.type).toBe('Punkt');
    expect(() => runConstruction('pt-axis-plane', [{ ...pl, normal: [1, 0, 0] } as FitResult, cy])).toThrow();
  });

  it('drops a wire that is the untrimmed surface rectangle', () => {
    const pos = new Float32Array([0, 0, 0, 10, 0, 0, 10, 6, 0, 0, 6, 0]);
    const idx = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const huge: Vec3[][] = [[[-500, -500, 0], [500, -500, 0], [500, 500, 0], [-500, 500, 0]]];
    const used = wiresForFace(huge, pos, idx);
    const box = boxOf(used.flatMap((L) => L.flat()));
    expect(box.span).toBeLessThan(30);
    const exact: Vec3[][] = [[[0, 0, 0], [10, 0, 0], [10, 6, 0], [0, 6, 0]]];
    expect(wiresForFace(exact, pos, idx)[0]).toHaveLength(4);
  });
});

describe('2026.0.53 plane trim on the CAD sample', () => {
  let loaded: C.LoadedFace[] = [];
  beforeAll(async () => {
    const oc = await (await import('opencascade.js/dist/node.js' as any)).default();
    const sh = C.readCAD(oc, gunzipSync(new Uint8Array(fs.readFileSync('public/samples/cad-sample.igs.gz'))), 'cad-sample.igs');
    loaded = C.loadDisplayFaces(oc, sh).faces;
  }, 180000);

  function asTess(faces: C.LoadedFace[]): TessFace[] {
    return faces.map((f) => ({ id: f.id, geom: f.geom, positions: f.tess.positions, normals: f.tess.normals }));
  }

  it('trims a plane to the face, not an oversized patch', () => {
    const faces = asTess(loaded);
    const planes = loaded.filter((f) => {
      if (!f.geom || f.tess.indices.length < 3) return false;
      return nominalOnCad(faces, f.id, f.geom.origin, 'auto', 0.4)?.pick.fit.type === 'Ebene';
    });
    expect(planes.length).toBeGreaterThan(0);
    const ranked = planes.map((f) => ({ f, span: boxOf(f.tess.positions).span })).sort((a, b) => b.span - a.span);
    const face = ranked[0].f;
    const hit = nominalOnCad(faces, face.id, face.geom!.origin, 'Ebene', 1)!;
    expect(hit.pick.fit.type).toBe('Ebene');
    const loops = wiresForFace(face.geom?.loops, face.tess.positions, face.tess.indices);
    expect(loops.length).toBeGreaterThan(0);
    const patch = facePatch(hit.pick.fit, loops, 24);
    expect(patch).toBeTruthy();
    const mesh = boxOf(face.tess.positions);
    const drawn = boxOf(patch!.tri);
    expect(drawn.span).toBeLessThanOrEqual(mesh.span * 1.08 + 0.8);
    const tol = 0.8;
    for (let i = 0; i < patch!.tri.length; i += 3) {
      const p = [patch!.tri[i], patch!.tri[i + 1], patch!.tri[i + 2]];
      for (let k = 0; k < 3; k++) {
        expect(p[k]).toBeGreaterThanOrEqual(mesh.mn[k] - tol);
        expect(p[k]).toBeLessThanOrEqual(mesh.mx[k] + tol);
      }
      expect(Math.abs(dot(sub(p as Vec3, hit.pick.fit.center), hit.pick.fit.normal))).toBeLessThan(0.05);
    }
    let bi = 0, ba = -1;
    const idx = face.tess.indices, pos = face.tess.positions;
    for (let i = 0; i < idx.length; i += 3) {
      const a = [pos[3 * idx[i]], pos[3 * idx[i] + 1], pos[3 * idx[i] + 2]] as Vec3;
      const b = [pos[3 * idx[i + 1]], pos[3 * idx[i + 1] + 1], pos[3 * idx[i + 1] + 2]] as Vec3;
      const c = [pos[3 * idx[i + 2]], pos[3 * idx[i + 2] + 1], pos[3 * idx[i + 2] + 2]] as Vec3;
      const ab = sub(b, a), ac = sub(c, a);
      const ar = Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]);
      if (ar > ba) { ba = ar; bi = i; }
    }
    const mid = [0, 1, 2].map((k) => (pos[3 * idx[bi] + k] + pos[3 * idx[bi + 1] + k] + pos[3 * idx[bi + 2] + k]) / 3) as Vec3;
    expect(covers(patch!.tri, hit.pick.fit.normal, hit.pick.fit.center, mid)).toBe(true);
    const outside = [mesh.mx[0] + 8, mesh.mx[1] + 8, mesh.mx[2] + 8] as Vec3;
    expect(covers(patch!.tri, hit.pick.fit.normal, hit.pick.fit.center, outside)).toBe(false);
  }, 180000);

  it('keeps a cylinder or sphere patch inside the face', () => {
    const faces = asTess(loaded);
    const pick = (kind: 'Zylinder' | 'Kugel' | 'Kegel' | 'Torus') => loaded
      .map((f) => ({ f, hit: f.geom ? nominalOnCad(faces, f.id, f.geom.origin, kind, 0.4) : null, span: boxOf(f.tess.positions).span }))
      .filter((x) => x.hit?.pick.fit.type === kind && x.f.tess.indices.length > 8)
      .sort((a, b) => b.span - a.span)[0];
    const cyl = pick('Zylinder');
    expect(cyl).toBeTruthy();
    const loops = wiresForFace(cyl.f.geom?.loops, cyl.f.tess.positions, cyl.f.tess.indices);
    const patch = facePatch(cyl.hit!.pick.fit, loops, 24);
    expect(patch && patch.tri.length).toBeGreaterThan(9);
    const mesh = boxOf(cyl.f.tess.positions);
    const r = cyl.hit!.pick.fit.radius!;
    for (let i = 0; i < patch!.tri.length; i += 3) {
      const p = [patch!.tri[i], patch!.tri[i + 1], patch!.tri[i + 2]] as Vec3;
      for (let k = 0; k < 3; k++) {
        expect(p[k]).toBeGreaterThanOrEqual(mesh.mn[k] - 1.2);
        expect(p[k]).toBeLessThanOrEqual(mesh.mx[k] + 1.2);
      }
      const axial = dot(sub(p, cyl.hit!.pick.fit.center), cyl.hit!.pick.fit.normal);
      const radial = Math.hypot(...sub(sub(p, cyl.hit!.pick.fit.center), [cyl.hit!.pick.fit.normal[0] * axial, cyl.hit!.pick.fit.normal[1] * axial, cyl.hit!.pick.fit.normal[2] * axial]) as unknown as number[]);
      expect(Math.abs(radial - r)).toBeLessThan(0.15);
    }
    const sph = pick('Kugel');
    if (sph) {
      const sl = wiresForFace(sph.f.geom?.loops, sph.f.tess.positions, sph.f.tess.indices);
      const sp = facePatch(sph.hit!.pick.fit, sl, 16);
      if (sp && sp.tri.length) {
        const sb = boxOf(sph.f.tess.positions);
        const drawn = boxOf(sp.tri);
        expect(drawn.span).toBeLessThanOrEqual(sb.span * 1.15 + 1.5);
      }
    }
    for (const kind of ['Kegel', 'Torus'] as const) {
      const hit = pick(kind);
      if (!hit) continue;
      const sl = wiresForFace(hit.f.geom?.loops, hit.f.tess.positions, hit.f.tess.indices);
      const sp = sl.length ? facePatch(hit.hit!.pick.fit, sl, 16) : null;
      if (!sp?.tri.length) continue;
      const sb = boxOf(hit.f.tess.positions);
      expect(boxOf(sp.tri).span).toBeLessThanOrEqual(sb.span * 1.15 + 1.5);
    }
  }, 180000);
});
