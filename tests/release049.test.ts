import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import { gunzipSync } from 'fflate';
import * as C from '../src/cad/occcore';
import { classifyCurvePoints } from '../src/cad/curvetype';
import { edgeWindowMm } from '../src/ui/cadpick';
import { nominalAtPointer, nominalFromCad, type CadAnalytic, type CadCurve } from '../src/core/cadnominal';
import { featureClass, nominalCanConfirm, nominalDraft, nominalMethodRow } from '../src/core/nominalui';

const plane = (edges: CadCurve[], idExtra: Partial<CadAnalytic> = {}): CadAnalytic =>
  ({ type: 'Ebene', origin: [0, 0, 0], normal: [0, 0, 1], edges, ...idExtra });

describe('spline edges become lines and circles', () => {
  it('classifies a straight sample as a line and a circular sample as a circle', () => {
    const line = classifyCurvePoints([[0, 0, 0], [5, 0, 0], [10, 0.02, 0], [20, 0, 0]]);
    expect(line?.kind).toBe('line');
    expect(line?.a?.[0]).toBeCloseTo(0);
    expect(line?.b?.[0]).toBeCloseTo(20);
    const arc: [number, number, number][] = [];
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * (0.2 + 0.6 * i / 8);
      arc.push([10 * Math.cos(a), 10 * Math.sin(a), 0]);
    }
    const circle = classifyCurvePoints(arc);
    expect(circle?.kind).toBe('circle');
    expect(circle?.radius).toBeCloseTo(10, 1);
    expect(classifyCurvePoints([[0, 0, 0], [1, 0.4, 0.2], [2, -0.3, 0.5], [3, 0.8, -0.4], [4, 0, 0.7]])).toBeNull();
  });

  it('a NURBS face whose boundary was a spline still yields a nominal curve', () => {
    const straight = classifyCurvePoints([[0, 0, 0], [10, 0, 0], [20, 0, 0]])!;
    const face: CadAnalytic = { type: 'NURBS', origin: [10, 5, 0], normal: [0, 0, 1], edges: [straight] };
    const line = nominalFromCad(face, [10, 0.2, 0], 'auto', 2)!;
    expect(line.fit.type).toBe('Linie');
    expect(featureClass(line.fit.type)).toBe('curve');
    const poly = nominalFromCad(face, [10, 0.2, 0], 'Linienzug', 2)!;
    expect(poly.fit.type).toBe('Linienzug');
    expect(poly.fit.pts!.length).toBeGreaterThanOrEqual(2);
    expect(nominalDraft(poly.fit, 3).soll.fit?.type).toBe('Linienzug');
  });
});

describe('pointer nominal: edge, neighbour, explicit line', () => {
  const edged = plane([{ kind: 'line', mid: [5, 0, 0], length: 10, a: [0, 0, 0], b: [10, 0, 0] }]);
  const disk = plane([{ kind: 'circle', mid: [10, 0, 0], length: 60, center: [0, 0, 0], normal: [0, 0, 1], radius: 10 }]);
  const bare = plane([]);
  const faces = [
    { id: 0, geom: bare },
    { id: 1, geom: disk },
    { id: 2, geom: edged },
  ];

  it('auto on the interior stays a surface; an edge or the neighbouring face becomes the curve', () => {
    expect(nominalAtPointer(faces, 2, [5, 5, 0], 'auto', 2)!.pick.fit.type).toBe('Ebene');
    expect(nominalAtPointer(faces, 2, [5, 0.3, 0], 'auto', 2)!.pick.fit.type).toBe('Linie');
    const near = nominalAtPointer(faces, 0, [0, 9.6, 0], 'auto', 2)!;
    expect(near.pick.fit.type).toBe('Kreis');
    expect(near.id).toBe(1);
    expect(featureClass(near.pick.fit.type)).toBe('curve');
  });

  it('explicit line matches explicit circle: the face’s geometry, and a neighbour within the window', () => {
    const mid = nominalAtPointer(faces, 2, [5, 5, 0], 'Linie', 2)!;
    expect(mid.id).toBe(2);
    expect(mid.pick.fit.type).toBe('Linie');
    expect(nominalFromCad(edged, [5, 5, 0], 'Linie', 2)).toBeNull();
    const side = nominalAtPointer(faces, 0, [5, 0.4, 0], 'Linie', 2)!;
    expect(side.pick.fit.type).toBe('Linie');
    expect(side.id).toBe(2);
    const circle = nominalAtPointer([{ id: 7, geom: disk }], 7, [0, 0, 0], 'Kreis', 2)!;
    expect(circle.pick.fit.type).toBe('Kreis');
  });

  it('confirms a curve nominal the same way as a surface', () => {
    expect(nominalCanConfirm({ role: 'soll' }, null)).toBe(true);
    expect(nominalCanConfirm(null, { type: 'Kreis' })).toBe(true);
    expect(nominalCanConfirm(null, { type: 'Linie' })).toBe(true);
    expect(nominalCanConfirm(null, null)).toBe(false);
  });
});

