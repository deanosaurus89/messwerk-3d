// Join coplanar / coaxial CAD regions into one analytic feature (2026.0.54).
// A half-shell cylinder, cone or sphere stays a half until Add region brings the
// other half. Two coplanar faces, or one plane with several islands, stay one plane.
import type { CadAnalytic } from '../cad/analytic';
import type { FitResult } from './fit';
import { facePatch, interiorIslands } from './facetrim';
import { add, basis, dot, norm, scale, sub, unit, type Vec3 } from './linalg';
import { analyticShell, analyticSphere } from './trim';

/** A fitted solid as the analytic record Add region compares. NURBS faces have no native cylinder/plane. */
export function fitAsAnalytic(fit: FitResult): CadAnalytic | null {
  if (fit.type === 'Ebene') return { type: 'Ebene', origin: fit.center, normal: fit.normal, edges: [] };
  if (fit.type === 'Zylinder' && fit.radius) {
    const L = (fit.length ?? fit.radius) / 2;
    return { type: 'Zylinder', origin: fit.center, normal: fit.normal, radius: fit.radius, t0: -L, t1: L, edges: [] };
  }
  if (fit.type === 'Kegel' && fit.apex && fit.halfAngle != null) {
    return { type: 'Kegel', origin: fit.apex, apex: fit.apex, normal: fit.normal, halfAngle: fit.halfAngle, radius: fit.radius, edges: [] };
  }
  if (fit.type === 'Kugel' && fit.radius) return { type: 'Kugel', origin: fit.center, normal: fit.normal, radius: fit.radius, edges: [] };
  if (fit.type === 'Torus' && fit.radius && fit.minorRadius != null) {
    return { type: 'Torus', origin: fit.center, normal: fit.normal, radius: fit.radius, minor: fit.minorRadius, edges: [] };
  }
  return null;
}

export function canJoin(fit: FitResult, face: CadAnalytic, tol = 0.6): boolean {
  if (fit.type === 'Ebene' && face.type === 'Ebene') {
    const n = unit(fit.normal), m = unit(face.normal);
    if (Math.abs(Math.abs(dot(n, m)) - 1) > 0.02) return false;
    return Math.abs(dot(sub(face.origin, fit.center), n)) <= Math.max(tol, 0.5);
  }
  if (fit.type === 'Zylinder' && face.type === 'Zylinder' && fit.radius && face.radius) {
    if (Math.abs(fit.radius - face.radius) > Math.max(1, 0.03 * fit.radius, tol)) return false;
    const n = unit(fit.normal), m = unit(face.normal);
    if (Math.abs(Math.abs(dot(n, m)) - 1) > 0.04) return false;
    const w = sub(face.origin, fit.center), ax = dot(w, n);
    return norm(sub(w, scale(n, ax))) <= Math.max(1.5, 0.04 * fit.radius, tol);
  }
  if (fit.type === 'Kegel' && face.type === 'Kegel' && fit.apex && face.apex && fit.halfAngle != null && face.halfAngle != null) {
    if (Math.abs(fit.halfAngle - face.halfAngle) > 0.04) return false;
    if (norm(sub(fit.apex, face.apex)) > Math.max(1.2, tol)) return false;
    return Math.abs(Math.abs(dot(unit(fit.normal), unit(face.normal))) - 1) < 0.04;
  }
  if (fit.type === 'Kugel' && face.type === 'Kugel' && fit.radius && face.radius) {
    if (Math.abs(fit.radius - face.radius) > Math.max(tol, 0.015 * fit.radius)) return false;
    return norm(sub(fit.center, face.origin)) <= Math.max(tol, 0.02 * fit.radius);
  }
  if (fit.type === 'Torus' && face.type === 'Torus' && fit.radius && face.radius && fit.minorRadius != null && face.minor != null) {
    if (Math.abs(fit.radius - face.radius) > Math.max(tol, 0.02 * fit.radius)) return false;
    if (Math.abs(fit.minorRadius - face.minor) > Math.max(tol, 0.02 * fit.minorRadius)) return false;
    return norm(sub(fit.center, face.origin)) <= Math.max(tol, 0.5);
  }
  return false;
}

export function joinLoops(a: Vec3[][] | undefined, b: Vec3[][] | undefined): Vec3[][] {
  return [...(a ?? []), ...(b ?? [])].filter((L) => L.length >= 3);
}

function rangeAlong(origin: Vec3, axis: Vec3, loops: Vec3[][]): [number, number] | null {
  const n = unit(axis);
  let t0 = Infinity, t1 = -Infinity, k = 0;
  for (const L of loops) for (const p of L) {
    const t = dot(sub(p, origin), n);
    if (t < t0) t0 = t;
    if (t > t1) t1 = t;
    k++;
  }
  return k >= 2 && t1 > t0 ? [t0, t1] : null;
}

