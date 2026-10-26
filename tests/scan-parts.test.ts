import { samplePath } from './samplePath';
// Scan-ähnliche Demo-Teile: automatische Extraktion an den Prüfpunkten (probe) gegen die dokumentierte Soll-Geometrie (samples/*.json).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseByName } from '../src/core/io';
import { MeshTopology } from '../src/core/region';
import { autoExtract } from '../src/core/aux';
import type { Vec3 } from '../src/core/linalg';

function load(key: string) {
  const nom = JSON.parse(readFileSync(samplePath(`${key}.json`), 'utf8'));
  const buf = readFileSync(samplePath(`${nom.file}`));
  const mesh = parseByName(nom.file, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  return { nom, mesh, topo: new MeshTopology(mesh) };
}
function nearestTri(mesh: any, pt: Vec3) {
  const p = mesh.positions, f = mesh.indices; let best = -1, bd = Infinity;
  for (let t = 0; t < f.length / 3; t++) {
    const a = 3 * f[3 * t], b = 3 * f[3 * t + 1], c = 3 * f[3 * t + 2];
    const d = ((p[a] + p[b] + p[c]) / 3 - pt[0]) ** 2 + ((p[a + 1] + p[b + 1] + p[c + 1]) / 3 - pt[1]) ** 2 + ((p[a + 2] + p[b + 2] + p[c + 2]) / 3 - pt[2]) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
const ACCEPT: Record<string, string[]> = { Zylinder: ['Zylinder', 'Kreis'], Langloch: ['Langloch'], Ebene: ['Ebene'], Kugel: ['Kugel'], Kegel: ['Kegel'], Torus: ['Torus'] };
const ang = (a: number[], b: number[]) => Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;

for (const key of ['pruefplatte', 'flansch', 'freiform']) {
  describe(`Scan-Demoteil ${key}`, () => {
    const { nom, mesh, topo } = load(key);
    const diag = Math.hypot(...[0, 1, 2].map((k) => { let lo = Infinity, hi = -Infinity; for (let i = k; i < mesh.positions.length; i += 3) { lo = Math.min(lo, mesh.positions[i]); hi = Math.max(hi, mesh.positions[i]); } return hi - lo; }));
    it('Netz: dicht, isotrop, ohne Splitter', () => {
      expect(mesh.indices.length / 3).toBeGreaterThan(200000);
      expect(mesh.indices.length / 3).toBeLessThan(600000);
      expect(nom.mesh.edge_mm.max).toBeLessThan(1.5);
      expect(nom.mesh.quality.p1).toBeGreaterThan(0.5);
    });
    for (const f of nom.features.filter((x: any) => x.probe)) {
      it(`${f.id} (${f.type}) automatisch`, () => {
        const r = autoExtract(mesh, topo, nearestTri(mesh, f.probe), f.probe, { maxAngleDeg: 20, radius: 0 }, diag);
        const m: any = r.fit;
        // 0.39: Wachsen bleibt am Saat-Fit verankert (kein Mitwandern über die Freiform) -> kleinere Region, Form 0.17 statt > 0.2;
        // weiterhin ≫ Formabweichung der Regelgeometrien (≈ 0.01)
        if (f.type === 'Freiform') { expect(m.form).toBeGreaterThan(0.15); return; }
        // A slot probe in the middle of the wall does not cover the face, so Smart Detect stays a surface (cylinder).
        const accept = key === 'flansch' && f.type === 'Zylinder' ? ['Zylinder'] : f.type === 'Langloch' ? ['Langloch', 'Zylinder'] : ACCEPT[f.type];
        expect(accept, `${key} ${f.id}`).toContain(m.type);
        if (key === 'flansch' && f.type === 'Zylinder') expect(r.aux).toBeFalsy();
        if (f.type === 'Ebene') { expect(ang(m.normal, f.normal)).toBeLessThan(0.05); const d = [0, 1, 2].reduce((s, k) => s + (m.center[k] - f.point[k]) * f.normal[k], 0); expect(Math.abs(d)).toBeLessThan(0.01); }
        if (f.type === 'Zylinder' && m.type === 'Zylinder') { expect(Math.abs(m.diameter - f.diameter)).toBeLessThan(0.03); expect(Math.hypot(m.center[0] - f.center[0], m.center[1] - f.center[1])).toBeLessThan(0.02); expect(ang(m.normal, f.axis)).toBeLessThan(0.2); }
        if (f.type === 'Langloch' && m.type === 'Langloch') { expect(Math.abs(m.length - f.length)).toBeLessThan(0.05); expect(Math.abs(m.width - f.width)).toBeLessThan(0.03); expect(Math.hypot(m.center[0] - f.center[0], m.center[1] - f.center[1])).toBeLessThan(0.03); }
        if (f.type === 'Langloch' && m.type === 'Zylinder') expect(r.aux).toBeFalsy();
        if (f.type === 'Kugel') { expect(Math.abs(m.diameter - f.diameter)).toBeLessThan(0.05); expect(Math.hypot(m.center[0] - f.center[0], m.center[1] - f.center[1], m.center[2] - f.center[2])).toBeLessThan(0.03); }
        if (f.type === 'Kegel') expect(Math.abs(2 * m.halfAngle * 180 / Math.PI - f.includedAngleDeg)).toBeLessThan(0.5);
        if (f.type === 'Torus') { expect(Math.abs(m.radius - f.majorRadius)).toBeLessThan(0.1); expect(Math.abs(Math.abs(m.minorRadius) - f.minorRadius)).toBeLessThan(0.05); }
        console.log(`${key} ${f.id}: ${m.type} ${m.diameter ? 'D=' + m.diameter.toFixed(4) : ''} ${m.radius && f.type === 'Torus' ? 'R=' + m.radius.toFixed(3) + ' r=' + Math.abs(m.minorRadius).toFixed(3) : ''} ${m.halfAngle && f.type === 'Kegel' ? 'W=' + (2 * m.halfAngle * 180 / Math.PI).toFixed(3) : ''} form=${m.form.toFixed(4)} n=${r.indices.length}${r.aux ? ' +Hilfsebene' : ''}`);
      }, 120000);
    }
  });
}
