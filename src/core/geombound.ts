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
 * Cone display for Boundary from Geometry: mesh vertices within 0.35 mm of the fit,
 * not the click ring. A looser band is not used — it runs onto blends and neighbouring faces.
 * Open ends stay at the mesh. If that band is shorter than the selection, the selection span is kept.
 */
export function coneDisplayShell(fit: FitResult, pos: ArrayLike<number>, verts: Uint32Array, bins = 72) {
  const pts = analyticShell(fit, pos, verts, bins);
  const band = { span: 'surface' as const, band: SURFACE_SPAN_BAND };
  let surf = analyticShell(fit, pos, verts, bins, band);
  const len = fit.length ?? 0;
  // The 0.35 mm band follows the infinite cone. Clamp to the fitted segment when that
  // band runs far past it (a neighbouring face grazing the same cone).
  if (len > 1 && surf.t1 - surf.t0 > len + 4) {
    const pad = 1.5;
    surf = analyticShell(fit, pos, verts, bins, { ...band, axial0: -len / 2 - pad, axial1: len / 2 + pad });
  }
  return surf.t1 - surf.t0 + 0.25 >= pts.t1 - pts.t0 ? surf : pts;
}

/** Cylinder display for Boundary from Geometry: full turn over the height of the points when the mesh wall is closed. */
export function cylinderDisplayShell(fit: FitResult, pos: ArrayLike<number>, verts: Uint32Array, bins = 72) {
  return analyticShell(fit, pos, verts, bins, { span: 'wall' });
}
