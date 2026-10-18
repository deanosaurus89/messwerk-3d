import { describe, expect, it } from 'vitest';
import { fillOuterBoundary } from '../src/core/fillplane';
import type { FitResult } from '../src/core/fit';

// synthetic scanned plate 60×40, top face z = 0 (+ bumps/spatter, one crater), through hole Ø8 with 0.3 chamfer,
// bottom face z = −5. Region growing (simulated) left out the bumps, the crater and everything at the hole.
function plate() {
  const pos: number[] = [], nrm: number[] = [], kind: string[] = [];
  const bumps = [[15, 10, 0.12, 1.2], [45, 30, 0.2, 1.5], [30, 33, 0.08, 0.8]]; // x, y, height, sigma
  const crater = [48, 10, -0.06, 1.0];
  const add = (p: number[], n: number[], k: string) => { pos.push(...p); nrm.push(...n); kind.push(k); };
  for (let x = 0; x <= 60; x += 0.5) for (let y = 0; y <= 40; y += 0.5) {
    const r = Math.hypot(x - 30, y - 20); if (r < 4.3) continue; // hole + chamfer handled below
    let z = 0, gx = 0, gy = 0, k = 'face';
    for (const [bx, by, bh, bs] of [...bumps, crater]) { const e = bh * Math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (2 * bs * bs)); z += e; gx += (-e * (x - bx)) / (bs * bs); gy += (-e * (y - by)) / (bs * bs); if (Math.abs(e) > 0.01) k = bh > 0 ? 'bump' : 'crater'; }
    const l = Math.hypot(gx, gy, 1); add([x, y, z], [-gx / l, -gy / l, 1 / l], k);
    add([x, y, -5], [0, 0, -1], 'bottom');
  }
  for (let a = 0; a < 360; a += 4) { const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180);
    for (const [rr, zz] of [[4.3, -0.05], [4.15, -0.15], [4.0, -0.3]]) add([30 + rr * c, 20 + rr * s, zz], [-c * 0.7, -s * 0.7, 0.7], 'chamfer');
    for (let z = -0.5; z >= -5; z -= 0.5) add([30 + 4 * c, 20 + 4 * s, z], [-c, -s, 0], 'wall'); }
  return { pos: Float64Array.from(pos), nrm: Float64Array.from(nrm), kind };
}

describe('Capture all points inside outer boundary (plane)', () => {
  const { pos, nrm, kind } = plate();
  const seed = kind.map((k, i) => (k === 'face' ? i : -1)).filter((i) => i >= 0);
  const fit = { type: 'Ebene', center: [30, 20, 0], normal: [0, 0, 1] } as unknown as FitResult;
  const r = fillOuterBoundary(pos, nrm, Uint32Array.from(seed), fit, { band: 1 });
  const got = new Set(r.indices), count = (k: string) => kind.filter((x, i) => x === k && got.has(i)).length, all = (k: string) => kind.filter((x) => x === k).length;
  it('keeps bumps, spatter and craters on the face', () => {
    expect(count('bump')).toBe(all('bump')); expect(count('crater')).toBe(all('crater')); expect(count('face')).toBe(all('face'));
  });
  it('excludes the real opening (bore wall, chamfer) and the opposite face', () => {
    expect(count('wall')).toBe(0); expect(count('chamfer')).toBe(0); expect(count('bottom')).toBe(0);
  });
  it('flatness of the captured points includes the bumps (not just the clean face)', () => {
    let mn = Infinity, mx = -Infinity; for (const i of r.indices) { mn = Math.min(mn, pos[3 * i + 2]); mx = Math.max(mx, pos[3 * i + 2]); }
    expect(mx - mn).toBeGreaterThan(0.25); // 0.2 bump + 0.06 crater
  });
});
