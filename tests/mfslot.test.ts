// 0.39 (Martin): Langloch auf dem Multi-Feature-Scan – Klick auf die gerade Wand, auf einen Bogen oder an die Ecke liefert
// das GANZE Langloch (Wand entlang der Kontur verfolgt), und „Region hinzufügen“ vereinigt Teilstücke zu einem Langloch.
import { readFileSync } from 'node:fs'; import { gunzipSync } from 'node:zlib'; import { describe, expect, it } from 'vitest';
import { parseSTL } from '../src/core/io'; import { MeshTopology } from '../src/core/region'; import { extractAtRim, mergeAuxWall } from '../src/core/aux';
import { reextract, REEX_DEFAULT } from '../src/core/reextract';
import type { Vec3 } from '../src/core/linalg';
const b = gunzipSync(readFileSync('public/samples/multifeature.stl.gz'));
const mesh = parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'mf');
const P = mesh.positions, F = mesh.indices, nt = F.length / 3, fn = mesh.faceNormals!; const topo = new MeshTopology(mesh);
// [Name, Ebenennormale, Mitte, halbe Breite (Saat), erwartete Länge, Breite] – Länge/Breite aus dem Wandverlauf im Scan
const SLOTS: [string, Vec3, Vec3, number, number, number][] = [['left', [-0.5, 0, 0.866], [-45.4, 50.6, 27.5], 11.5, 57.5, 23.5], ['right', [0.516, -0.018, 0.857], [43, 50.6, 27], 11.5, 57.5, 23.5]]
// offen (0.39): Langloch bei (−65, 168) – Wand nicht ⟂ zur Fläche (Verrundung/Schräge), siehe research/backlog.md;
const frame = (N: Vec3) => { const u = [N[2], 0, -N[0]]; const l = Math.hypot(u[0], u[2]); return [u[0] / l, 0, u[2] / l]; };
const at = (N: Vec3, C: Vec3, uu: number, ww: number) => { const u = frame(N); let best = -1, bd = 1e9; for (let t = 0; t < nt; t++) { if (Math.abs(fn[3*t]*N[0]+fn[3*t+1]*N[1]+fn[3*t+2]*N[2]) > 0.05) continue;
  const v = F[3*t]; const q = [P[3*v]-C[0], P[3*v+1]-C[1], P[3*v+2]-C[2]]; if (Math.abs(q[0]*N[0]+q[1]*N[1]+q[2]*N[2]) > 5) continue; const a = q[0]*u[0]+q[2]*u[2], c = q[1]; const d = (a-uu)**2+(c-ww)**2; if (d < bd) { bd = d; best = t; } } return best; };
const pt = (t: number): Vec3 => { const v = F[3*t]; return [P[3*v], P[3*v+1], P[3*v+2]]; };
const full = (f: any, L = 57.5, W = 23.5) => { if (process.env.DBG) console.log('FIT', f.type, f.length?.toFixed(2), f.width?.toFixed(2), f.center.map((x: number) => x.toFixed(1)).join(',')); expect(f.type).toBe('Langloch'); expect(f.length).toBeGreaterThan(0.95 * L); expect(f.length).toBeLessThan(1.05 * L); expect(f.width).toBeGreaterThan(0.92 * W); expect(f.width).toBeLessThan(1.08 * W); };
for (const [nm, N, C, hw, L, W] of SLOTS) describe(`multifeature slot ${nm}`, () => {
  for (const [where, uu, ww] of [['straight wall', hw, 0], ['other straight wall', -hw, 5], ['arc', 0, L / 2], ['other arc', 0, -L / 2], ['corner', 0.7 * hw, L / 2 - 0.3 * hw]] as [string, number, number][])
    it(`click on ${where} gives the full slot`, () => { let t = at(N, C, uu, ww);
 if (process.env.DBG) console.log('SEED', t, pt(t).map((x) => x.toFixed(1)).join(','), [fn[3*t], fn[3*t+1], fn[3*t+2]].map((x) => x.toFixed(2)).join(',')); for (const seedR of [0, 1.5]) full(extractAtRim(mesh, topo, t, pt(t), { maxAngleDeg: 20, radius: 0, seedR }, 'Langloch', 340).fit, L, W); }, 120000);
  it('partial wall + Add Region on the opposite arc merges into the full slot', () => {
    const t = at(N, C, 0, L / 2); const r = extractAtRim(mesh, topo, t, pt(t), { maxAngleDeg: 20, radius: 0 }, 'Langloch', 340);
    // Teilstück: nur die Wandpunkte der oberen Hälfte (wie ein früheres, halbes Ergebnis)
    const half = r.wallIdx.filter((v) => P[3*v+1] > C[1] + 5); const t2 = at(N, C, 0, -L / 2);
    const m = mergeAuxWall(mesh, topo, t2, pt(t2), { maxAngleDeg: 20, radius: 0 }, 'Langloch', r.plane, half); full(m.fit, L, W);
  }, 120000);
});

// 0.39 (Martin): Re-Extraktion von Wand-Merkmalen mit Normalenwinkel (30°) – Wandpunkte werden gegen die Wandnormale
// (radial/⟂ zur Wand) geprüft, nicht gegen die Hilfsebenen-Normale; sie dürfen nicht wegfallen.
describe('multifeature re-extraction with normal angle keeps wall points', () => {
  const run = (N: Vec3, C: Vec3, uu: number, ww: number, type: 'Kreis' | 'Langloch') => {
    const t = at(N, C, uu, ww); const r = extractAtRim(mesh, topo, t, pt(t), { maxAngleDeg: 20, radius: 0 }, type, 340);
    if (process.env.DBG) console.log('EX', type, r.fit.radius, r.fit.length, r.wallIdx.length);
    const x = reextract(r.fit, mesh.positions, mesh.vertexNormals ?? null, r.wallIdx, { ...REEX_DEFAULT, maxDist: 1, maxAngleDeg: 30, angleOn: true }, [], mesh.indices, r.plane);
    if (process.env.DBG) console.log('REEX', type, r.wallIdx.length, '->', x.indices.length, x.fit.type, (x.fit as any).length?.toFixed?.(2), x.fit.radius?.toFixed?.(2), x.fit.width?.toFixed?.(2));
    expect(x.indices.length).toBeGreaterThan(0.7 * r.wallIdx.length); expect(x.fit.type).toBe(type); return x.fit;
  };
  it('slot', () => { const f = run([-0.5, 0, 0.866], [-47.4, 50, 32], 0, 29, 'Langloch'); full(f); }, 120000);
  it('circle', () => { const f = run([0, 0, 1], [-99.2, 205.5, 8], 0, 5.3, 'Kreis'); expect(f.radius!).toBeGreaterThan(2); expect(f.radius!).toBeLessThan(8); }, 120000);
});
