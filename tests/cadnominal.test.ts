// CAD nominal (Soll): hit classification, Auto vs override, and Ist extraction seeded by the nominal.
import { describe, it, expect, beforeAll } from 'vitest';
import { creationSide, detectSlot, distCircle, extractFromNominal, nearerTarget, nominalFromCad, type CadAnalytic, type CadCurve } from '../src/core/cadnominal';
import * as C from '../src/cad/occcore';

const Z = { rms: 0, form: 0, maxPos: 0, maxNeg: 0, n: 0 };
const plane = (origin: [number, number, number], normal: [number, number, number], edges: CadCurve[] = []): CadAnalytic =>
  ({ type: 'Ebene', origin, normal, edges });

describe('Soll/Ist choice', () => {
  it('Nominal and Measured are explicit — the nearer surface does not choose', () => {
    expect(creationSide({ cad: true, mesh: true, cadCloser: true }, 'soll')).toBe('soll');
    expect(creationSide({ cad: true, mesh: true, cadCloser: false }, 'soll')).toBe('soll');
    expect(creationSide({ cad: true, mesh: false, cadCloser: true }, 'soll')).toBe('soll');
    expect(creationSide({ cad: false, mesh: true, cadCloser: false }, 'soll')).toBeNull();
    expect(creationSide({ cad: true, mesh: true, cadCloser: true }, 'ist')).toBe('ist');
    expect(creationSide({ cad: false, mesh: true, cadCloser: false }, 'ist')).toBe('ist');
    expect(creationSide({ cad: true, mesh: false, cadCloser: true }, 'ist')).toBeNull();
    expect(creationSide({ cad: false, mesh: false, cadCloser: false }, 'ist')).toBeNull();
  });
  it('override forces one side and ignores the other target', () => {
    expect(creationSide({ cad: false, mesh: true, cadCloser: false }, 'soll')).toBeNull();
    expect(creationSide({ cad: true, mesh: true, cadCloser: false }, 'soll')).toBe('soll');
    expect(creationSide({ cad: true, mesh: false, cadCloser: true }, 'ist')).toBeNull();
    expect(creationSide({ cad: true, mesh: true, cadCloser: true }, 'ist')).toBe('ist');
  });
  it('equal ray distance prefers the CAD surface', () => {
    expect(nearerTarget(4, 4)).toBe('cad');
    expect(nearerTarget(2, 5)).toBe('cad');
    expect(nearerTarget(8, 3)).toBe('mesh');
    expect(nearerTarget(null, 1)).toBe('mesh');
    expect(nearerTarget(1, null)).toBe('cad');
  });
});

describe('nominal from a described face', () => {
  const disk: CadAnalytic = plane([0, 0, 10], [0, 0, 1], [
    { kind: 'circle', mid: [10, 0, 10], length: 2 * Math.PI * 10, center: [0, 0, 10], normal: [0, 0, 1], radius: 10 },
  ]);
  it('planar interior is a plane, the circular edge is a circle', () => {
    const mid = nominalFromCad(disk, [1, 1, 10], 'auto', 2)!;
    expect(mid.fit.type).toBe('Ebene');
    expect(mid.fit.normal[2]).toBeCloseTo(1);
    expect(Math.abs(mid.fit.center[2] - 10)).toBeLessThan(1e-6);
    const rim = nominalFromCad(disk, [10, 0, 10.4], 'auto', 2)!;
    expect(rim.fit.type).toBe('Kreis');
    expect(rim.fit.radius).toBeCloseTo(10);
    expect(rim.aux?.type).toBe('Ebene');
    expect(distCircle([10, 0, 10.4], [0, 0, 10], [0, 0, 1], 10)).toBeCloseTo(0.4);
  });
  it('Auto does not offer freeform; an explicit Freeform type does; an edge of a plane is a line', () => {
    const ff: CadAnalytic = { type: 'NURBS', origin: [1, 2, 3], normal: [0, 0, 1], edges: [] };
    expect(nominalFromCad(ff, [1, 2, 3], 'auto', 2)).toBeNull();
    const typed = nominalFromCad(ff, [1, 2, 3], 'Freiformfläche', 2)!;
    expect(typed.freeform).toBe(true);
    expect(typed.fit.type).toBe('Freiformfläche');
    const edged: CadAnalytic = plane([0, 0, 0], [0, 0, 1], [
      { kind: 'line', mid: [5, 0, 0], length: 10, a: [0, 0, 0], b: [10, 0, 0] },
    ]);
    expect(nominalFromCad(edged, [5, 0.2, 0], 'auto', 2)!.fit.type).toBe('Linie');
    expect(nominalFromCad(edged, [5, 5, 0], 'auto', 2)!.fit.type).toBe('Ebene');
    expect(nominalFromCad(edged, [5, 5, 0], 'Linienzug', 2)).toBeNull();
    const chain: CadAnalytic = plane([0, 0, 0], [0, 0, 1], [
      { kind: 'line', mid: [5, 0, 0], length: 10, a: [0, 0, 0], b: [10, 0, 0] },
      { kind: 'line', mid: [15, 0, 0], length: 10, a: [10, 0, 0], b: [20, 0, 0] },
      { kind: 'line', mid: [20, 5, 0], length: 10, a: [20, 0, 0], b: [20, 10, 0] },
    ]);
    const poly = nominalFromCad(chain, [5, 0.1, 0], 'Linienzug', 2)!;
    expect(poly.fit.type).toBe('Linienzug');
    expect(poly.fit.pts!.length).toBe(3);
    expect(poly.fit.length).toBeCloseTo(20);
  });
  it('explicit Kreis uses the circular edge even away from it; explicit Ebene stays a plane', () => {
    expect(nominalFromCad(disk, [0, 0, 10], 'Kreis', 2)!.fit.type).toBe('Kreis');
    expect(nominalFromCad(disk, [10, 0, 10], 'Ebene', 2)!.fit.type).toBe('Ebene');
    expect(nominalFromCad(disk, [0, 0, 10], 'Zylinder', 2)).toBeNull();
  });
  it('slot contour near the edge, plane in the middle of the floor', () => {
    const edges: CadCurve[] = [
      { kind: 'line', mid: [0, 5, 0], length: 20, a: [-10, 5, 0], b: [10, 5, 0] },
      { kind: 'line', mid: [0, -5, 0], length: 20, a: [10, -5, 0], b: [-10, -5, 0] },
      { kind: 'circle', mid: [10, 0, 0], length: Math.PI * 5, center: [10, 0, 0], normal: [0, 0, 1], radius: 5 },
      { kind: 'circle', mid: [-10, 0, 0], length: Math.PI * 5, center: [-10, 0, 0], normal: [0, 0, 1], radius: 5 },
    ];
    const face = plane([0, 0, 0], [0, 0, 1], edges);
    expect(detectSlot(edges)?.length).toBeCloseTo(30);
    expect(detectSlot(edges)?.width).toBeCloseTo(10);
    expect(nominalFromCad(face, [10, 5, 0.2], 'auto', 2)!.fit.type).toBe('Langloch');
    expect(nominalFromCad(face, [0, 0, 0], 'auto', 2)!.fit.type).toBe('Ebene');
    const typed = nominalFromCad(face, [0, 0, 0], 'Langloch', 2)!;
    expect(typed.fit.type).toBe('Langloch');
    expect(typed.fit.length).toBeCloseTo(30);
    expect(typed.fit.width).toBeCloseTo(10);
  });
});

