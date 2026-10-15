import { samplePath } from './samplePath';
// Kurvennetz: Erkennung scharfer Kanten und Tangentenlinien, B-Spline auf dem Netz, Graph/Patch-Aufteilung.
import { readFileSync, appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseByName } from '../src/core/io';
import { computeNormals, weld } from '../src/core/mesh';
import { EdgeGraph, detectCurves, layout, pathThrough, makeCurve, curveFromCtrl, splitCurve, joinCurves } from '../src/core/curves';
import { buildBVH } from '../src/core/polyedit';
const log = (s: string) => { try { appendFileSync('/tmp/pe-numbers.txt', s + '\n'); } catch { /* */ } };

function gridMesh(fn: (u: number, v: number) => [number, number, number], nu: number, nv: number) {
  const pos: number[] = [], idx: number[] = []; for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) pos.push(...fn(i / nu, j / nv));
  const id = (i: number, j: number) => j * (nu + 1) + i;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) idx.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
  const m: any = { name: 'syn', positions: new Float32Array(pos), indices: new Uint32Array(idx) }; computeNormals(m); return m;
}
describe('Kurvennetz', () => {
  it('Übergang Ebene → R5 → Wand: zwei Tangentenlinien an der richtigen Stelle', () => {
    const R = 5, L1 = 12, L2 = Math.PI / 2 * R, L = L1 + L2 + 12;
    const at = (s: number): [number, number] => s <= L1 ? [s - L1, 0] : s <= L1 + L2 ? [R * Math.sin((s - L1) / R), R - R * Math.cos((s - L1) / R)] : [R, R + s - L1 - L2];
    const m = gridMesh((u, v) => { const p = at(u * L); return [p[0], p[1], v * 20]; }, 120, 40);
    const cs = detectCurves(m);
    log('Synthetisch R5: ' + cs.map((c) => `${c.kind} ${c.length.toFixed(1)} mm`).join(', '));
    const tan = cs.filter((c) => c.kind === 'Tangente' && c.length > 15);
    expect(tan.length).toBe(2);
    // Linie 1 bei (0,0), Linie 2 bei (5,5): mittlere Lage ≤ 0,5 mm (eine Gitterweite ≈ 0,26 mm)
    const d1 = Math.min(...tan.map((c) => c.pts.reduce((s, p) => s + Math.hypot(p[0], p[1]), 0) / c.pts.length));
    const d2 = Math.min(...tan.map((c) => c.pts.reduce((s, p) => s + Math.hypot(p[0] - 5, p[1] - 5), 0) / c.pts.length));
    log(`  Lage Tangentenlinien: ${d1.toFixed(3)} / ${d2.toFixed(3)} mm`);
    expect(d1).toBeLessThan(0.6); expect(d2).toBeLessThan(0.6);
  });
  it('scharfe 90°-Kante → Kurventyp Kante', () => {
    const m = gridMesh((u, v) => { const s = u * 24; return s <= 12 ? [s - 12, 0, v * 20] : [0, s - 12, v * 20]; }, 96, 40);
    const cs = detectCurves(m); const k = cs.filter((c) => c.kind === 'Kante');
    expect(k.length).toBe(1); expect(k[0].length).toBeGreaterThan(19);
    expect(Math.max(...k[0].pts.map((p) => Math.hypot(p[0], p[1])))).toBeLessThan(0.05);
  });
  it('Radius → Radius (R5 → R15): Übergangslinie erkannt', () => {
    const L1 = 10, A1 = Math.PI / 4 * 5, A2 = Math.PI / 4 * 15, L = L1 + A1 + A2;
    // Ebene, dann R5 über 45°, dann tangential R15 über 45°
    const at = (s: number): [number, number] => {
      if (s <= L1) return [s - L1, 0];
      if (s <= L1 + A1) { const f = (s - L1) / 5; return [5 * Math.sin(f), 5 - 5 * Math.cos(f)]; }
      const f0 = Math.PI / 4, p0 = [5 * Math.sin(f0), 5 - 5 * Math.cos(f0)], c = [p0[0] - 15 * Math.sin(f0), p0[1] + 15 * Math.cos(f0)]; const f = f0 + (s - L1 - A1) / 15;
      return [c[0] + 15 * Math.sin(f), c[1] - 15 * Math.cos(f)];
    };
    const m = gridMesh((u, v) => { const p = at(u * L); return [p[0], p[1], v * 20]; }, 140, 40);
    const cs = detectCurves(m);
    log('Synthetisch R5→R15: ' + cs.map((c) => `${c.kind} ${c.length.toFixed(1)} mm`).join(', '));
    const pj = [5 * Math.sin(Math.PI / 4), 5 - 5 * Math.cos(Math.PI / 4)];
    const ue = cs.filter((c) => c.kind === 'Übergang' && c.length > 15);
    expect(ue.length).toBe(1);
    const d = ue[0].pts.reduce((s, p) => s + Math.hypot(p[0] - pj[0], p[1] - pj[1]), 0) / ue[0].pts.length;
    log(`  Lage Übergang R5/R15: ${d.toFixed(3)} mm`); expect(d).toBeLessThan(1.0);
  });
  it('Zylindermantel: Naht-Vorschlag ergibt 4-seitigen Patch', () => {
    const m = gridMesh((u, v) => [20 * Math.cos(2 * Math.PI * u), 20 * Math.sin(2 * Math.PI * u), v * 30], 160, 60);
    // Netz zu (Naht u=0/u=1 verschweißen)

    const tri = new Float32Array(m.indices.length * 3); for (let i = 0; i < m.indices.length; i++) tri.set(m.positions.subarray(3 * m.indices[i], 3 * m.indices[i] + 3), 3 * i);
    const w = weld(tri, 1e-3); const mm: any = { name: 'zyl', positions: w.positions, indices: w.indices }; computeNormals(mm);
    const g = new EdgeGraph(mm); const L0 = layout(g, []);
    expect(L0.regions.length).toBe(1); expect(L0.regions[0].loops).toBe(2); expect(L0.suggestions.length).toBe(1);
    const L1 = layout(g, [{ chain: L0.suggestions[0].chain }]);
    log(`Zylindermantel: vorher Seiten ${L0.regions[0].sides}/Schleifen ${L0.regions[0].loops}, nach Naht ${L1.regions[0].sides}/${L1.regions[0].loops}`);
    expect(L1.regions[0].sides).toBe(4); expect(L1.foursided).toBe(1);
  });
  it('Bearbeiten: Kontrollpunkte, Teilen, Verbinden', () => {
    const m = gridMesh((u, v) => [u * 40, v * 40, 0], 80, 80); const g = new EdgeGraph(m); const bvh = buildBVH(m);
    const c = curveFromCtrl(g, bvh, [[5, 5, 1], [15, 10, 0], [25, 10, 0], [35, 5, -1]], 'Benutzer');
    expect(c.pts.every((p) => Math.abs(p[2]) < 1e-6)).toBe(true); expect(c.chain.length).toBeGreaterThan(10);
    const sp = splitCurve(g, bvh, c, c.chain[Math.floor(c.chain.length / 2)])!; expect(sp).not.toBeNull();
    expect(Math.abs(sp[0].length + sp[1].length - c.length)).toBeLessThan(2);
    const j = joinCurves(g, bvh, sp[0], sp[1]); expect(Math.abs(j.length - c.length)).toBeLessThan(2);
  });
  it('Prüfplatte: Erkennung, T-Stöße, Patch-Aufteilung, Benutzerkurve', () => {
    const nom = JSON.parse(readFileSync(samplePath('pruefplatte.json'), 'utf8'));
    const buf = readFileSync(samplePath(`${nom.file}`));
    const m = parseByName(nom.file, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const t0 = performance.now(); const g = new EdgeGraph(m); const bvh = buildBVH(m);
    const cs = detectCurves(m, {}, g, bvh); const lay = layout(g, cs);
    const nk = cs.filter((c) => c.kind === 'Kante').length, ntg = cs.filter((c) => c.kind === 'Tangente').length;
    log(`Prüfplatte: ${cs.length} Kurven (${nk} Kanten, ${ntg} Tangentenlinien, ${cs.filter((c) => c.kind === 'Übergang').length} Übergänge), ${lay.nodes.length} Knoten, ${lay.tJunctions} T-Stöße, ${lay.regions.length} Patches, davon ${lay.foursided} 4-seitig, ${lay.suggestions.length} Vorschläge, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    expect(nk).toBeGreaterThan(4); expect(ntg).toBeGreaterThan(4); expect(lay.regions.length).toBeGreaterThan(5);
    // Benutzerkurve über die Oberseite → teilt eine Region
    const P = m.positions; const near = (x: number, y: number, z: number) => { let b = 0, bd = Infinity; for (let i = 0; i < P.length / 3; i++) { const d = (P[3 * i] - x) ** 2 + (P[3 * i + 1] - y) ** 2 + (P[3 * i + 2] - z) ** 2; if (d < bd) { bd = d; b = i; } } return b; };
    const u = makeCurve(g, bvh, pathThrough(g, [near(15, 6, 16), near(45, 6, 16)]), 'Benutzer');
    expect(u.length).toBeGreaterThan(25); expect(u.length).toBeLessThan(31);
  });
});

describe('Kurvennetz Demoteile (Statistik)', () => {
  for (const key of ['pruefplatte', 'flansch', 'freiform']) it(key, () => {
    const nom = JSON.parse(readFileSync(samplePath(`${key}.json`), 'utf8'));
    const buf = readFileSync(samplePath(`${nom.file}`));
    const m = parseByName(nom.file, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const g = new EdgeGraph(m); const bvh = buildBVH(m); const cs = detectCurves(m, {}, g, bvh); const L = layout(g, cs);
    const L2 = layout(g, [...cs, ...L.suggestions]);
    const k = (x: string) => cs.filter((c) => c.kind === x).length;
    log(`STAT ${key}: ${cs.length} Kurven (K ${k('Kante')}, T ${k('Tangente')}, Ü ${k('Übergang')}), kürzeste ${Math.min(...cs.map((c) => c.length)).toFixed(1)} mm, ${L.regions.length} Patches, ${L.foursided} 4-seitig, ${L.tJunctions} T, ${L.corners.length} Zusatzecken, ${L.suggestions.length} Vorschläge -> mit Vorschlägen ${L2.regions.length} Patches, ${L2.foursided} 4-seitig`);
    expect(cs.length).toBeGreaterThan(5);
  });
});
