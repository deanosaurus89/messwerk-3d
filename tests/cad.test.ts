// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import * as C from '../src/cad/occcore';
let oc: any; const log = (s: string) => { fs.appendFileSync('/tmp/cad-numbers.txt', s + '\n'); console.log(s); };
const FX = 'tests/fixtures/cad/';
beforeAll(async () => { const t = performance.now(); oc = await (await import('opencascade.js/dist/node.js' as any)).default(); log(`OC init ${((performance.now() - t) / 1000).toFixed(1)} s`); }, 120000);

function box(oc: any, a: number, b: number, c: number) { return new oc.BRepPrimAPI_MakeBox_2(a, b, c).Shape(); }
const topFace = (oc: any, sh: any) => C.faces(oc, sh).map((f) => ({ f, i: C.faceInfo(oc, f, 0) })).sort((x, y) => y.i.center[2] - x.i.center[2])[0].f;

describe('CAD-Beschnitt (synthetisch)', () => {
  it('Rand-Offset 2 mm auf 100×50-Ebene → 96×46', () => {
    const f = topFace(oc, box(oc, 100, 50, 10)); const r = C.offsetBoundary(oc, f, 2);
    expect(C.area(oc, r)).toBeCloseTo(96 * 46, 0); expect(C.isValid(oc, r)).toBe(true);
  });
  it('Rand-Offset auf Zylindermantel (Naht bleibt): Höhe −2·d', () => {
    const cyl = new oc.BRepPrimAPI_MakeCylinder_1(10, 40).Shape();
    const f = C.faces(oc, cyl).find((x) => C.faceInfo(oc, x, 0).type === 'Zylinder');
    const r = C.offsetBoundary(oc, f, 3); expect(C.area(oc, r)).toBeCloseTo(2 * Math.PI * 10 * 34, 0); expect(C.isValid(oc, r)).toBe(true);
  });
  it('Schnittlinie teilt Ebene, Klickseite wird entfernt', () => {
    const f = topFace(oc, box(oc, 100, 50, 10));
    const r = C.cutByLine(oc, f, [[30, 10, 10], [30, 40, 10]], [0, 0, -1], [10, 25, 10]);
    expect(C.area(oc, r)).toBeCloseTo(70 * 50, 0); expect(C.isValid(oc, r)).toBe(true);
    const pl = C.cutByLine(oc, f, [[0, 20, 10], [50, 20, 10], [50, 0, 10]], [0, 0, -1], [10, 5, 10]); // Polylinie: Ecke 50×20 weg
    expect(C.area(oc, pl)).toBeCloseTo(100 * 50 - 50 * 20, 0);
  });
  it('Insel Kreis/Rechteck als Loch', () => {
    const f = topFace(oc, box(oc, 100, 50, 10));
    const c = C.cutIsland(oc, f, 'circle', [[50, 25, 10], [60, 25, 10]], [0, 0, -1]); expect(C.area(oc, c)).toBeCloseTo(5000 - Math.PI * 100, 0);
    const r = C.cutIsland(oc, f, 'rect', [[10, 10, 10], [30, 20, 10]], [0, 0, -1], [0, 1, 0]); expect(C.area(oc, r)).toBeCloseTo(5000 - 200, 0); expect(C.isValid(oc, r)).toBe(true);
  });
  it('Export STEP/IGES und Wiedereinlesen', () => {
    const f = topFace(oc, box(oc, 100, 50, 10)); const r = C.applyOps(oc, [f], [{ kind: 'offset', faces: [0], d: 5 }, { kind: 'island', faces: [0], shape: 'circle', pts: [[50, 25, 10], [55, 25, 10]], dir: [0, 0, -1] }]).result;
    const want = 90 * 40 - Math.PI * 25;
    for (const fmt of ['step', 'iges'] as const) {
      const b = C.writeCAD(oc, r, fmt); const back = C.readCAD(oc, b, fmt === 'step' ? 'x.stp' : 'x.igs');
      expect(C.area(oc, back)).toBeCloseTo(want, 0); expect(C.isValid(oc, back)).toBe(true);
      if (fmt === 'iges') expect(new TextDecoder().decode(b)).toMatch(/^ {5}144/m);
    }
  });
});

