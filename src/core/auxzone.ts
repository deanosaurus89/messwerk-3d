// Aux-plane zone for circles / slots (Phase 1 step 6): after the first detection, only the plane points in an annulus
// (circle) or stadium band (slot) around the detected contour are used – offset (gap) from the contour + width.
// One distance function for the selection (aux.ts) and the live visualisation (main.ts), so both always agree.
import type { FitResult } from './fit';
import { Vec3, add, basis, cross, dot, scale, sub, unit } from './linalg';

const projOnPlane = (pl: FitResult, q: Vec3): Vec3 => sub(q, scale(pl.normal, dot(sub(q, pl.center), pl.normal)));
/** half straight length of a slot (0 for a circle) */
const halfStraight = (fit: FitResult) => (fit.type === 'Langloch' && fit.direction ? Math.max(0, (fit.length! - fit.width!) / 2) : 0);
/** signed in-plane distance of q from the detected contour (circle / stadium), measured outward (> 0 = outside) */
export function contourOffset(fit: FitResult, plane: FitResult, q: Vec3): number {
  const w = sub(projOnPlane(plane, q), projOnPlane(plane, fit.center)), half = halfStraight(fit);
  let e = w; if (half > 0) { const d = unit(fit.direction!), t = Math.max(-half, Math.min(half, dot(w, d))); e = sub(w, scale(d, t)); }
  const r0 = fit.type === 'Langloch' ? fit.width! / 2 : fit.radius!;
  return Math.hypot(e[0], e[1], e[2]) - r0;
}
/** is q inside the zone [gap, gap + width] */
export const inZone = (fit: FitResult, plane: FitResult, q: Vec3, gap: number, width: number) => { const x = contourOffset(fit, plane, q); return x >= gap && x <= gap + width; };
/** the zone as two closed loops in the aux plane (inner at gap, outer at gap + width) for display */
export function zoneLoops(fit: FitResult, plane: FitResult, gap: number, width: number, n = 120): Vec3[][] {
  const nrm = unit(plane.normal), c = projOnPlane(plane, fit.center), half = halfStraight(fit);
  let dx: Vec3, dy: Vec3;
  if (half > 0) { dx = unit(sub(fit.direction!, scale(nrm, dot(fit.direction!, nrm)))); dy = unit(cross(nrm, dx)); } else [dx, dy] = basis(nrm);
  const r0 = fit.type === 'Langloch' ? fit.width! / 2 : fit.radius!;
  const loop = (r: number): Vec3[] => {
    const P: Vec3[] = [];
    if (half <= 0) { for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; P.push(add(c, add(scale(dx, r * Math.cos(a)), scale(dy, r * Math.sin(a))))); } return P; }
    const per = Math.max(8, Math.round(n / 4));
    for (const s of [1, -1]) { // right arc (s = +1, around +dx end) then left arc
      const e = add(c, scale(dx, s * half));
      for (let i = 0; i <= per; i++) { const a = -Math.PI / 2 + (Math.PI * i) / per; P.push(add(e, add(scale(dx, s * r * Math.cos(a)), scale(dy, s * r * Math.sin(a))))); }
    }
    return P;
  };
  return [loop(r0 + gap), loop(r0 + gap + width)];
}
