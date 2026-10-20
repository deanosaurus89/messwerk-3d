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

// 0.39: Zylinder (Bolzen hinten rechts, Ø ≈ 20.4, Achse Z) – typisiertes Klick & Wachsen bleibt auf dem Mantel
import { fitType, modelNormal } from '../src/core/fit';
it('multifeature: cylinder (pin) click & grow stays on the mantle', () => {
  const b = gunzipSync(readFileSync('public/samples/multifeature.stl.gz'));
  const mesh = parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'mf');
  const P = mesh.positions, F = mesh.indices, fn = mesh.faceNormals!, nt = F.length / 3, fa = mesh.faceAreas!;
  setNormalMode('robust'); const topo = new MeshTopology(mesh);
  let best = -1, bd = Infinity; for (let t = 0; t < nt; t++) { if (Math.abs(fn[3*t+2]) > 0.1) continue; const v = F[3*t]; const d = (P[3*v]-76)**2+(P[3*v+1]-225.3)**2+(P[3*v+2]-25)**2; if (d < bd) { bd = d; best = t; } }
  const v = F[3*best]; const tr = topo.growRegion(best, [P[3*v], P[3*v+1], P[3*v+2]], { maxAngleDeg: 20, radius: 0, type: 'Zylinder' as any });
  const pts: [number, number, number][] = [], nr: [number, number, number][] = []; for (const u of tr) { const w = F[3*u]; pts.push([P[3*w], P[3*w+1], P[3*w+2]]); nr.push([fn[3*u], fn[3*u+1], fn[3*u+2]]); }
  const f = fitType('Zylinder', pts, nr); let a = 0, off = 0;
  tr.forEach((u, i) => { const mn = modelNormal(f, pts[i]); a += fa[u]; if (Math.abs(mn[0]*nr[i][0]+mn[1]*nr[i][1]+mn[2]*nr[i][2]) < Math.cos(10*Math.PI/180)) off += fa[u]; });
  expect(f.radius!).toBeGreaterThan(9.9); expect(f.radius!).toBeLessThan(10.5); expect(Math.abs(f.normal[2])).toBeGreaterThan(Math.cos(2*Math.PI/180));
  expect(off / a).toBeLessThan(0.03); expect(a).toBeGreaterThan(700);
}, 300000);
