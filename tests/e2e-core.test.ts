// End-to-End (Kern): Beispiel-STL laden, Merkmale per "Klick" (Saatdreieck) extrahieren, Prüfen.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSTL } from '../src/core/io';
import { MeshTopology, gather } from '../src/core/region';
import { autoFit, fitType, GeomType } from '../src/core/fit';
import type { Vec3 } from '../src/core/linalg';
import { evaluate, Feature, Control, computeDistance } from '../src/core/features';

const buf = readFileSync(new URL('../public/samples/beispielteil.stl', import.meta.url));
const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'beispielteil');
const topo = new MeshTopology(mesh);

function seed(pt: Vec3, nrm: Vec3): number {
  const p = mesh.positions, f = mesh.indices, fn = mesh.faceNormals!;
  let best = -1, bd = Infinity;
  for (let t = 0; t < f.length / 3; t++) {
    if (fn[3 * t] * nrm[0] + fn[3 * t + 1] * nrm[1] + fn[3 * t + 2] * nrm[2] < 0.5) continue;
    let d = 0;
    for (let k = 0; k < 3; k++) { const c = (p[3 * f[3 * t]] + p[3 * f[3 * t + 1]] + p[3 * f[3 * t + 2]]) / 3 - 0; void c; }
    const cx = (p[3 * f[3 * t]] + p[3 * f[3 * t + 1]] + p[3 * f[3 * t + 2]]) / 3;
    const cy = (p[3 * f[3 * t] + 1] + p[3 * f[3 * t + 1] + 1] + p[3 * f[3 * t + 2] + 1]) / 3;
    const cz = (p[3 * f[3 * t] + 2] + p[3 * f[3 * t + 1] + 2] + p[3 * f[3 * t + 2] + 2]) / 3;
    d = (cx - pt[0]) ** 2 + (cy - pt[1]) ** 2 + (cz - pt[2]) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

function extract(pt: Vec3, nrm: Vec3, type?: GeomType) {
  const tris = topo.growRegion(seed(pt, nrm), pt, { maxAngleDeg: 20, radius: 0 });
  const v = topo.regionVertices(tris);
  const { p, n } = gather(mesh, v.interior.length > 20 ? v.interior : v.all);
  return type ? fitType(type, p, n) : autoFit(p, n).best;
}

describe('E2E Beispielteil', () => {
  it('Mesh geladen', () => {
    expect(mesh.indices.length / 3).toBeGreaterThan(100000);
  });
  const cases: [string, Vec3, Vec3, GeomType, (f: any) => void][] = [
    ['Oberseite', [5, 55, 20], [0, 0, 1], 'Ebene', (f) => { expect(Math.abs(f.normal[2])).toBeGreaterThan(0.9999); expect(f.center[2]).toBeCloseTo(20, 2); expect(f.form).toBeLessThan(0.08); }],
    ['Bohrung D12.08', [26.04, 20, 10], [-1, 0, 0], 'Zylinder', (f) => { expect(f.diameter).toBeCloseTo(12.08, 2); expect(f.center[0]).toBeCloseTo(20, 2); }],
    ['Bohrung D6', [88, 10, 10], [-1, 0, 0], 'Zylinder', (f) => { expect(f.diameter).toBeCloseTo(6, 2); }],
    ['Langloch 30x10', [20, 50, 10], [0, -1, 0], 'Langloch', (f) => { expect(f.length).toBeCloseTo(30, 1); expect(f.width).toBeCloseTo(10, 2); expect(f.center[0]).toBeCloseTo(20, 1); expect(f.center[1]).toBeCloseTo(45, 2); }],
    ['Bolzen D16', [63.05, 30, 26], [1, 0, 0], 'Zylinder', (f) => { expect(f.diameter).toBeCloseTo(16, 2); expect(f.center[0]).toBeCloseTo(55.05, 2); }],
    ['Kegel', [89, 38, 25], [1, 0, 0.5], 'Kegel', (f) => { const a = 2 * Math.atan(6 / 10) * 180 / Math.PI; expect(2 * f.halfAngle * 180 / Math.PI).toBeCloseTo(a, 0); }],
    ['Kugel R7', [60, 8, 24], [0, 0, 1], 'Kugel', (f) => { expect(f.diameter).toBeCloseTo(14, 1); expect(f.center[2]).toBeCloseTo(17, 1); }],
  ];
  const feats = new Map<number, Feature>();
  cases.forEach(([name, pt, n, type, check], i) => it(`${name} -> ${type}`, () => {
    const f = extract(pt, n);
    console.log(name, f.type, f.diameter?.toFixed(4), f.length?.toFixed(3), f.width?.toFixed(3), f.center.map((v) => v.toFixed(3)).join(','), 'rms', f.rms.toFixed(4), 'n', f.n);
    expect(f.type).toBe(type);
    check(f);
    feats.set(i, { id: i, name, type: f.type, measured: f, pointCount: f.n, method: 'Klick' });
  }));
  it('Erzwungener Typ Kreis an Bohrung', () => {
    const f = extract([26.04, 20, 10], [-1, 0, 0], 'Kreis');
    expect(f.type).toBe('Kreis'); expect(f.diameter!).toBeCloseTo(12.08, 2);
  });
  it('Prüfmerkmale IO/NIO und Abstand als Merkmal', () => {
    const d: Control = { id: 1, kind: 'Durchmesser', featureIds: [1], nominal: 12, tolUp: 0.05, tolLo: -0.05 };
    expect(evaluate(d, feats).status).toBe('NIO');
    const dist = computeDistance(feats.get(1)!.measured!, feats.get(4)!.measured!);
    feats.set(99, { id: 99, name: 'Abstand 1', type: 'Abstand', measured: dist, pointCount: 0, method: 'Konstruiert', refs: [1, 4] });
    const a: Control = { id: 2, kind: 'Abstand X', featureIds: [99], nominal: 35, tolUp: 0.1, tolLo: -0.1 };
    const r = evaluate(a, feats);
    expect(r.measured!).toBeCloseTo(35.05, 1); expect(r.status).toBe('IO');
    // Ebene (Oberseite z=20) zu Kugelmitte (z=17): Punkt-Ebene-Abstand 3
    const pe = computeDistance(feats.get(0)!.measured!, feats.get(6)!.measured!);
    expect(pe.distance!).toBeCloseTo(3, 2); expect(Math.abs(pe.delta![0])).toBeLessThan(1e-3);
  });
});

import { extractWithAuxPlane } from '../src/core/aux';
describe('Hilfsebene (Kreis/Langloch)', () => {
  const run = (pt: Vec3, nrm: Vec3, type: 'Kreis' | 'Langloch') => extractWithAuxPlane(mesh, topo, seed(pt, nrm), pt, { maxAngleDeg: 20, radius: 0 }, type);
  it('Klick auf Oberseite neben der Bohrung -> Kreis in Ebene z=20', () => {
    const r = run([27.5, 20, 20], [0, 0, 1], 'Kreis');
    expect(r.fit.type).toBe('Kreis'); expect(r.fit.diameter!).toBeCloseTo(12.08, 2);
    expect(r.fit.center[2]).toBeCloseTo(20, 2); expect(r.fit.center[0]).toBeCloseTo(20, 2);
    expect(Math.abs(r.plane.normal[2])).toBeGreaterThan(0.9999); expect(r.planeIdx.length).toBeGreaterThan(1000);
  });
  it('Klick auf Bohrungswand -> Ebene automatisch (nächstgelegene Planfläche)', () => {
    const r = run([20, 26.04, 17], [0, -1, 0], 'Kreis');
    expect(r.fit.center[2]).toBeCloseTo(20, 2); expect(r.fit.diameter!).toBeCloseTo(12.08, 2);
  });
  it('Langloch in Hilfsebene', () => {
    const r = run([20, 51.5, 20], [0, 0, 1], 'Langloch');
    expect(r.fit.length!).toBeCloseTo(30, 1); expect(r.fit.width!).toBeCloseTo(10, 2); expect(r.fit.center[2]).toBeCloseTo(20, 2);
  });
  it('vorhandene Ebene als Hilfsebene (Unterseite z=0)', () => {
    const bottom = extract([50, 30, 0], [0, 0, -1]);
    const r = extractWithAuxPlane(mesh, topo, seed([20, 26.04, 5], [0, -1, 0]), [20, 26.04, 5], { maxAngleDeg: 20, radius: 0 }, 'Kreis', bottom);
    expect(r.fit.center[2]).toBeCloseTo(0, 2); expect(r.planeIdx.length).toBe(0);
  });
});

describe('Hilfsebene: Wandklick an vielen Stellen', () => {
  it('Ebene bleibt die Oberseite (z=20)', () => {
    for (const a of [0, 1, 2, 3, 4, 5]) {
      const ang = a * Math.PI / 3, z = 19.6 - a * 0.05;
      const pt: Vec3 = [20 + 6.04 * Math.cos(ang), 20 + 6.04 * Math.sin(ang), z];
      const r = extractWithAuxPlane(mesh, topo, seed(pt, [-Math.cos(ang), -Math.sin(ang), 0]), pt, { maxAngleDeg: 20, radius: 0 }, 'Kreis');
      expect(r.fit.center[2]).toBeCloseTo(20, 2); expect(r.planeIdx.length).toBeGreaterThan(1000); expect(r.fit.form).toBeLessThan(0.08);
    }
  });
});

import { autoExtract } from '../src/core/aux';
describe('Automatik: Ebene vs. Hilfsebene vs. Wand, Torus', () => {
  const run = (pt: Vec3, nrm: Vec3) => autoExtract(mesh, topo, seed(pt, nrm), pt, { maxAngleDeg: 20, radius: 0 }, 120);
  it.each([[[50, 50, 20]], [[5, 55, 20]], [[70, 10, 20]], [[90, 55, 20]], [[30, 30, 20]]])('Ebene innen %j -> Ebene ohne Hilfsebene', (pt) => {
    const r = run(pt as Vec3, [0, 0, 1]); expect(r.fit.type).toBe('Ebene'); expect(r.aux).toBeUndefined();
  });
  it.each([[[27.2, 20, 20]], [[20, 27, 20]], [[13, 20, 20]]])('Ebene nahe Bohrung %j -> Kreis mit Hilfsebene', (pt) => {
    const r = run(pt as Vec3, [0, 0, 1]); expect(r.fit.type).toBe('Kreis'); expect(r.aux).toBeDefined();
    expect(r.fit.diameter!).toBeCloseTo(12.08, 1); expect(r.fit.center[2]).toBeCloseTo(20, 2);
  });
  it('Ebene nahe Langloch -> Langloch mit Hilfsebene', () => {
    const r = run([20, 51.2, 20], [0, 0, 1]); expect(r.fit.type).toBe('Langloch'); expect(r.aux).toBeDefined(); expect(r.fit.length!).toBeCloseTo(30, 1);
  });
  it('Bohrungswand Mitte -> Zylinder; Wand an der Kante -> Kreis mit Hilfsebene', () => {
    expect(run([20, 26.04, 10], [0, -1, 0]).fit.type).toBe('Zylinder');
    const k = run([20, 26.04, 19.3], [0, -1, 0]); expect(k.fit.type).toBe('Kreis'); expect(k.aux).toBeDefined(); expect(k.fit.center[2]).toBeCloseTo(20, 2);
  });
  it('Langlochwand -> Langloch mit Hilfsebene', () => {
    const r = run([20, 50, 10], [0, -1, 0]); expect(r.fit.type).toBe('Langloch'); expect(r.aux).toBeDefined();
  });
  it('Torus am Beispielteil', () => {
    const r = run([40, 16, 22.8], [0, 0, 1]);
    expect(r.fit.type).toBe('Torus'); expect(r.fit.radius!).toBeCloseTo(6, 1); expect(r.fit.minorRadius!).toBeCloseTo(2, 1);
    expect(r.fit.center[0]).toBeCloseTo(40, 1); expect(r.fit.center[2]).toBeCloseTo(20.8, 1);
  });
});
