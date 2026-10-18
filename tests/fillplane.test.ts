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
  it('a raised feature (boss) is not excluded by default but reported; excludeRaised drops it entirely', () => {
    const P: number[] = [...pos], Nn: number[] = [...nrm], K = [...kind];
    // boss Ø6 at (12, 30), 5 high, with a small base fillet: drop face points under it, add wall + fillet + top
    const keep: number[] = []; for (let i = 0; i < K.length; i++) if (!(K[i] === 'face' && Math.hypot(P[3 * i] - 12, P[3 * i + 1] - 30) < 3.6)) keep.push(i);
    const p2: number[] = [], n2: number[] = [], k2: string[] = []; for (const i of keep) { p2.push(P[3 * i], P[3 * i + 1], P[3 * i + 2]); n2.push(Nn[3 * i], Nn[3 * i + 1], Nn[3 * i + 2]); k2.push(K[i]); }
    for (let a = 0; a < 360; a += 5) { const c = Math.cos(a * Math.PI / 180), s2 = Math.sin(a * Math.PI / 180);
      for (const [rr, zz, nz] of [[3.5, 0.05, 0.8], [3.2, 0.25, 0.4]]) { p2.push(12 + rr * c, 30 + rr * s2, zz); n2.push(c * 0.6, s2 * 0.6, nz); k2.push('boss'); }
      for (let z = 0.5; z <= 5; z += 0.5) { p2.push(12 + 3 * c, 30 + 3 * s2, z); n2.push(c, s2, 0); k2.push('boss'); } }
    const sd = k2.map((k, i) => (k === 'face' ? i : -1)).filter((i) => i >= 0);
    const r2 = fillOuterBoundary(Float64Array.from(p2), Float64Array.from(n2), Uint32Array.from(sd), fit, { band: 1 });
    const rs = new Set(r2.raised); expect(k2.filter((k, i) => k === 'boss' && pos && rs.has(i)).length).toBeGreaterThan(0);
    expect(k2.filter((k, i) => k === 'bump' && rs.has(i)).length).toBe(0);
    const r3 = fillOuterBoundary(Float64Array.from(p2), Float64Array.from(n2), Uint32Array.from(sd), fit, { band: 1, excludeRaised: true });
    const g2 = new Set(r3.indices);
    expect(k2.filter((k, i) => k === 'boss' && g2.has(i)).length).toBe(0);
    expect(k2.filter((k, i) => k === 'bump' && g2.has(i)).length).toBe(k2.filter((k) => k === 'bump').length);
  });
  it('realistic: bumps 1–2 mm, spatter ring around a hole, narrow strip at a slot – all kept with the defaults; contour returned', () => {
    // plate 80×50 top z=0, bottom z=−8; bump patch 1.8 high; hole Ø6 at (60,15) with a spatter ring (r 3..6, up to 1.5);
    // slot 3 wide at x 70..73, y 30..42 next to the edge x=76 (strip 3 mm the region growing missed)
    const P: number[] = [], Nn: number[] = [], K: string[] = [];
    const add = (p: number[], n: number[], k: string) => { P.push(...p); Nn.push(...n); K.push(k); };
    let seedR = 7; const rnd = () => ((seedR = (seedR * 16807) % 2147483647) / 2147483647);
    const spl: number[][] = []; for (let k = 0; k < 14; k++) { const a = rnd() * 2 * Math.PI, rr = 3.6 + rnd() * 2; spl.push([60 + rr * Math.cos(a), 15 + rr * Math.sin(a), 0.4 + rnd() * 1.1, 0.5 + rnd() * 0.5]); }
    const bumps = [[25, 35, 1.8, 2.5], [40, 12, 1.0, 1.5], ...spl];
    for (let x = 0; x <= 76; x += 0.5) for (let y = 0; y <= 50; y += 0.5) {
      const inSlot = x > 70 && x < 73 && y > 30 && y < 42, rh = Math.hypot(x - 60, y - 15);
      if (!inSlot && rh >= 3) { let z = 0, gx = 0, gy = 0, k = 'face';
        for (const [bx, by, bh, bs] of bumps) { const e = bh * Math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (2 * bs * bs)); z += e; gx += (-e * (x - bx)) / (bs * bs); gy += (-e * (y - by)) / (bs * bs); if (e > 0.02) k = 'bump'; }
        if (k === 'face' && x > 73 && y > 26 && y < 46) k = 'strip';
        const l = Math.hypot(gx, gy, 1); add([x, y, z], [-gx / l, -gy / l, 1 / l], k); }
      add([x, y, -8], [0, 0, -1], 'bottom');
    }
    for (let a = 0; a < 360; a += 4) { const c = Math.cos(a * Math.PI / 180), s2 = Math.sin(a * Math.PI / 180); for (let z = -0.3; z >= -8; z -= 0.4) add([60 + 3 * c, 15 + 3 * s2, z], [-c, -s2, 0], 'wall'); }
    for (let y = 30; y <= 42; y += 0.4) for (let z = -0.3; z >= -8; z -= 0.4) { add([70, y, z], [1, 0, 0], 'wall'); add([73, y, z], [-1, 0, 0], 'wall'); }
    for (let y = 0; y <= 50; y += 0.5) for (let z = -0.5; z >= -7.5; z -= 0.5) add([76, y, z], [1, 0, 0], 'side');
    const sd = K.map((k, i) => (k === 'face' ? i : -1)).filter((i) => i >= 0);
    const fit2 = { type: 'Ebene', center: [38, 25, 0], normal: [0, 0, 1] } as unknown as FitResult;
    const r4 = fillOuterBoundary(Float64Array.from(P), Float64Array.from(Nn), Uint32Array.from(sd), fit2);
    const g = new Set(r4.indices), cnt = (k: string) => K.filter((x, i) => x === k && g.has(i)).length, tot = (k: string) => K.filter((x) => x === k).length;
    const bumpPts = K.map((k, i) => (k === 'bump' ? i : -1)).filter((i) => i >= 0), maxZ = Math.max(...bumpPts.map((i) => P[3 * i + 2]));
    const inBand = bumpPts.filter((i) => P[3 * i + 2] <= 2).length;
    expect(maxZ).toBeGreaterThan(1.5);
    expect(cnt('bump')).toBe(tot('bump')); expect(inBand).toBeLessThan(tot('bump')); // tips above the band are captured too expect(cnt('strip')).toBe(tot('strip'));
    expect(cnt('wall')).toBe(0); expect(cnt('bottom')).toBe(0); expect(cnt('side')).toBe(0);
    expect(r4.raisedCount).toBe(0);
    // contour = boundary of the captured points: outer loop + loops around the hole and the slot
    expect(r4.contour.length).toBeGreaterThanOrEqual(1); const outer = r4.contour.reduce((a, b) => (b.length > a.length ? b : a)); expect(outer.length).toBeGreaterThan(20);
    const xs4 = outer.map((q) => q[0]); expect(Math.min(...xs4)).toBeLessThan(1.5); expect(Math.max(...xs4)).toBeGreaterThan(74.5);
  });
});

