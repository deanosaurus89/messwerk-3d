import { readFileSync } from 'node:fs'; import { gunzipSync } from 'node:zlib'; import { it } from 'vitest';
import { parseSTL } from '../src/core/io'; import { MeshTopology } from '../src/core/region'; import { fitType, modelNormal } from '../src/core/fit';
it.skipIf(!process.env.MF)('types', () => {
  const b = gunzipSync(readFileSync('public/samples/multifeature.stl.gz')); const mesh = parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'mf');
  const P = mesh.positions, F = mesh.indices, nt = F.length / 3, fn = mesh.faceNormals!, fa = mesh.faceAreas!; const topo = new MeshTopology(mesh);
  const near = (x: number, y: number, z: number, nz: [number, number]) => { let best = -1, bd = 1e9; for (let t = 0; t < nt; t++) { const a = Math.abs(fn[3*t+2]); if (a < nz[0] || a > nz[1]) continue; const v = F[3*t]; const d = (P[3*v]-x)**2+(P[3*v+1]-y)**2+(P[3*v+2]-z)**2; if (d < bd) { bd = d; best = t; } } return best; };
  for (const [nm, ty, x, y, z, nz] of JSON.parse(process.env.SEEDS ?? '[]')) {
    const t = near(x, y, z, nz); const v = F[3*t]; const sp: any = [P[3*v],P[3*v+1],P[3*v+2]];
    const tr = topo.growRegion(t, sp, { maxAngleDeg: 20, radius: 0, type: ty }); const pts: any[] = [], nr: any[] = [];
    for (const u of tr) { const w = F[3*u]; pts.push([P[3*w],P[3*w+1],P[3*w+2]]); nr.push([fn[3*u],fn[3*u+1],fn[3*u+2]]); }
    let f: any = null; try { f = fitType(ty, pts, nr); } catch (e) { console.log('E', String(e)); }
    let a = 0, off = 0; if (f) tr.forEach((u, i) => { const mn = modelNormal(f, pts[i]); a += fa[u]; if (Math.abs(mn[0]*nr[i][0]+mn[1]*nr[i][1]+mn[2]*nr[i][2]) < Math.cos(10*Math.PI/180)) off += fa[u]; });
    console.log('T', nm, ty, 'seed', sp.map((q: number) => q.toFixed(1)).join(','), 'tris', tr.length, 'area', a.toFixed(0), 'off%', (100*off/a).toFixed(1), 'r', f?.radius?.toFixed(2), 'ha', f?.halfAngle ? (f.halfAngle*57.3).toFixed(1) : '', 'c', f?.center?.map((q: number) => q.toFixed(1)).join(','), 'n', f?.normal?.map((q: number) => q.toFixed(2)).join(','), 'rms', f?.rms?.toFixed(3), JSON.stringify(topo.lastGrow).slice(0, 60));
  }
}, 600000);
