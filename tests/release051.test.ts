import { describe, expect, it } from 'vitest';
import { tumble } from '../src/core/tumble';
import { dot, norm, unit, type Vec3 } from '../src/core/linalg';
import { facePatch, loopsFromMesh } from '../src/core/facetrim';
import { applyComputedNominal, editNominal, nominalIsModified, nominalOfFit, resetNominal } from '../src/core/nominalvalue';
import { boundaryExclusionFor, fbActionOn, featureBuilderHost, showPickRing } from '../src/core/nominalui';
import { createFromAnalytic, defaultDisplayDeflection, resolveTess } from '../src/cad/tesspolicy';
import { importTarget } from '../src/core/importpath';
import type { FitResult } from '../src/core/fit';

const fit = (over: Partial<FitResult> & { type: FitResult['type'] }): FitResult => ({
  center: [0, 0, 0], normal: [0, 0, 1], rms: 0, form: 0, maxPos: 0, maxNeg: 0, n: 0, ...over,
});

describe('2026.0.51 orbit, builder, import, nominals, trim', () => {
  it('tumbles more than one full turn about the horizontal screen axis', () => {
    const offset: Vec3 = [0, -100, 0];
    const up: Vec3 = [0, 0, 1];
    const half = tumble(offset, up, 0, Math.PI);
    expect(Math.abs(dot(unit(half.offset), up))).toBeLessThan(0.25);
    expect(half.offset[1]).toBeGreaterThan(50);
    let pose = { offset, up };
    for (let i = 0; i < 8; i++) pose = tumble(pose.offset, pose.up, 0, Math.PI / 2);
    expect(norm(pose.offset)).toBeCloseTo(100, 3);
    expect(pose.offset[1]).toBeCloseTo(-100, 1);
    expect(Math.abs(pose.offset[2])).toBeLessThan(2);
  });

  it('highlights Add region after a detect and never both buttons', () => {
    expect(fbActionOn(false, false)).toEqual({ smart: true, add: false });
    const after = fbActionOn(true, true);
    expect(after).toEqual({ smart: false, add: true });
    expect(after.smart && after.add).toBe(false);
    expect(featureBuilderHost(null)).toBe('dialog');
    expect(featureBuilderHost('classic')).toBe('dock');
    expect(showPickRing(true)).toBe(false);
    expect(showPickRing(false)).toBe(true);
    expect(boundaryExclusionFor(true)).toBe('enabled');
    expect(boundaryExclusionFor(false)).toBe('hidden');
  });

  it('routes IGES and STEP to Reference and keeps a mesh import as mesh', () => {
    expect(importTarget('part.igs')).toBe('reference');
    expect(importTarget('part.IGES.gz')).toBe('reference');
    expect(importTarget('a.stp')).toBe('reference');
    expect(importTarget('scan.stl')).toBe('mesh');
    expect(importTarget('cloud.xyz.gz')).toBe('mesh');
  });

  it('fills, marks and resets a nominal taken from the Soll fit', () => {
    const sphere = fit({ type: 'Kugel', radius: 12.5, diameter: 25, center: [1, 2, 3] });
    expect(nominalOfFit('Durchmesser', sphere)).toBe(25);
    expect(nominalOfFit('X', sphere)).toBe(1);
    const cyl = fit({ type: 'Zylinder', radius: 4, diameter: 8, length: 20, normal: [0, 0, 1] });
    expect(nominalOfFit('Durchmesser', cyl)).toBe(8);
    expect(nominalOfFit('Länge', cyl)).toBe(20);
    const slot = { nominal: null as number | null, nominalFrom: null as number | null, nominalEdited: false };
    applyComputedNominal(slot, 25);
    expect(slot.nominal).toBe(25);
    expect(nominalIsModified(slot)).toBe(false);
    editNominal(slot, 26);
    expect(nominalIsModified(slot)).toBe(true);
    expect(slot.nominal).toBe(26);
    resetNominal(slot);
    expect(slot.nominal).toBe(25);
    expect(nominalIsModified(slot)).toBe(false);
  });

  it('trims a plane to the face loop instead of an infinite patch', () => {
    const plane = fit({ type: 'Ebene', center: [0, 0, 0], normal: [0, 0, 1] });
    const loop: Vec3[] = [[-5, -5, 0], [5, -5, 0], [5, 5, 0], [-5, 5, 0]];
    const patch = facePatch(plane, [loop], 8)!;
    expect(patch.tri.length).toBeGreaterThan(9);
    for (let i = 0; i < patch.tri.length; i += 3) {
      expect(Math.abs(patch.tri[i])).toBeLessThanOrEqual(5.2);
      expect(Math.abs(patch.tri[i + 1])).toBeLessThanOrEqual(5.2);
      expect(Math.abs(patch.tri[i + 2])).toBeLessThan(0.2);
    }
    const pos = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
    const idx = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const loops = loopsFromMesh(pos, idx);
    expect(loops.length).toBeGreaterThan(0);
    expect(loops[0].length).toBeGreaterThanOrEqual(3);
  });

  it('keeps create on the analytic face and coarsens only the display mesh', () => {
    expect(createFromAnalytic('Ebene')).toBe(true);
    expect(createFromAnalytic('Zylinder')).toBe(true);
    expect(createFromAnalytic('NURBS')).toBe(false);
    const d = defaultDisplayDeflection(360);
    expect(d.linear).toBeGreaterThan(0.75);
    expect(d.linear).toBeLessThanOrEqual(1.25);
    const custom = resolveTess(360, { linear: 0.4, angular: 0.5, relative: false });
    expect(custom.linear).toBeCloseTo(0.4);
    expect(custom.angular).toBeCloseTo(0.5);
  });
});
