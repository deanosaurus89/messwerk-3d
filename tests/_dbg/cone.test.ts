import { samplePath } from '../samplePath';
// Scan-ähnliche Demo-Teile: automatische Extraktion an den Prüfpunkten (probe) gegen die dokumentierte Soll-Geometrie (samples/*.json).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseByName } from '../../src/core/io';
import { MeshTopology } from '../../src/core/region';
import { autoExtract } from '../../src/core/aux';
import type { Vec3 } from '../../src/core/linalg';

function load(key: string) {
  const nom = JSON.parse(readFileSync(samplePath(`${key}.json`), 'utf8'));
  const buf = readFileSync(samplePath(`${nom.file}`));
  const mesh = parseByName(nom.file, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  return { nom, mesh, topo: new MeshTopology(mesh) };
}
function nearestTri(mesh: any, pt: Vec3) {
  const p = mesh.positions, f = mesh.indices; let best = -1, bd = Infinity;
  for (let t = 0; t < f.length / 3; t++) {
    const a = 3 * f[3 * t], b = 3 * f[3 * t + 1], c = 3 * f[3 * t + 2];
    const d = ((p[a] + p[b] + p[c]) / 3 - pt[0]) ** 2 + ((p[a + 1] + p[b + 1] + p[c + 1]) / 3 - pt[1]) ** 2 + ((p[a + 2] + p[b + 2] + p[c + 2]) / 3 - pt[2]) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
import { setNormalMode as snm } from '../../src/core/region';
for (const mode of ['needle036', 'robust'] as const) it('cone ' + mode, () => {
  snm(mode); const { nom, mesh, topo } = load('flansch'); const f = nom.features.find((x: any) => x.type === 'Kegel');
  const t = nearestTri(mesh, f.probe); const tr = topo.growRegion(t, f.probe, { maxAngleDeg: 20, radius: 0 });
  const P = mesh.positions, F = mesh.indices; let zl = 1e9, zh = -1e9, rl = 1e9, rh = -1e9; const c = [0, 0, 0];
  for (const x of tr) for (let k = 0; k < 3; k++) { const v = F[3 * x + k]; zl = Math.min(zl, P[3 * v + 2]); zh = Math.max(zh, P[3 * v + 2]); const r = Math.hypot(P[3*v]-c[0], P[3*v+1]-c[1]); rl = Math.min(rl, r); rh = Math.max(rh, r); }
  { const tl = topo.growRegion(t, f.probe, { maxAngleDeg: 20, radius: 0, legacy: true }); let a = 1e9, b = -1e9; for (const x of tl) { const v = F[3 * x]; a = Math.min(a, P[3*v+2]); b = Math.max(b, P[3*v+2]); } console.log('CONE', mode, 'legacy', tl.length, a.toFixed(2), b.toFixed(2)); }
  const r = autoExtract(mesh, topo, t, f.probe, { maxAngleDeg: 20, radius: 0 }, 300); const m: any = r.fit;
  console.log('CONE', mode, JSON.stringify(f), 'tris', tr.length, 'z', zl.toFixed(2), zh.toFixed(2), 'r', rl.toFixed(2), rh.toFixed(2), JSON.stringify(topo.lastGrow), m.type, (2 * m.halfAngle * 180 / Math.PI).toFixed(3), r.indices.length);
});
it('cprof', () => {
  snm('robust'); const { mesh, topo } = load('flansch'); const P = mesh.positions, F = mesh.indices, fn = mesh.faceNormals!; const rows: [number, string][] = [];
  for (let t = 0; t < F.length / 3; t++) { const c = [0,1,2].map(k=>(P[3*F[3*t]+k]+P[3*F[3*t+1]+k]+P[3*F[3*t+2]+k])/3); if (Math.abs(c[0])>0.3 || c[1] > 0 || c[2]<77 || c[2]>95) continue; const n = topo.N(t);
    rows.push([c[2], `z=${c[2].toFixed(2)} r=${Math.hypot(c[0],c[1]).toFixed(2)} raw=${(Math.acos(fn[3*t+2])*57.3).toFixed(0)} rob=${(Math.acos(n[3*t+2])*57.3).toFixed(0)} K=${topo.K(t).toFixed(2)}`]); }
  rows.sort((a,b)=>a[0]-b[0]); console.log('PROF\n'+rows.map(r=>r[1]).join('\n'));
});
it('leak', () => {
  snm('robust'); const { nom, mesh, topo } = load('flansch'); const f = nom.features.find((x: any) => x.type === 'Kegel'); const P = mesh.positions, F = mesh.indices, fn = mesh.faceNormals!;
  const t0 = nearestTri(mesh, f.probe); const tl = topo.growRegion(t0, f.probe, { maxAngleDeg: 20, radius: 0, legacy: true }); const inR = new Uint8Array(F.length / 3); for (const x of tl) inR[x] = 1;
  const cen = (t: number) => [0,1,2].map(k=>(P[3*F[3*t]+k]+P[3*F[3*t+1]+k]+P[3*F[3*t+2]+k])/3);
  const onC = (t: number) => { const c = cen(t); return c[2] > 79.9 && c[2] < 92.1 && Math.abs(Math.hypot(c[0], c[1]) - (18 - (c[2] - 80) * 0.5)) < 0.15; };
  let n = 0; for (const t of tl) { if (onC(t)) continue; for (const u of topo.neighbors(t)) if (inR[u] && onC(u)) { if (n++ < 8) { const a = topo.N(t), b = topo.N(u); console.log('LEAK', cen(t).map(x=>x.toFixed(2)).join(','), 'nT', [0,1,2].map(k=>a[3*t+k].toFixed(2)).join(','), 'raw', [0,1,2].map(k=>fn[3*t+k].toFixed(2)).join(','), 'K', topo.K(t).toFixed(2), '| cone nb nU', [0,1,2].map(k=>b[3*u+k].toFixed(2)).join(','), 'K', topo.K(u).toFixed(2), 'needle', topo.needle[t], topo.sliver[t]); } break; } }
  console.log('LEAK count', n);
});
it('vtx', () => {
  snm('robust'); const { nom, mesh, topo } = load('flansch'); const f = nom.features.find((x: any) => x.type === 'Kegel'); const P = mesh.positions, F = mesh.indices;
  const t0 = nearestTri(mesh, f.probe); topo.growRegion(t0, f.probe, { maxAngleDeg: 20, radius: 0, legacy: true });
  for (let t = 0; t < F.length / 3; t++) { if (!topo.sReady[t]) continue; const n = topo.N(t); if (n[3*t+2] < 0.07 || n[3*t+2] > 0.3) continue; const c = [0,1,2].map(k=>(P[3*F[3*t]+k]+P[3*F[3*t+1]+k]+P[3*F[3*t+2]+k])/3); if (c[2] < 91 || c[2] > 93) continue;
    const vs = [0,1,2].map(k => { const v = F[3*t+k]; const o = topo.rn!.get(v); return `v(z=${P[3*v+2].toFixed(2)} r=${Math.hypot(P[3*v],P[3*v+1]).toFixed(2)}) n=${[0,1,2].map(j=>o[3*v+j].toFixed(2)).join(',')}`; });
    console.log('VTX tri', n[3*t+2].toFixed(2), vs.join(' ; ')); }
});
