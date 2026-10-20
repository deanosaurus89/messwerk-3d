import { readFileSync } from 'node:fs'; import { gunzipSync } from 'node:zlib'; import { it } from 'vitest';
import { parseSTL } from '../src/core/io'; import { MeshTopology } from '../src/core/region'; import { extractAtRim } from '../src/core/aux';
it.skipIf(!process.env.MF)('slot seeds', () => {
  const b = gunzipSync(readFileSync('public/samples/multifeature.stl.gz')); const mesh = parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'mf');
  const P = mesh.positions, F = mesh.indices, nt = F.length / 3, fn = mesh.faceNormals!; const topo = new MeshTopology(mesh);
  const N = [-0.5, 0, 0.866], C = [-47.4, 50, 32]; const u0 = [0.866, 0, 0.5], w0 = [0, 1, 0]; // in-plane frame (u ⟂ y)
  const at = (uu: number, ww: number) => { let best = -1, bd = 1e9; for (let t = 0; t < nt; t++) { if (Math.abs(fn[3*t]*N[0]+fn[3*t+1]*N[1]+fn[3*t+2]*N[2]) > 0.05) continue;
    const v = F[3*t]; const q = [P[3*v]-C[0],P[3*v+1]-C[1],P[3*v+2]-C[2]]; const a = q[0]*u0[0]+q[2]*u0[2], c = q[1]; const d = (a-uu)**2+(c-ww)**2; if (d < bd) { bd = d; best = t; } } return best; };
  for (const [nm, uu, ww] of [['wall+', 12.5, 0], ['wall-', -12.5, 5], ['arc+', 0, 29], ['arc-', 0, -29], ['corner', 9, 22]] as any) {
    const t = at(uu, ww); const v = F[3*t]; const sp: any = [P[3*v],P[3*v+1],P[3*v+2]]; const t0 = performance.now();
    for (const seedR of [0, 1.5]) try { const r = extractAtRim(mesh, topo, t, sp, { maxAngleDeg: 20, radius: 0, seedR }, 'Langloch', 340); const f = r.fit;
      console.log('SL', nm, 'seedR', seedR, 'len', f.length?.toFixed(2), 'w', f.width?.toFixed(2), 'c', f.center.map((x)=>x.toFixed(1)).join(','), 'rms', f.rms.toFixed(3), 'wall', r.wallIdx.length, 'plane', r.planeIdx.length, (performance.now()-t0).toFixed(0), 'ms');
    } catch (e) { console.log('SL', nm, 'ERR', String(e).slice(0, 100)); } }
}, 700000);
