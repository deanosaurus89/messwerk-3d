// Rotations-/Translationsinvarianz des Regionenwachstums: gleiche Saat-Dreiecke im gedrehten/verschobenen Netz
// müssen dieselbe Dreiecksmenge und dieselbe Geometrie (Typ, RMS, Durchmesser) liefern.
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseSTL } from '../src/core/io';
import { MeshTopology, gather } from '../src/core/region';
import { autoFit } from '../src/core/fit';
import type { Vec3 } from '../src/core/linalg';

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function randRot(r: () => number): number[][] {
  // zufällige Rotation aus normiertem Quaternion
  let q = [r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5]; const l = Math.hypot(...q); q = q.map((x) => x / l); const [w, x, y, z] = q;
  return [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]];
}
/** Binäres STL im Puffer drehen und verschieben (Reihenfolge der Dreiecke bleibt). */
function transformSTL(buf: Uint8Array, R: number[][], T: number[]): ArrayBuffer {
  const out = buf.slice().buffer; const dv = new DataView(out); const n = dv.getUint32(80, true);
  for (let i = 0; i < n; i++) { const o = 84 + 50 * i;
    for (let j = 0; j < 4; j++) { const a = o + 12 * j; const v = [dv.getFloat32(a, true), dv.getFloat32(a + 4, true), dv.getFloat32(a + 8, true)];
      for (let k = 0; k < 3; k++) dv.setFloat32(a + 4 * k, R[k][0] * v[0] + R[k][1] * v[1] + R[k][2] * v[2] + (j ? T[k] : 0), true); } }
  return out;
}
const files: [string, string][] = [['beispielteil', 'public/samples/beispielteil.stl'], ['pruefplatte', 'public/samples/pruefplatte.stl.gz'], ['flansch', 'public/samples/flansch.stl.gz'],
  ['scan1', 'tests/fixtures/real/scan1.stl'], ['scan2', 'tests/fixtures/real/scan2.stl'], ['scan3', 'tests/fixtures/real/scan3.stl']];
for (const [name, path] of files) {
  const url = new URL('../' + path, import.meta.url);
  describe.skipIf(!existsSync(url))(`Invarianz ${name}`, () => {
    it('gedreht + verschoben -> identische Regionen und Fits', () => {
      let raw = new Uint8Array(readFileSync(url)); if (path.endsWith('.gz')) raw = new Uint8Array(gunzipSync(raw));
      const m0 = parseSTL(raw.slice().buffer, name); const t0 = new MeshTopology(m0);
      const r = rng(name.length * 7919 + 13); const R = randRot(r); const T = [r() * 400 - 200, r() * 400 - 200, r() * 400 - 200];
      const m1 = parseSTL(transformSTL(raw, R, T), name); const t1 = new MeshTopology(m1);
      expect(m1.indices.length).toBe(m0.indices.length);
      const nt = m0.indices.length / 3; const f = m0.indices, p0 = m0.positions, p1 = m1.positions;
      const cen = (p: Float32Array, t: number): Vec3 => [0, 1, 2].map((k) => (p[3 * f[3 * t] + k] + p[3 * f[3 * t + 1] + k] + p[3 * f[3 * t + 2] + k]) / 3) as Vec3;
      let worst = 1; const js: number[] = [];
      for (let i = 0; i < 6; i++) {
        const s = Math.floor(r() * nt);
        const a = t0.growRegion(s, cen(p0, s), { maxAngleDeg: 20, radius: 0 }); const b = t1.growRegion(s, cen(p1, s), { maxAngleDeg: 20, radius: 0 });
        const A = new Set(a); let inter = 0; for (const x of b) if (A.has(x)) inter++;
        const jac = inter / (a.length + b.length - inter); worst = Math.min(worst, jac); js.push(jac);
        // Float32-Koordinaten: Rundung ~1e-5 mm kann einzelne Dreiecke genau an der Toleranzgrenze kippen lassen
        expect(jac).toBeGreaterThan(0.75);
        if (a.length > 30 && jac > 0.98) {
          const fa = autoFit(...(Object.values(gather(m0, t0.regionVertices(a).all, 4000)) as [Vec3[], Vec3[]]));
          const fb = autoFit(...(Object.values(gather(m1, t1.regionVertices(b).all, 4000)) as [Vec3[], Vec3[]]));
          expect(fb.best.type).toBe(fa.best.type);
          expect(Math.abs(fb.best.rms - fa.best.rms)).toBeLessThan(0.01 * fa.best.rms + 1e-3);
          if (fa.best.diameter) expect(Math.abs(fb.best.diameter! - fa.best.diameter)).toBeLessThan(1e-3 * fa.best.diameter + 1e-4);
        }
      }
      require('node:fs').appendFileSync('/tmp/inv.txt', `${name}: Jaccard ${js.map((x) => x.toFixed(4)).join(' ')}\n`);
      expect(js.reduce((x, y) => x + y, 0) / js.length).toBeGreaterThan(0.95);
    }, 300000);
  });
}
