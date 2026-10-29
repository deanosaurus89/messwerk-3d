// Serializable analytic geometry of a CAD face (no OpenCascade objects). Filled when a STEP/IGES model is read.
export type V3 = [number, number, number];
export interface CadCurve {
  kind: 'line' | 'circle' | 'other';
  mid: V3;
  length: number;
  /** line segment */
  a?: V3; b?: V3;
  /** circle */
  center?: V3; normal?: V3; radius?: number;
  /** Circle edge, angle of the start about `normal` (basis) and sweep in (0, 2π]. Omitted on a full turn. */
  ang0?: number;
  sweep?: number;
}
export interface CadAnalytic {
  type: 'Ebene' | 'Zylinder' | 'Kegel' | 'Kugel' | 'Torus' | 'NURBS';
  /** point on the surface: plane origin, a point on the axis, sphere/torus centre, or a NURBS sample */
  origin: V3;
  /** plane normal or axis direction */
  normal: V3;
  radius?: number;
  /** cone half-angle, radians */
  halfAngle?: number;
  apex?: V3;
  /** torus tube radius */
  minor?: number;
  /** extent along the axis, measured from `origin` (cylinder) or from the apex (cone) */
  t0?: number; t1?: number;
  edges: CadCurve[];
  /** Outer loop first, then islands. Polylines on the face, used to trim the analytic patch. */
  loops?: V3[][];
}