describe('CAD display mesh', () => {
  it('a cylinder wall stays within the display chordal error', () => {
    const cyl = new oc.BRepPrimAPI_MakeCylinder_1(10, 40).Shape();
    const wall = C.faces(oc, cyl).find((f) => C.faceClass(oc, f).type === 'Zylinder');
    const diag = C.bboxDiag(oc, cyl);
    const defl = C.displayDeflection(diag);
    const t = C.tessellate(oc, wall, defl.linear, false, defl.angular);
    expect(t.indices.length).toBeGreaterThan(12);
    let worst = 0;
    for (let i = 0; i < t.positions.length; i += 3) {
      const r = Math.hypot(t.positions[i], t.positions[i + 1]);
      worst = Math.max(worst, Math.abs(r - 10));
    }
    expect(worst).toBeLessThanOrEqual(defl.linear + 0.05);
    const loaded = C.loadDisplayFaces(oc, cyl);
    const wall2 = loaded.faces.find((f) => f.type === 'Zylinder')!;
    let worst2 = 0;
    for (let i = 0; i < wall2.tess.positions.length; i += 3) worst2 = Math.max(worst2, Math.abs(Math.hypot(wall2.tess.positions[i], wall2.tess.positions[i + 1]) - 10));
    expect(worst2).toBeLessThanOrEqual(loaded.defl.linear + 0.05);
    expect(Math.abs(wall2.area - 2 * Math.PI * 10 * 40) / (2 * Math.PI * 10 * 40)).toBeLessThan(0.05);
  });
});

// Martins Testdateien liegen nur lokal (nicht im öffentlichen Repo, siehe .gitignore) – ohne sie wird übersprungen.
describe.skipIf(!fs.existsSync(FX + 'motordeckel.stp'))('CAD-Beschnitt an Martins Testdateien', () => {
  for (const file of ['motordeckel.stp', 'deviated-cover.igs']) it(file, () => {
    let t = performance.now(); const sh = C.readCAD(oc, fs.readFileSync(FX + file), file); const tRead = performance.now() - t;
    const fs_ = C.faces(oc, sh); const info = fs_.map((f, i) => C.faceInfo(oc, f, i));
    const types: Record<string, number> = {}; for (const i of info) { const k = i.type + (i.detail ? ` (${i.detail})` : ''); types[k] = (types[k] ?? 0) + 1; }
    const diag = C.bboxDiag(oc, sh); t = performance.now(); let tris = 0; for (const f of fs_) tris += C.tessellate(oc, f, diag / 2000).indices.length / 3; const tTess = performance.now() - t;
    log(`${file}: ${fs_.length} Flächen ${JSON.stringify(types)}, Diagonale ${diag.toFixed(1)} mm, Lesen ${(tRead / 1000).toFixed(1)} s, Tessellieren ${(tTess / 1000).toFixed(1)} s (${tris} Dreiecke)`);
    const byType = new Map<string, C.FaceInfo>();
    for (const i of info) { const k = i.type + (i.detail ? ' ' + i.detail : ''); if (!byType.has(k) || byType.get(k)!.area < i.area) byType.set(k, i); }
    let fails = 0;
    for (const [k, i] of byType) {
      const f = fs_[i.id]; t = performance.now(); let r: any, ok = false, a = NaN;
      try { r = C.offsetBoundary(oc, f, 2); a = C.area(oc, r); ok = C.isValid(oc, r); } catch (e: any) { log(`  ${k}: Fehler ${e.message}`); }
      const band = C.perimeter(oc, f) * 2, rel = (i.area - a) / band;
      log(`  Offset 2 mm ${k} #${i.id}: ${i.area.toFixed(1)} → ${a.toFixed(1)} mm² (${((1 - a / i.area) * 100).toFixed(1)} % weg; Rand·d = ${band.toFixed(1)} mm², Verhältnis ${rel.toFixed(2)}), gültig ${ok}, ${((performance.now() - t) / 1000).toFixed(2)} s`);
      // entfernte Fläche ≈ Randlänge·d (Ecken/Krümmung verschieben das um einige %)
      if (!(ok && a > 0 && rel > 0.8 && rel < 1.1)) fails++;
    }
    expect(fails).toBeLessThanOrEqual(1);
    // Export der beschnittenen größten Ebene + Wiedereinlesen
    const pl = [...info].filter((i) => i.type === 'Ebene' || i.detail === 'Rotationsfläche').sort((a, b) => b.area - a.area)[0];
    const res = C.applyOps(oc, fs_, [{ kind: 'offset', faces: [pl.id], d: 1.5 }]).result[pl.id]; const want = C.area(oc, res);
    for (const fmt of ['step', 'iges'] as const) { const b = C.writeCAD(oc, [res], fmt); const back = C.readCAD(oc, b, fmt === 'step' ? 'x.stp' : 'x.igs'); const got = C.area(oc, back);
      log(`  Export ${fmt.toUpperCase()} #${pl.id}: ${(b.length / 1024).toFixed(0)} kB, wieder eingelesen ${got.toFixed(2)} mm² (soll ${want.toFixed(2)}), gültig ${C.isValid(oc, back)}`);
      expect(Math.abs(got - want) / want).toBeLessThan(0.002); expect(C.isValid(oc, back)).toBe(true); }
  }, 700000);
});
