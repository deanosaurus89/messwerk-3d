// 0.38 F11 (Martin 19.10. 23:57, Major): “Boundary from: Point selection” – repeated re-extraction of a non-plane feature
// must respect the creation selection: stable, identical point count (before: the count grew with every re-extract).
import { samplePath } from './samplePath';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseSTL } from '../src/core/io';
import { MeshTopology, gather } from '../src/core/region';
import { fitType } from '../src/core/fit';
import { reextract, REEX_DEFAULT } from '../src/core/reextract';
import type { Vec3 } from '../src/core/linalg';
const buf = readFileSync(samplePath('beispielteil.stl'));
const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'beispielteil');
const topo = new MeshTopology(mesh), pos = mesh.positions, nrm = mesh.vertexNormals ?? null, F = mesh.indices;
function seed(pt: Vec3, n: Vec3) { const fn = mesh.faceNormals!; let b = -1, bd = Infinity; for (let t = 0; t < F.length / 3; t++) { if (fn[3*t]*n[0]+fn[3*t+1]*n[1]+fn[3*t+2]*n[2] < 0.9) continue; const v = F[3*t]; const d = (pos[3*v]-pt[0])**2+(pos[3*v+1]-pt[1])**2+(pos[3*v+2]-pt[2])**2; if (d < bd) { bd = d; b = t; } } return b; }
for (const margin of [0, 1.5]) for (const [name, type, pt, n] of [['hole Ø12 (cylinder)', 'Zylinder', [20 - 6.04, 20, 10], [1, 0, 0]], ['boss Ø16 (cylinder)', 'Zylinder', [55 + 8.05, 30, 26], [1, 0, 0]]] as const)
  it(`${name} margin ${margin}: repeated re-extract is stable`, () => {
    const tris = topo.growRegion(seed(pt as Vec3, n as Vec3), pt as Vec3, { maxAngleDeg: 20, radius: 0, type: type as any });
    const created = topo.regionVertices(tris).all; const g = gather(mesh, created, 1e9); const fit = { ...fitType(type as any, g.p, g.n), type: type as any };
    const P = { ...REEX_DEFAULT, margin, frozenIdx: created };
    let cur: Uint32Array = created, fitc = fit; const counts: number[] = [];
    for (let k = 0; k < 4; k++) { const r = reextract(fitc, pos, nrm, cur, P, [], F); counts.push(r.indices.length); cur = r.indices; fitc = { ...r.fit, type: type as any }; }
    // old behaviour (no creation set): grows – documented, not asserted
    let c2: Uint32Array = created, f2 = fit; const old: number[] = []; for (let k = 0; k < 3; k++) { const r = reextract(f2, pos, nrm, c2, { ...REEX_DEFAULT, margin }, [], F); old.push(r.indices.length); c2 = r.indices; f2 = { ...r.fit, type: type as any }; }
    console.log(name, 'created', created.length, 'reex', counts.join(','), '| without creation set', old.join(','));
    expect(new Set(counts.slice(1)).size).toBe(1); expect(counts[1]).toBe(counts[0]); if (!margin) expect(counts[0]).toBeLessThanOrEqual(created.length);
  });
