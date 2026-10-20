// 0.39 (Martin): Langloch auf dem Multi-Feature-Scan – Klick auf die gerade Wand, auf einen Bogen oder an die Ecke liefert
// das GANZE Langloch (Wand entlang der Kontur verfolgt), und „Region hinzufügen“ vereinigt Teilstücke zu einem Langloch.
import { readFileSync } from 'node:fs'; import { gunzipSync } from 'node:zlib'; import { describe, expect, it } from 'vitest';
import { parseSTL } from '../src/core/io'; import { MeshTopology } from '../src/core/region'; import { extractAtRim, mergeAuxWall } from '../src/core/aux';
import type { Vec3 } from '../src/core/linalg';
const b = gunzipSync(readFileSync('public/samples/multifeature.stl.gz'));
const mesh = parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'mf');
const P = mesh.positions, F = mesh.indices, nt = F.length / 3, fn = mesh.faceNormals!; const topo = new MeshTopology(mesh);
const SLOTS: [string, Vec3, Vec3, number][] = [['left', [-0.5, 0, 0.866], [-47.4, 50, 32], 12.5], ['right', [0.516, -0.018, 0.857], [45.5, 50.5, 31], 11.5]];
const frame = (N: Vec3) => { const u = [N[2], 0, -N[0]]; const l = Math.hypot(u[0], u[2]); return [u[0] / l, 0, u[2] / l]; };
const at = (N: Vec3, C: Vec3, uu: number, ww: number) => { const u = frame(N); let best = -1, bd = 1e9; for (let t = 0; t < nt; t++) { if (Math.abs(fn[3*t]*N[0]+fn[3*t+1]*N[1]+fn[3*t+2]*N[2]) > 0.05) continue;
  const v = F[3*t]; const q = [P[3*v]-C[0], P[3*v+1]-C[1], P[3*v+2]-C[2]]; if (Math.abs(q[0]*N[0]+q[1]*N[1]+q[2]*N[2]) > 8) continue; const a = q[0]*u[0]+q[2]*u[2], c = q[1]; const d = (a-uu)**2+(c-ww)**2; if (d < bd) { bd = d; best = t; } } return best; };
const pt = (t: number): Vec3 => { const v = F[3*t]; return [P[3*v], P[3*v+1], P[3*v+2]]; };
const full = (f: any) => { if (process.env.DBG) console.log('FIT', f.type, f.length?.toFixed(2), f.width?.toFixed(2), f.center.map((x: number) => x.toFixed(1)).join(',')); expect(f.type).toBe('Langloch'); expect(f.length).toBeGreaterThan(55); expect(f.length).toBeLessThan(60); expect(f.width).toBeGreaterThan(22); expect(f.width).toBeLessThan(25); };
for (const [nm, N, C, hw] of SLOTS) describe(`multifeature slot ${nm}`, () => {
  for (const [where, uu, ww] of [['straight wall', hw, 0], ['other straight wall', -hw, 5], ['arc', 0, 29], ['other arc', 0, -29], ['corner', 9, 22]] as [string, number, number][])
    it(`click on ${where} gives the full slot`, () => { const t = at(N, C, uu, ww); for (const seedR of [0, 1.5]) full(extractAtRim(mesh, topo, t, pt(t), { maxAngleDeg: 20, radius: 0, seedR }, 'Langloch', 340).fit); }, 120000);
  it('partial wall + Add Region on the opposite arc merges into the full slot', () => {
    const t = at(N, C, 0, 29); const r = extractAtRim(mesh, topo, t, pt(t), { maxAngleDeg: 20, radius: 0 }, 'Langloch', 340);
    // Teilstück: nur die Wandpunkte der oberen Hälfte (wie ein früheres, halbes Ergebnis)
    const half = r.wallIdx.filter((v) => P[3*v+1] > C[1] + 5); const t2 = at(N, C, 0, -29);
    const m = mergeAuxWall(mesh, topo, t2, pt(t2), { maxAngleDeg: 20, radius: 0 }, 'Langloch', r.plane, half); full(m.fit);
  }, 120000);
});
