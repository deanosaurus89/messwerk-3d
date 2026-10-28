// 2026.0.46: Geometry boundary, Smart Detect type, measured/nominal labels,
// tree menu parity, CAD nominal confirm record, orientation, nominal ∩ nominal.
import { describe, expect, it } from 'vitest';
import { boundaryKind, coneDisplayShell, cylinderDisplayShell, drawsPointHighlight, zoneSrcFor } from '../src/core/geombound';
import { analyticShell, analyticSphere, trimmedSurface } from '../src/core/trim';
import { detectBadge, featureClass, nominalAdvancedControls, nominalDraft, orientationOf, roleWord, scanControls, smartDetectLabel } from '../src/core/nominalui';
import { nominalFromCad, type CadAnalytic, type CadCurve } from '../src/core/cadnominal';
import { constructionIsNominal, parentFit, runConstruction } from '../src/core/construct';
import { asNode, nodeToJSON } from '../src/core/featuremodel';
import { canDelete, treeMenuIds } from '../src/core/treemenu';
import type { FitResult } from '../src/core/fit';

const Z = { rms: 0, form: 0, maxPos: 0, maxNeg: 0, n: 0 };

describe('Feature Builder labels and Smart Detect type', () => {
  it('says measured and nominal, not Ist/Soll', () => {
    expect(roleWord('ist')).toBe('measured');
    expect(roleWord('soll')).toBe('nominal');
    expect(roleWord('ist')).not.toMatch(/Ist|Soll/);
    expect(roleWord('soll')).not.toMatch(/Ist|Soll/);
  });
  it('Smart Detect shows the English geometry type', () => {
    const names: [string, string][] = [
      ['Ebene', 'Plane'], ['Kreis', 'Circle'], ['Zylinder', 'Cylinder'], ['Kegel', 'Cone'],
      ['Kugel', 'Sphere'], ['Torus', 'Torus'], ['Freiformfläche', 'Freeform surface'],
      ['Langloch', 'Slot'], ['Linie', 'Line'],
    ];
    for (const [k, en] of names) {
      expect(smartDetectLabel(k)).toBe(en);
      expect(detectBadge(k)).toContain(`data-detected="${k}"`);
      expect(detectBadge(k)).toContain(en);
    }
  });
});

describe('Boundary from Geometry does not fall back to the point highlight', () => {
  for (const t of ['Kegel', 'Zylinder', 'Kugel', 'Torus']) {
    it(`${t}: Geometry is analytic, Points is the selection`, () => {
      expect(boundaryKind(t, 'geom')).toBe('analytic');
      expect(boundaryKind(t, 'points')).toBe('selection');
      expect(drawsPointHighlight(t, 'geom')).toBe(false);
      expect(drawsPointHighlight(t, 'points')).toBe(true);
      expect(zoneSrcFor(t, 'geom', false)).toBe('geom');
    });
  }

  it('cone Geometry is the mesh frustum, not the selected ring', () => {
    const a = (18 * Math.PI) / 180, na = 36, hs = [10, 14, 18, 22, 26, 30];
    const pos: number[] = []; const rows: number[][] = [];
    for (const h of hs) {
      const row: number[] = [], r = h * Math.tan(a);
      const off = h === 22 ? 0 : 0.6; // only the click ring sits inside the tight 0.35 mm band
      for (let i = 0; i < na; i++) {
        const t = (2 * Math.PI * i) / na;
        row.push(pos.length / 3);
        pos.push((r + off) * Math.cos(t), (r + off) * Math.sin(t), h);
      }
      rows.push(row);
    }
    const tm = 20;
    const fit: FitResult = {
      type: 'Kegel', center: [0, 0, tm], normal: [0, 0, 1], apex: [0, 0, 0], halfAngle: a,
      radius: tm * Math.tan(a), length: 4, ...Z, n: na,
    };
    const mid = Uint32Array.from(rows[3]);
    const P = new Float32Array(pos);
    const ring = analyticShell(fit, P, mid);
    const geom = coneDisplayShell(fit, P, mid);
    expect(ring.t1 - ring.t0).toBeLessThan(2);
    expect(geom.t1 - geom.t0).toBeGreaterThan(15);
    expect(geom.closed).toBe(true);
    // the point-highlight surface is only the selected triangles; Geometry is not that patch
    const tris: number[] = [];
    for (let i = 0; i < na; i++) tris.push(rows[3][i], rows[3][(i + 1) % na], rows[2][i]);
    const band = Uint32Array.from([...rows[2], ...rows[3]]);
    const sel = trimmedSurface(fit, P, Uint32Array.from(tris), band);
    expect(sel.tri.length).toBeGreaterThan(0);
    expect(geom.tri.length).toBeGreaterThan(sel.tri.length * 2);
    expect(drawsPointHighlight('Kegel', 'geom')).toBe(false);
  });

  it('cylinder Geometry is a full turn over the point height, not the half-wall highlight', () => {
    const na = 36, pos: number[] = [], rows: number[][] = [];
    for (const h of [0, 5, 10]) {
      const row: number[] = [];
      for (let i = 0; i < na; i++) {
        const t = (2 * Math.PI * i) / na;
        row.push(pos.length / 3);
        pos.push(10 * Math.cos(t), 10 * Math.sin(t), h);
      }
      rows.push(row);
    }
    for (let i = 0; i < na; i++) pos.push(10 * Math.cos((2 * Math.PI * i) / na), 10 * Math.sin((2 * Math.PI * i) / na), 100);
    const P = new Float32Array(pos);
    const half = Uint32Array.from(rows[1].filter((_, i) => i < na / 2));
    const fit: FitResult = { type: 'Zylinder', center: [0, 0, 5], normal: [0, 0, 1], radius: 10, ...Z, n: half.length };
    const pts = analyticShell(fit, P, half);
    const wall = cylinderDisplayShell(fit, P, half);
    expect(pts.closed).toBe(false);
    expect(wall.closed).toBe(true);
    expect(wall.t1 - wall.t0).toBeLessThan(2);
    expect(drawsPointHighlight('Zylinder', 'geom')).toBe(false);
  });

  it('an open cylinder wall stays an arc', () => {
    const na = 36, pos: number[] = [], half: number[] = [];
    for (let i = 0; i < na / 2; i++) {
      const t = (Math.PI * i) / (na / 2);
      half.push(pos.length / 3);
      pos.push(10 * Math.cos(t), 10 * Math.sin(t), 5);
    }
    const fit: FitResult = { type: 'Zylinder', center: [0, 0, 5], normal: [0, 0, 1], radius: 10, ...Z, n: half.length };
    const wall = cylinderDisplayShell(fit, new Float32Array(pos), Uint32Array.from(half));
    expect(wall.closed).toBe(false);
    expect(wall.a1 - wall.a0).toBeLessThan(Math.PI * 1.4);
  });

  it('sphere Geometry is the complete sphere, not the selected cap', () => {
    const fit: FitResult = { type: 'Kugel', center: [0, 0, 0], normal: [0, 0, 1], radius: 10, ...Z, n: 3 };
    const s = analyticSphere(fit);
    let z0 = Infinity, z1 = -Infinity;
    for (let i = 2; i < s.tri.length; i += 3) { z0 = Math.min(z0, s.tri[i]); z1 = Math.max(z1, s.tri[i]); }
    expect(z0).toBeLessThan(-9);
    expect(z1).toBeGreaterThan(9);
    expect(boundaryKind('Kugel', 'geom')).toBe('analytic');
    expect(boundaryKind('Torus', 'geom')).toBe('analytic');
  });
});

