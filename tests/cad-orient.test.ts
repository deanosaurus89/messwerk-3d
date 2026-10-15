// @vitest-environment node
// Orientierung (Vorder-/Rückseite) bleibt bei Beschnitt + Export (STEP/IGES) + Wiedereinlesen erhalten.
// Nutzt private CAD-Dateien aus tests/fixtures/cad (gitignored); ohne Dateien übersprungen.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import * as C from '../src/cad/occcore';
import { gunzipSync } from 'fflate';
const FX = 'tests/fixtures/cad/';
// public CAD sample (always available) + private fixtures
const SAMPLE = 'public/samples/cad-sample.igs.gz';
const files = (fs.existsSync(FX) ? fs.readdirSync(FX).filter((f) => /\.(stp|step|igs|iges)$/i.test(f)) : []).filter((f) => !process.env.CADF || f.includes(process.env.CADF)).map((f) => FX + f);
if (!process.env.CADF || SAMPLE.includes(process.env.CADF)) files.unshift(SAMPLE);
let oc: any;
beforeAll(async () => { oc = await (await import('opencascade.js/dist/node.js' as any)).default(); }, 120000);

/** Tessellation -> Dreiecks-Schwerpunkte + orientierte Normalen, Gitter für Nächste-Nachbar-Suche. */
function triSet(t: { positions: Float32Array; indices: Uint32Array }, cell: number) {
  const n = t.indices.length / 3, c = new Float32Array(3 * n), nn = new Float32Array(3 * n), P = t.positions, I = t.indices; const grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) { const a = 3 * I[3 * i], b = 3 * I[3 * i + 1], d = 3 * I[3 * i + 2];
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], v = [P[d] - P[a], P[d + 1] - P[a + 1], P[d + 2] - P[a + 2]];
    const x = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(x[0], x[1], x[2]) || 1;
    for (let k = 0; k < 3; k++) { c[3 * i + k] = (P[a + k] + P[b + k] + P[d + k]) / 3; nn[3 * i + k] = x[k] / l; }
    const key = [0, 1, 2].map((k) => Math.floor(c[3 * i + k] / cell)).join(','); let g = grid.get(key); if (!g) grid.set(key, (g = [])); g.push(i); }
  const near = (q: number[], maxD = Infinity) => { let best = -1, bd = maxD * maxD; const k0 = q.map((x) => Math.floor(x / cell));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const i of grid.get(`${k0[0] + dx},${k0[1] + dy},${k0[2] + dz}`) ?? []) {
      const d = (c[3 * i] - q[0]) ** 2 + (c[3 * i + 1] - q[1]) ** 2 + (c[3 * i + 2] - q[2]) ** 2; if (d < bd) { bd = d; best = i; } }
    return best; };
  return { n, c, nn, near };
}
describe('Orientierung synthetisch', () => {
  it('Quader (teils REVERSED-Flächen): Export -> natürliche Flächennormalen zeigen nach außen', () => {
    const sh = new oc.BRepPrimAPI_MakeBox_2(40, 30, 20).Shape(); const fs0 = C.faces(oc, sh);
    expect(fs0.some((f) => f.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED)).toBe(true);
    for (const fmt of ['step', 'iges'] as const) {
      const back = C.readCAD(oc, C.writeCAD(oc, fs0, fmt), fmt === 'step' ? 'x.stp' : 'x.igs');
      for (const nat of fmt === 'iges' ? [false, true] : [false]) { const t = C.tessellate(oc, back, 0.5, nat); const P = t.positions, I = t.indices;
        for (let i = 0; i < I.length; i += 3) { const a = 3 * I[i], b = 3 * I[i + 1], c = 3 * I[i + 2];
          const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
          const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const m = [(P[a] + P[b] + P[c]) / 3 - 20, (P[a + 1] + P[b + 1] + P[c + 1]) / 3 - 15, (P[a + 2] + P[b + 2] + P[c + 2]) / 3 - 10];
          expect(n[0] * m[0] + n[1] * m[1] + n[2] * m[2]).toBeGreaterThan(0); } }
    }
  }, 120000);
});
for (const name of files) {
  describe.skipIf(!files.length)(`Orientierung ${name}`, () => {
    it('Normalen nach Beschnitt + Export + Wiedereinlesen identisch (STEP und IGES)', () => {
      const raw = new Uint8Array(fs.readFileSync(name)), sh = C.readCAD(oc, name.endsWith('.gz') ? gunzipSync(raw) : raw, name.replace(/\.gz$/, '')); const orig = C.faces(oc, sh);
      // jede 4. Fläche: Rand-Offset 0,5 mm (beschnittene Flächen), Rest unverändert
      const sel = name === SAMPLE ? [0, 10, 22, 30, 50, 60] : orig.map((_, i) => i).filter((i) => i % 4 === 0); // sample: faces with few boundary edges (offset cost grows with edge count)
      const { result } = C.applyOps(oc, orig, [{ kind: 'offset', faces: sel, d: 0.5 } as any]);
      const diag = C.bboxDiag(oc, sh); const defl = diag / 800, cell = diag / 150;
      const O = triSet(C.tessellate(oc, sh, defl), cell);
      let line = `${name}: ${orig.length} Flächen`;
      for (const fmt of ['step', 'iges'] as const) {
        const back = C.readCAD(oc, C.writeCAD(oc, result, fmt), fmt === 'step' ? 'x.stp' : 'x.igs');
       // STEP: Orientierung per same_sense (orientierte Normale); IGES 144: zusätzlich natürliche Flächennormale
       for (const nat of fmt === 'iges' ? [false, true] : [false]) {
        // flächenweise vergleichen (Reihenfolge bleibt beim Export erhalten): Dreiecksnormalen nur innerhalb derselben Fläche zuordnen
        const RF = C.faces(oc, back); const SF = result.flatMap((x: any) => C.faces(oc, x)); expect(RF.length).toBe(SF.length);
        let ok = 0, bad = 0, badF = 0;
        for (let f = 0; f < SF.length; f++) { const A = triSet(C.tessellate(oc, SF[f], defl), cell), R = triSet(C.tessellate(oc, RF[f], defl, nat), cell); let fo = 0, fb = 0;
          for (let i = 0; i < R.n; i++) { const j = A.near([R.c[3 * i], R.c[3 * i + 1], R.c[3 * i + 2]], defl * 4); if (j < 0) continue;
            const d = R.nn[3 * i] * A.nn[3 * j] + R.nn[3 * i + 1] * A.nn[3 * j + 1] + R.nn[3 * i + 2] * A.nn[3 * j + 2]; if (d > 0.3) fo++; else if (d < -0.3) fb++; }
          ok += fo; bad += fb; if (fb > fo) badF++; }
        line += ` | ${fmt}${nat ? ' (Flächennormale)' : ''}: ${SF.length - badF}/${SF.length} Flächen gleich, Dreiecke ${ok} gleich / ${bad} umgedreht (${(100 * ok / Math.max(1, ok + bad)).toFixed(2)} %)`;
        fs.appendFileSync('/tmp/orient.txt', line + '\n'); expect(badF).toBe(0); expect(bad / Math.max(1, ok + bad)).toBeLessThan(1e-4); // Einzeldreiecke: Splitter der Tessellierung (Flächen selbst alle gleich)
       }
      }
    }, 900000);
  });
}
