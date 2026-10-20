import { readFileSync } from 'node:fs'; import { gunzipSync } from 'node:zlib'; import { it } from 'vitest';
import { parseSTL } from '../src/core/io'; import { MeshTopology } from '../src/core/region'; import { extractAtRim } from '../src/core/aux';
it.skipIf(!process.env.MF)('slot scan', () => {
  const b = gunzipSync(readFileSync('public/samples/multifeature.stl.gz')); const mesh = parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'mf');
  const P = mesh.positions, F = mesh.indices, nt = F.length / 3, fn = mesh.faceNormals!; const topo = new MeshTopology(mesh);
  let seed = 5; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  // wall-ish triangles: normal perpendicular to one of the main plane normals
  const axes = [[0,0,1],[0.5,0,0.87],[-0.5,0,0.87],[0,1,0]];
  let n = 0;
  for (let i = 0; i < 400000 && n < +(process.env.N ?? 40); i++) { const t = Math.floor(rnd() * nt); const ax = axes[n % axes.length];
    const d = Math.abs(fn[3*t]*ax[0]+fn[3*t+1]*ax[1]+fn[3*t+2]*ax[2]); if (d > 0.05) continue; n++;
    const v = F[3*t]; const sp: any = [P[3*v],P[3*v+1],P[3*v+2]];
    try { const r = extractAtRim(mesh, topo, t, sp, { maxAngleDeg: 20, radius: 0 }, 'Langloch', 340); const f = r.fit;
      console.log('L', t, sp.map((x:number)=>x.toFixed(1)).join(','), 'ax', ax.join(','), 'len', f.length?.toFixed(2), 'w', f.width?.toFixed(2), 'c', f.center.map((x)=>x.toFixed(1)).join(','), 'rms', f.rms.toFixed(3), 'wall', r.wallIdx.length);
    } catch (e) {} }
}, 700000);
