import { readFileSync } from 'node:fs'; import { gunzipSync } from 'node:zlib'; import { it } from 'vitest';
import { parseSTL } from '../src/core/io'; import { fitInPlane } from '../src/core/aux'; import { fitType } from '../src/core/fit';
it.skipIf(!process.env.MF)('gt', () => {
  const b = gunzipSync(readFileSync('public/samples/multifeature.stl.gz')); const mesh = parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'mf');
  const P = mesh.positions, F = mesh.indices, nt = F.length / 3, fn = mesh.faceNormals!;
  for (const [nm, c, N] of [['L', [-49.3, 50.6, 34.3], [-0.5, 0, 0.87]], ['R', [46, 50.5, 32], [0.5, 0, 0.87]]] as any) {
    const pts: any[] = [], pn: any[] = [], ppl: any[] = [];
    for (let t = 0; t < nt; t++) { const v = F[3*t]; const q = [P[3*v],P[3*v+1],P[3*v+2]]; const d = Math.hypot(q[0]-c[0],q[1]-c[1],q[2]-c[2]); if (d > 45) continue;
      const dn = fn[3*t]*N[0]+fn[3*t+1]*N[1]+fn[3*t+2]*N[2]; if (Math.abs(dn) < 0.1) { pts.push(q); } else if (dn > 0.995) { ppl.push(q); pn.push(N); } }
    const pl = fitType('Ebene', ppl, pn); let s = fitInPlane('Langloch', pts, pl); let cur = pts;
    for (let it = 0; it < 6; it++) { const lim = [5, 3, 2, 1, 0.6, 0.4][it]; const r = s.residuals!; cur = cur.filter((_: any, i: number) => Math.abs(r[i]) < lim); s = fitInPlane('Langloch', cur, pl, false); }
    console.log('pts kept', cur.length);
    console.log('GT', nm, 'wallPts', pts.length, 'len', s.length?.toFixed(2), 'w', s.width?.toFixed(2), 'c', s.center.map((x)=>x.toFixed(2)).join(','), 'dir', (s as any).direction?.map((x:number)=>x.toFixed(2)).join(','), 'rms', s.rms.toFixed(3), 'plane n', pl.normal.map((x)=>x.toFixed(3)).join(','));
  }
}, 600000);
