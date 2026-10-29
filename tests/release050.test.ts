import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import { gunzipSync } from 'fflate';
import * as C from '../src/cad/occcore';
import { analyticFromSamples, cappedEdgeTol, nominalFromCad, nominalOnCad, type CadAnalytic, type TessFace } from '../src/core/cadnominal';
import { SURFACE_HIGHLIGHT, TREE_GROUPS, addRegionSuggested, compactStatHtml, featureBuilderLayout, scanControls, stickySide } from '../src/core/nominalui';
import type { Vec3 } from '../src/core/linalg';

function cloud(pts: Vec3[], nrm: Vec3[]): { positions: Float32Array; normals: Float32Array } {
  const positions = new Float32Array(pts.length * 3), normals = new Float32Array(nrm.length * 3);
  pts.forEach((p, i) => { positions[3 * i] = p[0]; positions[3 * i + 1] = p[1]; positions[3 * i + 2] = p[2]; });
  nrm.forEach((p, i) => { normals[3 * i] = p[0]; normals[3 * i + 1] = p[1]; normals[3 * i + 2] = p[2]; });
  return { positions, normals };
}
const nurbs = (origin: Vec3 = [0, 0, 0]): CadAnalytic => ({ type: 'NURBS', origin, normal: [0, 0, 1], edges: [] });

describe('CAD surface create, point, and no Auto freeform', () => {
  const planePts: Vec3[] = [], planeN: Vec3[] = [];
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { planePts.push([i * 4, j * 3, 10]); planeN.push([0, 0, 1]); }
  const cylPts: Vec3[] = [], cylN: Vec3[] = [];
  for (let a = 0; a < 16; a++) for (let z = 0; z < 8; z++) {
    const t = (a / 16) * Math.PI * 2, x = 12 * Math.cos(t), y = 12 * Math.sin(t);
    cylPts.push([x, y, z * 3]); cylN.push([Math.cos(t), Math.sin(t), 0]);
  }
  const sphPts: Vec3[] = [], sphN: Vec3[] = [];
  for (let i = 1; i < 8; i++) for (let j = 0; j < 12; j++) {
    const u = Math.PI * i / 8, v = (j / 12) * Math.PI * 2;
    const p: Vec3 = [18 * Math.sin(u) * Math.cos(v), 18 * Math.sin(u) * Math.sin(v), 18 * Math.cos(u)];
    sphPts.push(p); sphN.push([p[0] / 18, p[1] / 18, p[2] / 18]);
  }
  const wave: Vec3[] = [], waveN: Vec3[] = [];
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) {
    const z = 6 * Math.sin(i / 1.4) * Math.cos(j / 1.6);
    wave.push([i * 3, j * 3, z]);
    const dx = 6 * Math.cos(i / 1.4) / 1.4, dy = -6 * Math.sin(i / 1.4) * Math.sin(j / 1.6) / 1.6;
    const l = Math.hypot(dx, dy, 1);
    waveN.push([-dx / l, -dy / l, 1 / l]);
  }

  it('fits a tessellated plane, cylinder and sphere, and refuses a wavy face in Auto', () => {
    expect(analyticFromSamples(planePts, planeN, 'auto')!.fit.type).toBe('Ebene');
    expect(analyticFromSamples(planePts, planeN, 'Ebene')!.fit.type).toBe('Ebene');
    expect(analyticFromSamples(cylPts, cylN, 'auto')!.fit.type).toBe('Zylinder');
    expect(analyticFromSamples(cylPts, cylN, 'Zylinder')!.fit.radius).toBeCloseTo(12, 0);
    expect(analyticFromSamples(sphPts, sphN, 'auto')!.fit.type).toBe('Kugel');
    expect(analyticFromSamples(sphPts, sphN, 'Kugel')!.fit.radius).toBeCloseTo(18, 0);
    expect(analyticFromSamples(wave, waveN, 'auto')).toBeNull();
    expect(analyticFromSamples(wave, waveN, 'Freiformfläche')).toBeNull();
    expect(analyticFromSamples(planePts, planeN, 'Zylinder')).toBeNull();
  });

  it('a NURBS face confirms through the tessellation; Auto never returns freeform; a point is the hit', () => {
    const face: TessFace = { id: 4, geom: nurbs([16, 10, 10]), ...cloud(planePts, planeN) };
    const auto = nominalOnCad([face], 4, [12, 9, 10], 'auto', 2)!;
    expect(auto.pick.fit.type).toBe('Ebene');
    expect(auto.pick.freeform).toBeFalsy();
    expect(nominalOnCad([face], 4, [12, 9, 10], 'Ebene', 2)!.pick.fit.type).toBe('Ebene');
    expect(nominalFromCad(face.geom!, [12, 9, 10], 'auto', 2)).toBeNull();
    expect(nominalFromCad(face.geom!, [12, 9, 10], 'Freiformfläche', 2)!.freeform).toBe(true);
    const wavy: TessFace = { id: 5, geom: nurbs(), ...cloud(wave, waveN) };
    expect(nominalOnCad([wavy], 5, [6, 6, 0], 'auto', 2)).toBeNull();
    const pt = nominalOnCad([face], 4, [3, 4, 10], 'Punkt', 2)!;
    expect(pt.pick.fit.type).toBe('Punkt');
    expect(pt.pick.fit.center).toEqual([3, 4, 10]);
    expect(nominalFromCad(nurbs(), [8, 1, 2], 'Punkt', 2)!.fit.center).toEqual([8, 1, 2]);
    expect(cappedEdgeTol(10, 200)).toBe(10);
    expect(cappedEdgeTol(10, 16)).toBeCloseTo(4.48);
    expect(cappedEdgeTol(10, 16)).toBeLessThan(8);
  });
});

