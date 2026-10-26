// 0.41: the auxiliary plane of a circle, slot or line is the face at the wall end nearest the click
// (inner or outer edge). Multi-Feature plate.
import { readFileSync } from 'node:fs'; import { gunzipSync } from 'node:zlib'; import { describe, expect, it } from 'vitest';
import { parseSTL } from '../src/core/io'; import { MeshTopology } from '../src/core/region'; import { extractAtRim, extractLine } from '../src/core/aux';
import type { Vec3 } from '../src/core/linalg';
const b = gunzipSync(readFileSync('public/samples/multifeature.stl.gz'));
const mesh = parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'mf');
const P = mesh.positions, F = mesh.indices, nt = F.length / 3, fn = mesh.faceNormals!; const topo = new MeshTopology(mesh);
const SLOTS: [string, Vec3, Vec3, number, number][] = [
  ['left', [-0.5, 0, 0.866], [-45.4, 50.6, 27.5], 11.5, 57.5],
  ['right', [0.516, -0.018, 0.857], [43, 50.6, 27], 11.5, 57.5],
  ['upper', [0, 0, 1], [-64.5, 167.9, 15], 9.5, 51.4],
];
const frame = (N: Vec3) => { const u = [N[2], 0, -N[0]]; const l = Math.hypot(u[0], u[2]) || 1; return [u[0] / l, 0, u[2] / l] as Vec3; };
const at = (N: Vec3, C: Vec3, uu: number, ww: number) => {
  const u = frame(N); let best = -1, bd = 1e9;
  for (let t = 0; t < nt; t++) {
    if (Math.abs(fn[3 * t] * N[0] + fn[3 * t + 1] * N[1] + fn[3 * t + 2] * N[2]) > 0.05) continue;
    const v = F[3 * t]; const q = [P[3 * v] - C[0], P[3 * v + 1] - C[1], P[3 * v + 2] - C[2]];
    if (Math.abs(q[0] * N[0] + q[1] * N[1] + q[2] * N[2]) > 5) continue;
    const a = q[0] * u[0] + q[2] * u[2], c = q[1]; const d = (a - uu) ** 2 + (c - ww) ** 2; if (d < bd) { bd = d; best = t; }
  }
  return best;
};
const pt = (t: number): Vec3 => { const v = F[3 * t]; return [P[3 * v], P[3 * v + 1], P[3 * v + 2]]; };
/** Axial position of the aux-plane centroid along the slot normal, compared with the click. */
function sideOf(plane: { center: number[]; normal: number[] }, click: Vec3, N: Vec3) {
  const tc = click[0] * N[0] + click[1] * N[1] + click[2] * N[2];
  const tp = plane.center[0] * N[0] + plane.center[1] * N[1] + plane.center[2] * N[2];
  return Math.abs(tp - tc);
}

