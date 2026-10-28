// Boundary from Geometry vs Points (2026.0.46).
// Geometry draws the fitted analytic surface. Points draws the clicked triangles.
// A Geometry boundary that falls back to the point highlight is a regression.
import type { FitResult } from './fit';
import { analyticShell, SURFACE_SPAN_BAND } from './trim';

export const SURFACE_ZONE = ['Zylinder', 'Kegel', 'Kugel', 'Torus'] as const;

export function isSurfaceZone(type: string): boolean {
  return (SURFACE_ZONE as readonly string[]).includes(type);
}

/**
 * What the 3D view draws for a surface feature.
 * 'analytic' = fitted surface (cone frustum, cylinder wall, full sphere, full torus).
 * 'selection' = the clicked triangles and their edges (Points mode).
 * Undefined zoneSrc keeps the 0.45 legacy: cone and sphere were already analytic unless Points was explicit.
 */
export function boundaryKind(type: string, zoneSrc: 'points' | 'geom' | undefined): 'analytic' | 'selection' {
  if (!isSurfaceZone(type)) return 'selection';
  if (zoneSrc === 'points') return 'selection';
  if (zoneSrc === 'geom') return 'analytic';
  if (type === 'Kegel' || type === 'Kugel') return 'analytic';
  return 'selection';
}

/** Geometry mode must not paint the selection point highlight. */
export function drawsPointHighlight(type: string, zoneSrc: 'points' | 'geom' | undefined): boolean {
  return boundaryKind(type, zoneSrc) === 'selection';
}

/** The user's Boundary-from choice is stored even when the zone refit is rejected (blend guard). */
export function zoneSrcFor(type: string, choice: 'points' | 'geom', aux: boolean): 'points' | 'geom' | undefined {
  if (aux || !isSurfaceZone(type)) return undefined;
  return choice === 'points' ? 'points' : 'geom';
}

/**
 * Cone display for Boundary from Geometry: the mesh frustum, not the click ring.
 * A tight band that only sees the selected ring is widened once (1 mm, same as the extract search)
 * so a slightly off fit still draws the full surface. Open ends stay at the mesh limit.
 */
export function coneDisplayShell(fit: FitResult, pos: ArrayLike<number>, verts: Uint32Array, bins = 72) {
  const pts = analyticShell(fit, pos, verts, bins);
  const tight = analyticShell(fit, pos, verts, bins, { span: 'surface', band: SURFACE_SPAN_BAND });
  if (tight.t1 - tight.t0 > pts.t1 - pts.t0 + 1) return tight;
  const wide = analyticShell(fit, pos, verts, bins, { span: 'surface', band: 1 });
  return wide.t1 - wide.t0 > tight.t1 - tight.t0 + 1 ? wide : tight;
}

/** Cylinder display for Boundary from Geometry: full turn over the height of the points when the mesh wall is closed. */
export function cylinderDisplayShell(fit: FitResult, pos: ArrayLike<number>, verts: Uint32Array, bins = 72) {
  return analyticShell(fit, pos, verts, bins, { span: 'wall' });
}
