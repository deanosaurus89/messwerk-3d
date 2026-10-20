import { readFileSync } from 'node:fs'; import { gunzipSync } from 'node:zlib'; import { it } from 'vitest';
import { parseSTL } from '../src/core/io'; import { MeshTopology } from '../src/core/region'; import { fitType } from '../src/core/fit';
it.skipIf(!process.env.MF)('scan', () => {
  const b = gunzipSync(readFileSync('public/samples/multifeature.stl.gz')); const mesh = parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'mf');
  const P = mesh.positions, F = mesh.indices, nt = F.length / 3, fa = mesh.faceAreas!, fn = mesh.faceNormals!; const topo = new MeshTopology(mesh);
  const types = (process.env.TYPES ?? 'Zylinder,Kegel,Kugel,Torus').split(',');
  let seed = 99; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const cum = new Float64Array(nt); let acc = 0; for (let t = 0; t < nt; t++) cum[t] = acc += fa[t];
  const pickT = () => { const x = rnd() * acc; let a = 0, z = nt - 1; while (a < z) { const m = (a + z) >> 1; if (cum[m] < x) a = m + 1; else z = m; } return a; };
  for (let i = 0; i < +(process.env.N ?? 80); i++) { const t = pickT(); if (Math.abs(fn[3*t+2]) > 0.98) continue; const v = F[3*t]; const sp: [number,number,number] = [P[3*v],P[3*v+1],P[3*v+2]];
    for (const ty of types) { const tr = topo.growRegion(t, sp, { maxAngleDeg: 20, radius: 0, type: ty as any }); let a = 0; for (const u of tr) a += fa[u];
      const pts: any[] = [], nrm: any[] = []; for (let j = 0; j < tr.length; j += Math.max(1, Math.floor(tr.length/3000))) for (let k = 0; k < 3; k++) { const u = F[3*tr[j]+k]; pts.push([P[3*u],P[3*u+1],P[3*u+2]]); nrm.push([fn[3*tr[j]],fn[3*tr[j]+1],fn[3*tr[j]+2]]); }
      let f: any = null; try { f = fitType(ty as any, pts, nrm); } catch (e) { console.log('E', String(e)); }
      if (f && f.rms < 0.05 && a > 30)
      console.log('S', ty, t, sp.map(x=>x.toFixed(1)).join(','), 'area', a.toFixed(0), 'r', f.radius?.toFixed(2), 'ang', f.angle?.toFixed?.(1) ?? f.halfAngle?.toFixed?.(1) ?? '', 'R', f.majorRadius?.toFixed?.(2) ?? '', 'c', f.center.map((x:number)=>x.toFixed(1)).join(','), 'n', (f.axis ?? f.normal).map((x:number)=>x.toFixed(2)).join(','), 'rms', f.rms.toFixed(3)); } }
}, 600000);
