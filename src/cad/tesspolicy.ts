// Display mesh versus analytic create.
// The mesher builds a triangle mesh for the 3D view, ray picking and a future
// scan-to-CAD colour map. Nominal create and fits use the OpenCascade analytic
// face (plane, cylinder, cone, sphere, torus) or, for a NURBS face, a sample
// cloud taken from the surface — not the coarse display triangles.
// Orbit and zoom reuse the mesh already on the GPU; only a tolerance change
// asks the worker to remesh the shape it still holds (no second IGES/STEP read).

export interface TessTol { linear: number; angular: number; relative: boolean }

/** Coarser than the 0.47 cap (0.75 mm) so import spends less time in the mesher.
 *  Chordal error stays bounded; recognition of analytic faces does not use this mesh. */
export function defaultDisplayDeflection(diag: number): { linear: number; angular: number } {
  const d = Number.isFinite(diag) && diag > 0 ? diag : 1;
  const linear = Math.min(1.25, Math.max(0.35, d / 160));
  return { linear, angular: 0.9 };
}

export function resolveTess(diag: number, stored: Partial<TessTol> | null | undefined): TessTol {
  const d = defaultDisplayDeflection(diag);
  const linear = Math.min(2.5, Math.max(0.15, stored?.linear ?? d.linear));
  const angular = Math.min(1.2, Math.max(0.4, stored?.angular ?? d.angular));
  return { linear, angular, relative: !!stored?.relative };
}

/** True when create can ignore the display mesh and use the stored analytic face. */
export function createFromAnalytic(geomType: string | null | undefined): boolean {
  return !!geomType && geomType !== 'NURBS';
}