describe('create menus and the finger edge window', () => {
  it('circle and line share a menu; polyline keeps From CAD and drops the later stub', () => {
    const avail = { con: true, anchor: true };
    expect(nominalMethodRow('Kreis', avail)).toEqual(nominalMethodRow('Linie', avail));
    expect(nominalMethodRow('Langloch', avail).map((r) => r.key)).toEqual(nominalMethodRow('Linie', avail).map((r) => r.key));
    const poly = nominalMethodRow('Linienzug', avail);
    expect(poly.map((r) => r.key)).toEqual(['mesh', 'con', 'anchor', 'cad', 'derive']);
    expect(poly.find((r) => r.key === 'cad')!.enabled).toBe(true);
    expect(poly.find((r) => r.key === 'mesh')!.enabled).toBe(false);
    expect(poly.some((r) => r.key === 'later' as string)).toBe(false);
  });

  it('a finger widens the edge window; a mouse does not', () => {
    expect(edgeWindowMm(4, 0.5, false)).toBe(4);
    expect(edgeWindowMm(4, 0.5, true)).toBeCloseTo(5);
    expect(edgeWindowMm(4, 2, true)).toBe(10);
    expect(edgeWindowMm(8, 0.83, true)).toBeCloseTo(8.3);
    expect(edgeWindowMm(2, 0.05, true)).toBe(2);
  });
});

describe('IGES sample edges are nominal curves', () => {
  let geoms: CadAnalytic[] = [];
  let nativeCurves = 0;
  beforeAll(async () => {
    const oc = await (await import('opencascade.js/dist/node.js' as any)).default();
    const sh = C.readCAD(oc, gunzipSync(new Uint8Array(fs.readFileSync('public/samples/cad-sample.igs.gz'))), 'cad-sample.igs');
    const CT = oc.GeomAbs_CurveType;
    const fs_ = C.faces(oc, sh);
    geoms = fs_.map((f) => C.faceAnalytic(oc, f));
    for (const f of fs_) {
      const ex = new oc.TopExp_Explorer_2(f, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      for (; ex.More(); ex.Next()) {
        const e = oc.TopoDS.Edge_1(ex.Current());
        if (oc.BRep_Tool.Degenerated(e) || oc.BRep_Tool.IsClosed_2(e, f)) continue;
        const c = new oc.BRepAdaptor_Curve_2(e);
        const ty = c.GetType();
        c.delete?.();
        if (ty === CT.GeomAbs_Line || ty === CT.GeomAbs_Circle) nativeCurves++;
      }
      ex.delete();
    }
  }, 180000);
  it('spline boundaries include a line and a circle that Auto and an explicit type can confirm', () => {
    const recognised = geoms.reduce((n, g) => n + g.edges.filter((e) => e.kind === 'line' || e.kind === 'circle').length, 0);
    expect(recognised, `recognised ${recognised} native ${nativeCurves}`).toBeGreaterThan(nativeCurves);
    const edges = geoms.flatMap((g) => g.edges);
    const lines = edges.filter((e) => e.kind === 'line').length;
    const circles = edges.filter((e) => e.kind === 'circle').length;
    expect(lines).toBeGreaterThan(0);
    expect(circles).toBeGreaterThan(0);
    const faces = geoms.map((geom, id) => ({ id, geom }));
    const lineFace = geoms.findIndex((g) => g.edges.some((e) => e.kind === 'line' && e.a && e.b));
    const lineEdge = geoms[lineFace].edges.find((e) => e.kind === 'line' && e.a && e.b)!;
    const lineHit = nominalAtPointer(faces, lineFace, lineEdge.mid, 'auto', 2)!;
    expect(lineHit.pick.fit.type).toBe('Linie');
    expect(nominalAtPointer(faces, lineFace, lineEdge.mid, 'Linie', 2)!.pick.fit.type).toBe('Linie');
    expect(nominalAtPointer(faces, lineFace, lineEdge.mid, 'Linienzug', 2)!.pick.fit.type).toBe('Linienzug');
    const circFace = geoms.findIndex((g) => g.edges.some((e) => e.kind === 'circle' && e.center));
    const circ = geoms[circFace].edges.find((e) => e.kind === 'circle' && e.center)!;
    const circHit = nominalAtPointer(faces, circFace, circ.mid, 'auto', 2)!;
    expect(['Kreis', 'Langloch']).toContain(circHit.pick.fit.type);
    expect(nominalAtPointer(faces, circFace, circ.mid, 'Kreis', 2)!.pick.fit.type).toBe('Kreis');
    expect(nominalCanConfirm({ role: 'soll' }, null)).toBe(true);
  });
});