describe('All inside boundary – plate with edge fillets and side walls (regression 0.19)', () => {
  it('contour never beyond the grown region, no fillet/wall points, flatness ≈ grown + bumps', () => {
    // plate 60×40, top z=0 with 1 mm bump and spatter; edge fillet R=3 all around, side walls down to −10, through hole
    const P: number[] = [], Nn: number[] = [], K: string[] = []; const add = (p: number[], n: number[], k: string) => { P.push(...p); Nn.push(...n); K.push(k); };
    const R = 3, X = 60, Y = 40, sdx = 0.4;
    for (let x = R; x <= X - R + 1e-9; x += sdx) for (let y = R; y <= Y - R + 1e-9; y += sdx) {
      if (Math.hypot(x - 42, y - 20) < 4) continue; // hole Ø8
      const e1 = 1.0 * Math.exp(-((x - 20) ** 2 + (y - 20) ** 2) / (2 * 2 * 2)), e2 = 0.6 * Math.exp(-((x - 42) ** 2 + (y - 25.5) ** 2) / (2 * 0.5 * 0.5)), e = e1 + e2;
      const gx = (-e1 * (x - 20)) / 4 + (-e2 * (x - 42)) / 0.25, gy = (-e1 * (y - 20)) / 4 + (-e2 * (y - 25.5)) / 0.25, l = Math.hypot(gx, gy, 1);
      add([x, y, e], [-gx / l, -gy / l, 1 / l], e > 0.02 ? 'bump' : 'face');
    }
    // fillets: quarter circles along the 4 edges, then walls
    for (let t = 0; t <= 90; t += 6) { const a = (t * Math.PI) / 180, off = R * Math.sin(a), dz = -R * (1 - Math.cos(a)), nn = [Math.sin(a), Math.cos(a)];
      for (let y = R; y <= Y - R; y += sdx) { add([X - R + off, y, dz], [nn[0], 0, nn[1]], 'fillet'); add([R - off, y, dz], [-nn[0], 0, nn[1]], 'fillet'); }
      for (let x = R; x <= X - R; x += sdx) { add([x, Y - R + off, dz], [0, nn[0], nn[1]], 'fillet'); add([x, R - off, dz], [0, -nn[0], nn[1]], 'fillet'); } }
    for (let z = -R - 0.4; z >= -10; z -= 0.4) { for (let y = 0; y <= Y; y += sdx) { add([X, y, z], [1, 0, 0], 'wall'); add([0, y, z], [-1, 0, 0], 'wall'); } for (let x = 0; x <= X; x += sdx) { add([x, Y, z], [0, 1, 0], 'wall'); add([x, 0, z], [0, -1, 0], 'wall'); } }
    for (let a = 0; a < 360; a += 5) for (let z = -0.2; z >= -10; z -= 0.4) { const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180); add([42 + 4 * c, 20 + 4 * s, z], [-c, -s, 0], 'hole'); }
    // region growing result: flat top without bumps and without the fillet start
    const seed = K.map((k, i) => (k === 'face' && Math.abs(Nn[3 * i + 2]) > 0.999 ? i : -1)).filter((i) => i >= 0);
    const fit = { type: 'Ebene', center: [30, 20, 0], normal: [0, 0, 1], rms: 0.01, form: 0.02 } as unknown as FitResult;
    for (const band of [0.1, 2]) {
      const r = fillOuterBoundary(Float64Array.from(P), Float64Array.from(Nn), Uint32Array.from(seed), fit, { band });
      const g = new Set(r.indices), cnt = (k: string) => K.filter((x, i) => x === k && g.has(i)).length, tot = (k: string) => K.filter((x) => x === k).length;
      expect(cnt('wall')).toBe(0); expect(cnt('hole')).toBe(0);
      const zs = Array.from(r.indices, (i) => P[3 * i + 2]); expect(Math.min(...zs)).toBeGreaterThan(-0.15); // no fillet points
      expect(cnt('bump')).toBe(tot('bump'));
      expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(1.15);           // flatness ≈ grown + bump (1.0)
      const outer = r.contour.reduce((a, b) => (b.length > a.length ? b : a)); const xs = outer.map((q) => q[0]), ys = outer.map((q) => q[1]);
      expect(Math.min(...xs)).toBeGreaterThan(R - 1.2); expect(Math.max(...xs)).toBeLessThan(X - R + 1.2); expect(Math.min(...ys)).toBeGreaterThan(R - 1.2); expect(Math.max(...ys)).toBeLessThan(Y - R + 1.2);
    }
  });
});
