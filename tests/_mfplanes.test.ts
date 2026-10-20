import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { it } from 'vitest';
import { parseSTL } from '../src/core/io';
import { MeshTopology, setNormalMode } from '../src/core/region';
import type { Vec3 } from '../src/core/linalg';
const b = gunzipSync(readFileSync('public/samples/multifeature.stl.gz'));
const mesh = parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'mf');
const P = mesh.positions, F = mesh.indices, fn = mesh.faceNormals!, nt = F.length / 3, fa = mesh.faceAreas!;
it.skipIf(!process.env.MF)('mf planes', () => {
  // seeds: largest-area clusters by normal direction – pick triangles with |n| along main axes at several spots
  const seeds: [string, Vec3, Vec3][] = [['top-left', [-100, 120, 0], [0, 0, 1]], ['top-mid', [0, 50, 0], [0, 0, 1]], ['bottom', [0, 120, 0], [0, 0, -1]], ['incl+', [40, 150, 0], [0.5, 0, 0.87]], ['incl-', [-40, 150, 0], [-0.5, 0, 0.87]], ['front', [0, 5, 10], [0, -1, 0]]];
  for (const mode of (process.env.MODES ?? 'needle036,robust').split(',') as any[]) { setNormalMode(mode); const topo = new MeshTopology(mesh);
    for (const [nm, pt, n] of seeds) { let best = -1, bd = Infinity; for (let t = 0; t < nt; t++) { if (fn[3*t]*n[0]+fn[3*t+1]*n[1]+fn[3*t+2]*n[2] < 0.97) continue; const v = F[3*t]; const d = (P[3*v]-pt[0])**2+(P[3*v+1]-pt[1])**2; if (d < bd) { bd = d; best = t; } }
      const v = F[3*best]; const sp: Vec3 = [P[3*v], P[3*v+1], P[3*v+2]]; const t0 = performance.now();
      const tr = topo.growRegion(best, sp, { maxAngleDeg: 20, radius: 0, type: 'Ebene' as any }); const ms = performance.now() - t0;
      let a = 0, off = 0, sx = 0, sy = 0, sz = 0; for (const t of tr) { sx += fn[3*t]*fa[t]; sy += fn[3*t+1]*fa[t]; sz += fn[3*t+2]*fa[t]; } const l = Math.hypot(sx, sy, sz); for (const t of tr) { a += fa[t]; if ((fn[3*t]*sx+fn[3*t+1]*sy+fn[3*t+2]*sz)/l < Math.cos(8*Math.PI/180)) off += fa[t]; }
      console.log('MF', mode, nm, 'seedZ', sp[2].toFixed(1), 'tris', tr.length, 'area', a.toFixed(0), 'offAngle%', (100*off/a).toFixed(1), JSON.stringify(topo.lastGrow).slice(60, 260), ms.toFixed(0), 'ms'); } }
}, 600000);