describe('CAD nominal confirm, class, orientation', () => {
  it('hides fit criterion and the normal angle; brush radius stays', () => {
    expect(scanControls(true)).toEqual({ fitCriterion: false, normalAngle: false, brushRadius: true });
    const html = nominalAdvancedControls(3);
    expect(html).toContain('cp-brush');
    expect(html).not.toContain('Fit criterion');
    expect(html).not.toContain('Normal angle');
    expect(scanControls(false).fitCriterion).toBe(true);
    expect(scanControls(false).normalAngle).toBe(true);
  });

  it('a confirmed nominal is a tree entry with no measured fit', () => {
    const plane: CadAnalytic = { type: 'Ebene', origin: [0, 0, 10], normal: [0, 0, -1], edges: [] };
    const nom = nominalFromCad(plane, [1, 2, 10], 'auto', 2)!;
    expect(nom.fit.type).toBe('Ebene');
    expect(nom.fit.normal[2]).toBeCloseTo(-1);
    const d = nominalDraft(nom.fit, 4);
    expect(d.measured).toBeUndefined();
    expect(d.class).toBe('surface');
    expect(d.soll.fit?.type).toBe('Ebene');
    expect(d.soll.source).toBe('cad');
    expect(d.orientation[2]).toBeCloseTo(-1);
    const node = asNode({ id: 1, name: 'Plane 1', type: 'Ebene', pointCount: 0, method: 'Klick', color: 1, indices: new Uint32Array(0) });
    (node as { soll?: unknown }).soll = d.soll;
    const json = nodeToJSON(node);
    expect((json.soll as { fit: { normal: number[] } }).fit.normal[2]).toBeCloseTo(-1);
    expect((json.ist as { fit?: unknown }).fit).toBeUndefined();
  });

  it('curve features (circle, line, slot) and surface features both confirm', () => {
    const edges: CadCurve[] = [
      { kind: 'line', mid: [5, 0, 0], length: 10, a: [0, 0, 0], b: [10, 0, 0] },
      { kind: 'circle', mid: [10, 0, 0], length: 20, center: [0, 0, 0], normal: [0, 0, 1], radius: 10 },
    ];
    const face: CadAnalytic = { type: 'Ebene', origin: [0, 0, 0], normal: [0, 0, 1], edges };
    const circle = nominalFromCad(face, [10, 0, 0.2], 'auto', 2)!;
    expect(circle.fit.type).toBe('Kreis');
    expect(featureClass(circle.fit.type)).toBe('curve');
    expect(nominalDraft(circle.fit).soll.fit?.type).toBe('Kreis');
    const line = nominalFromCad(face, [5, 0.2, 0], 'Linie', 2)!;
    expect(line.fit.type).toBe('Linie');
    expect(featureClass(line.fit.type)).toBe('curve');
    expect(orientationOf(line.fit)[0]).toBeCloseTo(1);
    const slotEdges: CadCurve[] = [
      { kind: 'line', mid: [0, 5, 0], length: 20, a: [-10, 5, 0], b: [10, 5, 0] },
      { kind: 'line', mid: [0, -5, 0], length: 20, a: [10, -5, 0], b: [-10, -5, 0] },
      { kind: 'circle', mid: [10, 0, 0], length: Math.PI * 5, center: [10, 0, 0], normal: [0, 0, 1], radius: 5 },
      { kind: 'circle', mid: [-10, 0, 0], length: Math.PI * 5, center: [-10, 0, 0], normal: [0, 0, 1], radius: 5 },
    ];
    const slot = nominalFromCad({ type: 'Ebene', origin: [0, 0, 0], normal: [0, 0, 1], edges: slotEdges }, [10, 5, 0.2], 'auto', 2)!;
    expect(slot.fit.type).toBe('Langloch');
    expect(featureClass(slot.fit.type)).toBe('curve');
    expect(featureClass('Zylinder')).toBe('surface');
  });

  it('stores a downward cylinder axis instead of flipping it', () => {
    const face: CadAnalytic = { type: 'Zylinder', origin: [0, 0, 0], normal: [0, 0, -1], radius: 5, t0: 0, t1: 20, edges: [] };
    const n = nominalFromCad(face, [5, 0, -10], 'Zylinder', 2)!;
    expect(n.fit.normal[2]).toBeCloseTo(-1);
    expect(orientationOf(n.fit)[2]).toBeCloseTo(-1);
    const measured: FitResult = { type: 'Ebene', center: [0, 0, 1], normal: [0, 0, 1], ...Z };
    expect(orientationOf(measured)[2]).toBeCloseTo(1);
    const node = asNode({ id: 2, name: 'Plane 2', type: 'Ebene', pointCount: 4, method: 'Klick', measured, color: 1, indices: new Uint32Array([0, 1, 2, 3]) });
    expect((nodeToJSON(node).ist as { fit: { normal: number[] } }).fit.normal[2]).toBeCloseTo(1);
  });
});