describe('Feature Builder compact policy and the flat tree', () => {
  it('Nominal hides the brush; Measured keeps it; the side is not inferred from a data object', () => {
    expect(scanControls(true).brushRadius).toBe(false);
    expect(scanControls(false).brushRadius).toBe(true);
    expect(stickySide('ist', false)).toBe('ist');
    expect(stickySide('soll', true)).toBe('soll');
    expect(stickySide('ist', true)).toBe('ist');
  });
  it('defaults to the compact builder, suggests Add region after detect, and keeps role text free of the type name', () => {
    expect(featureBuilderLayout(null)).toBe('compact');
    expect(featureBuilderLayout('classic')).toBe('classic');
    expect(featureBuilderLayout('compact')).toBe('compact');
    expect(addRegionSuggested(true, false)).toBe(true);
    expect(addRegionSuggested(true, true)).toBe(false);
    expect(addRegionSuggested(false, false)).toBe(false);
    const html = compactStatHtml('ist', 'measured', '<svg></svg>', 'Flatness', '0.02', 'Std. dev.', '0.01');
    expect(html).toContain('>measured<');
    expect(html).not.toContain('Plane');
    expect(html).toContain('data-kv="form"');
    expect(html).toContain('data-kv="std"');
    expect(html).not.toContain('cp-brush');
    expect(SURFACE_HIGHLIGHT.opacity).toBeGreaterThanOrEqual(0.7);
  });
  it('lists Data, Reference, Features and Coordinate Systems at one level, with an eye, and pins only the first two', () => {
    expect(TREE_GROUPS.map((g) => g.name)).toEqual(['Data', 'Reference', 'Features', 'Coordinate Systems']);
    expect(new Set(TREE_GROUPS.map((g) => g.name)).size).toBe(4);
    expect(TREE_GROUPS.every((g) => g.eye)).toBe(true);
    expect(TREE_GROUPS.filter((g) => g.pin).map((g) => g.id)).toEqual(['data', 'ref']);
    expect(TREE_GROUPS.some((g) => g.name === 'Objects')).toBe(false);
  });
});

describe('IGES sample faces create plane, cylinder and sphere', () => {
  let faces: TessFace[] = [];
  beforeAll(async () => {
    const oc = await (await import('opencascade.js/dist/node.js' as any)).default();
    const sh = C.readCAD(oc, gunzipSync(new Uint8Array(fs.readFileSync('public/samples/cad-sample.igs.gz'))), 'cad-sample.igs');
    const loaded = C.loadDisplayFaces(oc, sh);
    faces = loaded.faces.map((f) => ({ id: f.id, geom: f.geom, positions: f.tess.positions, normals: f.tess.normals }));
  }, 180000);

  it('Auto and the explicit type both yield a confirmable analytic surface, never freeform', () => {
    const types = new Map<string, number>();
    for (const f of faces) {
      if (!f.positions || !f.geom) continue;
      const mid = f.geom.origin;
      const hit = nominalOnCad(faces, f.id, mid, 'auto', 0.4);
      const t = hit?.pick.fit.type;
      if (t) types.set(t, (types.get(t) ?? 0) + 1);
      expect(hit?.pick.freeform).not.toBe(true);
      expect(t).not.toBe('Freiformfläche');
    }
    expect(types.get('Ebene') ?? 0).toBeGreaterThan(0);
    expect(types.get('Zylinder') ?? 0).toBeGreaterThan(0);
    expect(types.get('Kugel') ?? 0).toBeGreaterThan(0);
    const plane = faces.find((f) => nominalOnCad(faces, f.id, f.geom!.origin, 'auto', 0.4)?.pick.fit.type === 'Ebene')!;
    expect(nominalOnCad(faces, plane.id, plane.geom!.origin, 'Ebene', 0.4)!.pick.fit.type).toBe('Ebene');
    const cyl = faces.find((f) => nominalOnCad(faces, f.id, f.geom!.origin, 'auto', 0.4)?.pick.fit.type === 'Zylinder')!;
    expect(nominalOnCad(faces, cyl.id, cyl.geom!.origin, 'Zylinder', 0.4)!.pick.fit.type).toBe('Zylinder');
    const sph = faces.find((f) => nominalOnCad(faces, f.id, f.geom!.origin, 'auto', 0.4)?.pick.fit.type === 'Kugel')!;
    expect(nominalOnCad(faces, sph.id, sph.geom!.origin, 'Kugel', 0.4)!.pick.fit.type).toBe('Kugel');
    const anywhere = nominalOnCad(faces, plane.id, [plane.geom!.origin[0] + 1, plane.geom!.origin[1], plane.geom!.origin[2]], 'Punkt', 2)!;
    expect(anywhere.pick.fit.type).toBe('Punkt');
  }, 180000);
});
