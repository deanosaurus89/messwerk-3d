// Recognise a sampled CAD edge as a line or a circle.
// IGES trimmed NURBS often store a straight edge or a circular arc as a B-spline.
// Those arrived as kind 'other' and could not become a nominal curve.
import type { CadCurve, V3 } from './analytic';
import { add, basis, dot, norm, scale, sub, unit, type Vec3 } from '../core/linalg';

function distSeg(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a), ap = sub(p, a), L2 = dot(ab, ab) || 1;
  const t = Math.max(0, Math.min(1, dot(ap, ab) / L2));
  return norm(sub(ap, scale(ab, t)));
}
function polylineLength(pts: Vec3[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += norm(sub(pts[i], pts[i - 1]));
  return s;
}
function solve3(A: number[][], b: number[]): number[] | null {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    if (Math.abs(M[p][i]) < 1e-12) return null;
    const hold = M[i]; M[i] = M[p]; M[p] = hold;
    const div = M[i][i];
    for (let c = i; c < 4; c++) M[i][c] /= div;
    for (let r = 0; r < 3; r++) if (r !== i) {
      const f = M[r][i];
      for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c];
    }
  }
  return [M[0][3], M[1][3], M[2][3]];
}
/** Algebraic circle in the plane of `normal`, plus the RMS distance of the samples. */
function fitCircle(pts: Vec3[]): { center: Vec3; normal: Vec3; radius: number; rms: number } | null {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    nx += (p[1] - q[1]) * (p[2] + q[2]);
    ny += (p[2] - q[2]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  const nl = Math.hypot(nx, ny, nz);
  if (nl < 1e-9) return null;
  const normal = unit([nx / nl, ny / nl, nz / nl]);
  const c0 = pts.reduce((s, p) => add(s, p), [0, 0, 0] as Vec3).map((v) => v / pts.length) as Vec3;
  const [u, v] = basis(normal);
  const xy = pts.map((p) => { const d = sub(p, c0); return [dot(d, u), dot(d, v)] as [number, number]; });
  let suu = 0, svv = 0, suv = 0, su = 0, sv = 0, suuu = 0, svvv = 0, suvv = 0, suuv = 0;
  for (const [x, y] of xy) {
    const xx = x * x, yy = y * y;
    suu += xx; svv += yy; suv += x * y; su += x; sv += y;
    suuu += xx * x; svvv += yy * y; suvv += x * yy; suuv += xx * y;
  }
  const sol = solve3(
    [[suu, suv, su], [suv, svv, sv], [su, sv, xy.length]],
    [-(suuu + suvv), -(svvv + suuv), -(suu + svv)],
  );
  if (!sol) return null;
  const [D, E, F] = sol;
  const cx = -D / 2, cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  if (!(r2 > 0)) return null;
  const radius = Math.sqrt(r2);
  const center = add(c0, add(scale(u, cx), scale(v, cy)));
  let acc = 0;
  for (const p of pts) {
    const w = sub(p, center), ax = dot(w, normal), rad = sub(w, scale(normal, ax));
    const e = Math.hypot(ax, norm(rad) - radius);
    acc += e * e;
  }
  return { center, normal, radius, rms: Math.sqrt(acc / pts.length) };
}

/**
 * Line if the samples stay on the chord. Circle if they lie on one radius.
 * A straight spline becomes a line; a circular spline becomes a circle. Anything else is null.
 */
export function classifyCurvePoints(pts: V3[]): CadCurve | null {
  const P = pts.filter((p) => p.every((v) => Number.isFinite(v)));
  if (P.length < 2) return null;
  const a = P[0], b = P[P.length - 1];
  const length = polylineLength(P);
  if (length < 1e-4) return null;
  const mid = P[P.length >> 1];
  const chord = norm(sub(b, a));
  if (chord > 1e-6) {
    let maxDev = 0;
    for (const p of P) maxDev = Math.max(maxDev, distSeg(p, a, b));
    const tol = Math.max(0.08, 0.003 * length);
    if (chord >= length * 0.985 && maxDev <= tol)
      return { kind: 'line', mid, length, a: [...a] as V3, b: [...b] as V3 };
  }
  if (P.length < 3) return null;
  const circ = fitCircle(P);
  if (!circ) return null;
  if (circ.radius < 0.2 || circ.radius > 1e5 || circ.radius > length * 80) return null;
  if (circ.rms > Math.max(0.15, 0.02 * circ.radius)) return null;
  return { kind: 'circle', mid, length, center: circ.center, normal: circ.normal, radius: circ.radius };
}