describe('Ist from a nominal plane', () => {
  it('collects scan points near the nominal and fits a plane', () => {
    const fit = { type: 'Ebene' as const, center: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], ...Z };
    const pos: number[] = [], nrm: number[] = [];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      pos.push(i * 2, j * 2, (i + j) % 5 === 0 ? 0.2 : 0);
      nrm.push(0, 0, 1);
    }
    // a point far from the face must stay out
    pos.push(100, 100, 0); nrm.push(0, 0, 1);
    const seed = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 10, 0]] as [number, number, number][];
    const r = extractFromNominal(fit, seed, new Float32Array(pos), new Float32Array(nrm), null, null, 1);
    expect(r.indices.length).toBeGreaterThanOrEqual(30);
    expect(r.indices.length).toBeLessThan(pos.length / 3);
    expect(r.fit.type).toBe('Ebene');
    expect(Math.abs(r.fit.normal[2])).toBeGreaterThan(0.99);
    expect(Math.abs(r.fit.center[2])).toBeLessThan(0.3);
  });
});

describe('analytic CAD hit (OpenCascade)', () => {
  let oc: any;
  beforeAll(async () => { oc = await (await import('opencascade.js/dist/node.js' as any)).default(); }, 120000);
  it('box top face → plane, cylinder wall → cylinder, rim → circle, sphere → sphere', () => {
    const box = new oc.BRepPrimAPI_MakeBox_3(new oc.gp_Pnt_3(0, 0, 0), 100, 50, 10).Shape();
    const top = C.faces(oc, box).map((f) => ({ f, g: C.faceAnalytic(oc, f) })).sort((a, b) => b.g.origin[2] - a.g.origin[2])[0];
    expect(top.g.type).toBe('Ebene');
    const mid = nominalFromCad(top.g, [40, 20, 10], 'auto', 2)!;
    expect(mid.fit.type).toBe('Ebene');
    expect(Math.abs(mid.fit.normal[2])).toBeGreaterThan(0.99);
    expect(Math.abs(mid.fit.center[2] - 10)).toBeLessThan(1e-3);

    const cylSh = new oc.BRepPrimAPI_MakeCylinder_1(10, 40).Shape();
    const wall = C.faces(oc, cylSh).map((f) => C.faceAnalytic(oc, f)).find((g) => g.type === 'Zylinder')!;
    expect(wall.radius).toBeCloseTo(10, 3);
    const onWall = nominalFromCad(wall, [10, 0, 20], 'auto', 2)!;
    expect(onWall.fit.type).toBe('Zylinder');
    expect(onWall.fit.radius).toBeCloseTo(10, 3);
    expect(onWall.fit.length).toBeGreaterThan(30);
    const rim = nominalFromCad(wall, [10, 0, 39.2], 'auto', 2)!;
    expect(rim.fit.type).toBe('Kreis');
    expect(rim.fit.radius).toBeCloseTo(10, 3);
    expect(rim.fit.center[2]).toBeCloseTo(40, 1);

    const sph = new oc.BRepPrimAPI_MakeSphere_1(7).Shape();
    const sg = C.faces(oc, sph).map((f) => C.faceAnalytic(oc, f)).find((g) => g.type === 'Kugel')!;
    const ball = nominalFromCad(sg, [7, 0, 0], 'auto', 2)!;
    expect(ball.fit.type).toBe('Kugel');
    expect(ball.fit.radius).toBeCloseTo(7, 3);
  });
});