/** Fit after another face of the same surface is added. Length and centre follow the union of the wires. */
export function joinedFit(base: FitResult, face: CadAnalytic, loops: Vec3[][]): FitResult {
  const fit: FitResult = { ...base };
  if (fit.type === 'Ebene') {
    const n = unit(fit.normal);
    let c: Vec3 = [0, 0, 0]; let k = 0;
    const src = loops[0] ?? [];
    for (const p of src) { c = add(c, p); k++; }
    if (k) {
      c = scale(c, 1 / k);
      fit.center = sub(c, scale(n, dot(sub(c, base.center), n)));
    }
    return fit;
  }
  if (fit.type === 'Zylinder') {
    const n = unit(fit.normal);
    const span = rangeAlong(base.center, n, loops);
    if (!span) return fit;
    const mid = (span[0] + span[1]) / 2;
    fit.center = add(base.center, scale(n, mid));
    fit.length = Math.max(span[1] - span[0], 1e-3);
    if (interiorIslands(fit, loops) === 0 && wallClosed(fit, loops)) fit.closedSolid = true;
    return fit;
  }
  if (fit.type === 'Kegel' && fit.apex && fit.halfAngle != null) {
    const n = unit(fit.normal);
    const span = rangeAlong(fit.apex, n, loops);
    if (!span) return fit;
    const mid = (span[0] + span[1]) / 2;
    fit.center = add(fit.apex, scale(n, mid));
    fit.length = Math.max(Math.abs(span[1] - span[0]), 1e-3);
    fit.radius = Math.abs(mid * Math.tan(fit.halfAngle));
    fit.diameter = 2 * (fit.radius ?? 0);
    if (interiorIslands(fit, loops) === 0 && wallClosed(fit, loops)) fit.closedSolid = true;
    return fit;
  }
  if (face.type === 'Kugel' && face.radius) {
    fit.radius = face.radius; fit.diameter = 2 * face.radius; fit.center = face.origin;
    if (dot(unit(base.normal), unit(face.normal)) < 0.35) fit.closedSolid = true;
  }
  return fit;
}

/** Largest empty angle around the axis, in degrees. */
export function angularGapDeg(fit: FitResult, loops: Vec3[][], bins = 72): number {
  const n = unit(fit.normal), c = fit.center, [u, v] = basis(n);
  const occ = new Uint8Array(bins);
  let hit = 0;
  for (const L of loops) for (const p of L) {
    const radial = sub(sub(p, c), scale(n, dot(sub(p, c), n)));
    if (norm(radial) < 1e-4) continue;
    const a = Math.atan2(dot(radial, v), dot(radial, u));
    occ[Math.min(bins - 1, Math.floor(((a + Math.PI) / (2 * Math.PI)) * bins))] = 1;
    hit++;
  }
  if (hit < 4) return 360;
  let best = 0, run = 0;
  for (let i = 0; i < bins * 2; i++) {
    if (!occ[i % bins]) { run++; if (run > best && run <= bins) best = run; }
    else run = 0;
  }
  return (best / bins) * 360;
}

/** The wires together go around the axis (a second half closed the shell). */
export function wallClosed(fit: FitResult, loops: Vec3[][], gapDeg = 25): boolean {
  if (fit.type !== 'Zylinder' && fit.type !== 'Kegel') return false;
  return angularGapDeg(fit, loops) <= gapDeg;
}

/** Loop samples sit in every octant around the centre — both hemispheres are present. */
export function sphereCovered(fit: FitResult, loops: Vec3[][]): boolean {
  if (fit.type !== 'Kugel') return false;
  const oct = new Set<number>();
  for (const L of loops) for (const p of L) {
    const d = sub(p, fit.center);
    if (norm(d) < 1e-6) continue;
    oct.add((d[0] >= 0 ? 1 : 0) | (d[1] >= 0 ? 2 : 0) | (d[2] >= 0 ? 4 : 0));
  }
  return oct.size >= 7;
}

function fullTurn(fit: FitResult) {
  const nBin = 48;
  const pos: number[] = [], idx: number[] = [];
  const axis = unit(fit.normal), [u, v] = basis(axis);
  const L = Math.max(fit.length ?? fit.radius ?? 1, 1e-3) / 2;
  for (const t of [-L, 0, L]) for (let i = 0; i < nBin; i++) {
    const a = (i / nBin) * Math.PI * 2;
    const R = fit.type === 'Kegel' ? Math.max(0, (fit.radius ?? 0) + t * Math.tan(fit.halfAngle ?? 0)) : (fit.radius ?? 1);
    const p = add(fit.center, add(scale(axis, t), add(scale(u, R * Math.cos(a)), scale(v, R * Math.sin(a)))));
    idx.push(pos.length / 3);
    pos.push(...p);
  }
  return analyticShell(fit, new Float32Array(pos), Uint32Array.from(idx));
}

/**
 * What a nominal surface draws. A closed cylinder or cone (the second half was added,
 * and there is no island) is the full analytic wall. A half stays the wire trim.
 * A sphere that the wires surround is the whole sphere. Everything else is the wire patch,
 * including a plane that spans several regions and keeps its islands.
 */
export function nominalSurface(fit: FitResult, loops: Vec3[][]): { tri: Float32Array; edges: Float32Array } | null {
  if (!loops.length) return null;
  const holes = interiorIslands(fit, loops);
  if ((fit.closedSolid || wallClosed(fit, loops)) && holes === 0 && (fit.type === 'Zylinder' || fit.type === 'Kegel')) {
    const s = fullTurn(fit);
    return { tri: s.tri, edges: s.edges };
  }
  if ((fit.closedSolid || sphereCovered(fit, loops)) && holes === 0 && fit.type === 'Kugel' && fit.radius) return analyticSphere(fit);
  return facePatch(fit, loops);
}
