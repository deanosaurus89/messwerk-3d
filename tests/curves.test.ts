// Kurvennetz: Erkennung scharfer Kanten und Tangentenlinien, B-Spline auf dem Netz, Graph/Patch-Aufteilung.
import { readFileSync, appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseByName } from '../src/core/io';
import { computeNormals } from '../src/core/mesh';
import { EdgeGraph, detectCurves, layout, pathThrough, makeCurve } from '../src/core/curves';
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
  it('Prüfplatte: Erkennung, T-Stöße, Patch-Aufteilung, Benutzerkurve', () => {
    const nom = JSON.parse(readFileSync(new URL('../public/samples/pruefplatte.json', import.meta.url), 'utf8'));
    const buf = readFileSync(new URL(`../public/samples/${nom.file}`, import.meta.url));
    const m = parseByName(nom.file, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const t0 = performance.now(); const g = new EdgeGraph(m); const bvh = buildBVH(m);
    const cs = detectCurves(m, {}, g, bvh); const lay = layout(g, cs);
    const nk = cs.filter((c) => c.kind === 'Kante').length, ntg = cs.filter((c) => c.kind === 'Tangente').length;
    log(`Prüfplatte: ${cs.length} Kurven (${nk} Kanten, ${ntg} Tangentenlinien), ${lay.nodes.length} Knoten, ${lay.tJunctions} T-Stöße, ${lay.regions.length} Patches, davon ${lay.foursided} 4-seitig, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    expect(nk).toBeGreaterThan(4); expect(ntg).toBeGreaterThan(4); expect(lay.regions.length).toBeGreaterThan(5);
    // Benutzerkurve über die Oberseite → teilt eine Region
    const P = m.positions; const near = (x: number, y: number, z: number) => { let b = 0, bd = Infinity; for (let i = 0; i < P.length / 3; i++) { const d = (P[3 * i] - x) ** 2 + (P[3 * i + 1] - y) ** 2 + (P[3 * i + 2] - z) ** 2; if (d < bd) { bd = d; b = i; } } return b; };
    const u = makeCurve(g, bvh, pathThrough(g, [near(15, 6, 16), near(45, 6, 16)]), 'Benutzer');
    expect(u.length).toBeGreaterThan(25); expect(u.length).toBeLessThan(31);
  });
});