describe('Multi-Feature plate: aux plane on the clicked side', () => {
  for (const [nm, N, C, hw, L] of SLOTS) {
    it(`${nm} slot: the plane is the wall end nearest the click`, () => {
      const t0 = at(N, C, hw * 0.9, 0); expect(t0).toBeGreaterThanOrEqual(0);
      const base = extractAtRim(mesh, topo, t0, pt(t0), { maxAngleDeg: 20, radius: 0, seedR: 1.5 }, 'Langloch', 340);
      // Thickness follows the face that the centre click found. The nominal slot normal is only a search hint
      // (the upper slot's wall is not perpendicular to the plate).
      const axis: Vec3 = [base.plane.normal[0], base.plane.normal[1], base.plane.normal[2]];
      if (axis[0] * N[0] + axis[1] * N[1] + axis[2] * N[2] < 0) { axis[0] *= -1; axis[1] *= -1; axis[2] *= -1; }
      let hi = { t: -1e9, v: 0 }, lo = { t: 1e9, v: 0 };
      for (const v of base.wallIdx) {
        const t = P[3 * v] * axis[0] + P[3 * v + 1] * axis[1] + P[3 * v + 2] * axis[2];
        if (t > hi.t) hi = { t, v }; if (t < lo.t) lo = { t, v };
      }
      expect(hi.t - lo.t).toBeGreaterThan(3);
      const inW = new Uint8Array(P.length / 3); for (const v of base.wallIdx) inW[v] = 1;
      const ld = base.fit.direction ?? ([0, 1, 0] as Vec3), ln = Math.hypot(ld[0], ld[1], ld[2]) || 1;
      const along: Vec3 = [ld[0] / ln, ld[1] / ln, ld[2] / ln];
      // Side wall, just in from the face. The round-end facets point along the slot and are not the click a user places at the rim.
      const seed = (endT: number) => {
        const mid = (hi.t + lo.t) / 2, target = endT + (endT > mid ? -1.5 : 1.5);
        let tri = -1, bd = 1e9, alongDot = 0; const c: Vec3 = [0, 0, 0];
        for (let t = 0; t < nt; t++) {
          const i0 = F[3 * t], i1 = F[3 * t + 1], i2 = F[3 * t + 2];
          if (!inW[i0] && !inW[i1] && !inW[i2]) continue;
          const n: Vec3 = [fn[3 * t], fn[3 * t + 1], fn[3 * t + 2]];
          if (Math.abs(n[0] * axis[0] + n[1] * axis[1] + n[2] * axis[2]) > 0.35) continue;
          if (Math.abs(n[0] * along[0] + n[1] * along[1] + n[2] * along[2]) > 0.55) continue;
          const q: Vec3 = [(P[3 * i0] + P[3 * i1] + P[3 * i2]) / 3, (P[3 * i0 + 1] + P[3 * i1 + 1] + P[3 * i2 + 1]) / 3, (P[3 * i0 + 2] + P[3 * i1 + 2] + P[3 * i2 + 2]) / 3];
          const d = Math.abs(q[0] * axis[0] + q[1] * axis[1] + q[2] * axis[2] - target);
          if (d < bd) { bd = d; tri = t; alongDot = Math.abs(n[0] * along[0] + n[1] * along[1] + n[2] * along[2]); c[0] = q[0]; c[1] = q[1]; c[2] = q[2]; }
        }
        return { tri, p: c, bd, alongDot };
      };
      const a = seed(hi.t), b = seed(lo.t);
      expect(a.tri, 'high-end wall triangle').toBeGreaterThanOrEqual(0);
      expect(b.tri, 'low-end wall triangle').toBeGreaterThanOrEqual(0);
      const ra = extractAtRim(mesh, topo, a.tri, a.p, { maxAngleDeg: 20, radius: 0, seedR: 2.5 }, 'Langloch', 340);
      const rb = extractAtRim(mesh, topo, b.tri, b.p, { maxAngleDeg: 20, radius: 0, seedR: 2.5 }, 'Langloch', 340);
      expect(ra.fit.type).toBe('Langloch'); expect(rb.fit.type).toBe('Langloch');
      expect(Math.abs(ra.fit.length! - L)).toBeLessThan(0.25 * L);
      expect(Math.abs(rb.fit.length! - L)).toBeLessThan(0.25 * L);
      // Distance to the plane, not the plane centroid: a tilted face (upper slot) has a centroid far from the wall.
      const gap = (pl: { center: number[]; normal: number[] }, q: Vec3) => Math.abs(q[0] * pl.normal[0] + q[1] * pl.normal[1] + q[2] * pl.normal[2] - (pl.center[0] * pl.normal[0] + pl.center[1] * pl.normal[1] + pl.center[2] * pl.normal[2]));
      const span = hi.t - lo.t;
      const info = { span: +span.toFixed(2), ga: +gap(ra.plane, a.p).toFixed(2), gb: +gap(rb.plane, b.p).toFixed(2), gab: +gap(ra.plane, b.p).toFixed(2), gba: +gap(rb.plane, a.p).toFixed(2) };
      // The click sits on the wall, a fillet below the face, so the plane is a few millimetres away.
      // It must still be the end next to that click, clearly nearer than the opposite end.
      expect(info.ga, JSON.stringify(info)).toBeLessThan(info.gab);
      expect(info.gb, JSON.stringify(info)).toBeLessThan(info.gba);
      expect(info.gab - info.ga, JSON.stringify(info)).toBeGreaterThan(0.4);
      expect(info.gba - info.gb, JSON.stringify(info)).toBeGreaterThan(0.4);
    }, 120000);
  }
  it('right slot: outer straight wall stays the slot, not a larger inner contour', () => {
    const [, N, C, hw, L] = SLOTS[1];
    const t = at(N, C, hw, 0); const r = extractAtRim(mesh, topo, t, pt(t), { maxAngleDeg: 20, radius: 0, seedR: 1.5 }, 'Langloch', 340);
    expect(r.fit.type).toBe('Langloch');
    expect(r.fit.length!).toBeGreaterThan(0.9 * L); expect(r.fit.length!).toBeLessThan(1.15 * L);
    expect(r.fit.width!).toBeGreaterThan(20); expect(r.fit.width!).toBeLessThan(28);
  }, 120000);
  it('line: adjacent face is the one at the clicked end', () => {
    const [, N, C, hw] = SLOTS[0];
    const t = at(N, C, hw, 0); const click = pt(t);
    const r = extractLine(mesh, topo, t, click, { maxAngleDeg: 20, radius: 0 }, 1);
    expect(r.fit.type).toBe('Linie');
    expect(sideOf(r.plane, click, N)).toBeLessThan(8);
  }, 120000);
});