describe('nominal plane ∩ nominal plane → dependent nominal line', () => {
  const pl = (c: number[], n: number[]) => ({ type: 'Ebene' as const, center: c as [number, number, number], normal: n as [number, number, number], ...Z });
  it('two nominal planes construct a nominal line and keep the dependency', () => {
    const a = { id: 1, measured: undefined, soll: { fit: pl([0, 0, 5], [0, 0, 1]) } };
    const b = { id: 2, measured: undefined, soll: { fit: pl([2, 0, 0], [1, 0, 0]) } };
    expect(constructionIsNominal([a, b])).toBe(true);
    expect(constructionIsNominal([{ measured: pl([0, 0, 0], [0, 0, 1]), soll: undefined }, b])).toBe(false);
    const fit = runConstruction('ln-planes', [parentFit(a, true)!, parentFit(b, true)!], {});
    expect(fit.type).toBe('Linie');
    expect(fit.direction![1]).toBeCloseTo(1);
    expect(fit.center[0]).toBeCloseTo(2);
    expect(fit.center[2]).toBeCloseTo(5);
    const node = asNode({ id: 3, name: 'Line 1', type: 'Linie', pointCount: 0, method: 'Konstruiert', color: 1, indices: new Uint32Array(0), refs: [1, 2], cons: { key: 'ln-planes', refs: [1, 2], params: {} } });
    (node as { soll?: unknown }).soll = { source: 'constructed', fit, method: 'Konstruiert' };
    const json = nodeToJSON(node) as { soll: { source: string; fit: { type: string } }; cons: { refs: number[] }; refs: number[] };
    expect(json.soll.source).toBe('constructed');
    expect(json.soll.fit.type).toBe('Linie');
    expect(json.cons.refs).toEqual([1, 2]);
    expect(json.refs).toEqual([1, 2]);
    expect((json as unknown as { ist: { fit?: unknown } }).ist.fit).toBeUndefined();
  });
});

describe('tree context menu parity', () => {
  for (const t of ['feature', 'measured', 'nominal', 'data', 'reference', 'cad-face'] as const) {
    it(`${t} has Center, Properties, opacity and Delete`, () => {
      const ids = treeMenuIds(t);
      expect(ids).toContain('center');
      expect(ids).toContain('properties');
      expect(ids).toContain('opacity');
      expect(ids).toContain('delete');
      expect(canDelete(t)).toBe(true);
    });
  }
  it('the global coordinate system is not deleted', () => {
    expect(canDelete('wcs')).toBe(false);
    expect(treeMenuIds('curve')).toContain('delete');
    expect(treeMenuIds('report')).toContain('delete');
    expect(treeMenuIds('csys')).toContain('delete');
  });
});
