// 0.38.1 BLOCKER: Klick & Wachsen „Ebene" auf dem Multi-Feature-Scan lief über Verrundungen/Radien.
// Jede echte Planfläche muss in ihrer Fläche bleiben: < 3 % der Fläche mit Normale > 8° zur Flächennormale,
// und trotzdem die Fläche weitgehend erfassen (Mindestfläche).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { parseSTL } from '../src/core/io';
import { MeshTopology, setNormalMode } from '../src/core/region';
import type { Vec3 } from '../src/core/linalg';
it('multifeature: plane click & grow stays within its face', () => {
  const b = gunzipSync(readFileSync('public/samples/multifeature.stl.gz'));
  const mesh = parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'mf');
  const P = mesh.positions, F = mesh.indices, fn = mesh.faceNormals!, nt = F.length / 3, fa = mesh.faceAreas!;
  setNormalMode('robust'); const topo = new MeshTopology(mesh);
  const seeds: [string, Vec3, Vec3, number][] = [['top-left', [-100, 120, 0], [0, 0, 1], 4000], ['incl+', [40, 150, 0], [0.5, 0, 0.87], 9000], ['incl-', [-40, 150, 0], [-0.5, 0, 0.87], 9000], ['front', [0, 5, 10], [0, -1, 0], 2500]];
  for (const [nm, pt, n, minArea] of seeds) {
    let best = -1, bd = Infinity; for (let t = 0; t < nt; t++) { if (fn[3*t]*n[0]+fn[3*t+1]*n[1]+fn[3*t+2]*n[2] < 0.97) continue; const v = F[3*t]; const d = (P[3*v]-pt[0])**2+(P[3*v+1]-pt[1])**2; if (d < bd) { bd = d; best = t; } }
    const v = F[3*best]; const tr = topo.growRegion(best, [P[3*v], P[3*v+1], P[3*v+2]], { maxAngleDeg: 20, radius: 0, type: 'Ebene' as any });
    let a = 0, off = 0, sx = 0, sy = 0, sz = 0; for (const t of tr) { sx += fn[3*t]*fa[t]; sy += fn[3*t+1]*fa[t]; sz += fn[3*t+2]*fa[t]; } const l = Math.hypot(sx, sy, sz);
    for (const t of tr) { a += fa[t]; if ((fn[3*t]*sx+fn[3*t+1]*sy+fn[3*t+2]*sz)/l < Math.cos(8*Math.PI/180)) off += fa[t]; }
    expect(off / a, `${nm}: Anteil über Verrundungen`).toBeLessThan(0.03);
    expect(a, `${nm}: Fläche`).toBeGreaterThan(minArea);
    expect(a, `${nm}: nicht das ganze Teil`).toBeLessThan(0.25 * topo.totalArea);
  }
}, 300000);
