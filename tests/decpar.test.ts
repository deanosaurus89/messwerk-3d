import { describe, it, expect } from 'vitest'; import * as THREE from 'three';
import { decimate, buildBVH, boundaryEdges } from '../src/core/polyedit'; import { decimateParallel } from '../src/core/decpar';
function sphereMesh() { const g = new THREE.SphereGeometry(20, 160, 100); const pos = g.getAttribute('position').array as Float32Array; const idx = g.getIndex()!.array;
  // Pole/Saum verschweißen
  const key = (i: number) => [0, 1, 2].map((k) => Math.round(pos[3 * i + k] * 1e4)).join(','); const m = new Map<string, number>(); const P: number[] = []; const re = new Uint32Array(pos.length / 3);
  for (let i = 0; i < pos.length / 3; i++) { const k = key(i); let j = m.get(k); if (j === undefined) { j = P.length / 3; m.set(k, j); P.push(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]); } re[i] = j; }
  const F: number[] = []; for (let t = 0; t < idx.length; t += 3) { const a = re[idx[t]], b = re[idx[t + 1]], c = re[idx[t + 2]]; if (a !== b && b !== c && c !== a) F.push(a, b, c); }
  return { positions: new Float32Array(P), indices: new Uint32Array(F) }; }
const devV = (A: any, B: any) => { const bv = buildBVH(B); const q = new THREE.Vector3(); const t: any = {}; let mx = 0; for (let i = 0; i < A.positions.length; i += 3) { q.set(A.positions[i], A.positions[i + 1], A.positions[i + 2]); mx = Math.max(mx, bv.closestPointToPoint(q, t)!.distance); } return mx; };
describe('parallele Reduktion', () => {
  it('Scheiben + Naht: Toleranz beidseitig, geschlossen, ähnlich stark wie seriell', async () => {
    const m = sphereMesh(); const tol = 0.05;
    const s = decimate(m, { tol }); const p = await decimateParallel(m, { tol }, 4, async (c) => decimate(c, { tol }));
    expect(boundaryEdges(p.indices, p.positions.length / 3).count).toBe(0);
    expect(devV(m, p)).toBeLessThanOrEqual(tol * 1.001); expect(devV(p, m)).toBeLessThanOrEqual(tol * 1.001);
    expect(p.after).toBeLessThan(s.after * 1.25);
  }, 120000);
});
