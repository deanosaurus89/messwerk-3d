// CAD-Flächen beschneiden (OpenCascade/WASM): STEP/IGES lesen, Flächen tessellieren, nicht-destruktive Beschnitte
// (Rand-Offset, Schnittlinie, Inseln) auf die Originalflächen anwenden, Ergebnis als STEP AP214 / IGES (144) schreiben.
// Reine Funktionen auf dem OC-Modul `oc` – laufen im Worker (Browser) und in vitest (Node).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CadAnalytic, CadCurve } from './analytic';
import { classifyCurvePoints } from './curvetype';
type OC = any;
export type V3 = [number, number, number];
export type FaceType = 'Ebene' | 'Zylinder' | 'Kegel' | 'Kugel' | 'Torus' | 'NURBS';
export interface FaceInfo { id: number; type: FaceType; detail: string; area: number; center: V3; }
export interface Tess { positions: Float32Array; indices: Uint32Array; normals: Float32Array; }
export type TrimOp =
  | { kind: 'offset'; faces: number[]; d: number }
  | { kind: 'cut'; faces: number[]; pts: V3[]; dir: V3; remove: V3 }
  | { kind: 'island'; faces: number[]; shape: 'circle' | 'rect'; pts: V3[]; dir: V3; up?: V3 };

const pr = (oc: OC) => new oc.Message_ProgressRange_1();
const P = (oc: OC, p: number[]) => new oc.gp_Pnt_3(p[0], p[1], p[2]);
const Dir = (oc: OC, p: number[]) => new oc.gp_Dir_4(p[0], p[1], p[2]);
const sub = (a: number[], b: number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: number[], b: number[], s = 1): V3 => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function readCAD(oc: OC, bytes: Uint8Array, name: string): any {
  const ext = name.toLowerCase().split('.').pop()!;
  const path = '/in.' + ext; oc.FS.writeFile(path, bytes);
  const isStep = ext === 'stp' || ext === 'step';
  if (!isStep && ext !== 'igs' && ext !== 'iges') throw new Error('Nur STEP (.stp/.step) oder IGES (.igs/.iges)');
  const r = isStep ? new oc.STEPControl_Reader_1() : new oc.IGESControl_Reader_1();
  const st = r.ReadFile(path); oc.FS.unlink(path);
  if (st !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error('File could not be read');
  r.TransferRoots(pr(oc)); const sh = r.OneShape(); r.delete?.();
  return sh;
}
export function faces(oc: OC, sh: any): any[] {
  const out: any[] = []; const ex = new oc.TopExp_Explorer_2(sh, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; ex.More(); ex.Next()) out.push(oc.TopoDS.Face_1(ex.Current())); ex.delete(); return out;
}
function edgesOf(oc: OC, sh: any): any[] {
  const out: any[] = []; const ex = new oc.TopExp_Explorer_2(sh, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; ex.More(); ex.Next()) out.push(oc.TopoDS.Edge_1(ex.Current())); ex.delete(); return out;
}
/** Randlänge (ohne Naht- und entartete Kanten). */
export function perimeter(oc: OC, f: any): number { let s = 0; for (const e of edgesOf(oc, f)) { if (oc.BRep_Tool.Degenerated(e) || oc.BRep_Tool.IsClosed_2(e, f)) continue; const g = new oc.GProp_GProps_1(); oc.BRepGProp.LinearProperties(e, g, false, false); s += g.Mass(); g.delete(); } return s; }
export function area(oc: OC, sh: any): number { const g = new oc.GProp_GProps_1(); oc.BRepGProp.SurfaceProperties_1(sh, g, false, false); const a = g.Mass(); g.delete(); return a; }
export function isValid(oc: OC, sh: any): boolean { const a = new oc.BRepCheck_Analyzer(sh, true, false); const v = a.IsValid_2(); a.delete(); return v; }
const p3 = (p: any): V3 => [p.X(), p.Y(), p.Z()];
const d3 = (p: any): V3 => { const n = norm([p.X(), p.Y(), p.Z()]); return n; };
function curvePoint(c: any, oc: OC, u: number): any {
  if (typeof c.Value === 'function') { try { const q = c.Value(u); if (q && typeof q.X === 'function') return q; } catch { /* overload */ } }
  const p = new oc.gp_Pnt_1();
  if (typeof c.D0 === 'function') c.D0(u, p); else c.D0_1?.(u, p);
  return p;
}
function edgeLen(oc: OC, e: any): number {
  try { const g = new oc.GProp_GProps_1(); oc.BRepGProp.LinearProperties(e, g, false, false); const m = g.Mass(); g.delete(); return m; } catch { return 0; }
}
function faceCurves(oc: OC, f: any): CadCurve[] {
  const out: CadCurve[] = [];
  const CT = oc.GeomAbs_CurveType;
  for (const e of edgesOf(oc, f)) {
    if (oc.BRep_Tool.Degenerated(e) || oc.BRep_Tool.IsClosed_2(e, f)) continue;
    const c = new oc.BRepAdaptor_Curve_2(e);
    try {
      const u0 = c.FirstParameter(), u1 = c.LastParameter(), mid = p3(curvePoint(c, oc, (u0 + u1) / 2));
      const ty = c.GetType(); const length = edgeLen(oc, e);
      if (ty === CT.GeomAbs_Circle) {
        const circ = c.Circle(); const ax = circ.Axis();
        out.push({ kind: 'circle', mid, length, center: p3(circ.Location()), normal: d3(ax.Direction()), radius: circ.Radius() });
      } else if (ty === CT.GeomAbs_Line) {
        out.push({ kind: 'line', mid, length, a: p3(curvePoint(c, oc, u0)), b: p3(curvePoint(c, oc, u1)) });
      } else {
        // B-splines and other trimmed curves (typical of IGES) still carry a line or a circle.
        const samples: V3[] = [];
        const n = 16;
        for (let i = 0; i < n; i++) {
          const u = u0 + (u1 - u0) * (i / (n - 1));
          try { samples.push(p3(curvePoint(c, oc, u))); } catch { /* one bad sample is not the edge */ }
        }
        const cls = classifyCurvePoints(samples);
        if (cls?.kind === 'line' && cls.a && cls.b) out.push({ kind: 'line', mid, length: length || cls.length, a: cls.a, b: cls.b });
        else if (cls?.kind === 'circle' && cls.center && cls.normal && cls.radius != null) out.push({ kind: 'circle', mid, length: length || cls.length, center: cls.center, normal: cls.normal, radius: cls.radius });
        else out.push({ kind: 'other', mid, length });
      }
    } finally { c.delete?.(); }
  }
  return out;
}
/** Extent of the face along `axis`, measured from `origin` (samples of the UV corners). */
function axisExtent(a: any, oc: OC, origin: V3, axis: V3, u0: number, u1: number, v0: number, v1: number): [number, number] {
  let t0 = Infinity, t1 = -Infinity;
  for (const u of [u0, (u0 + u1) / 2, u1]) for (const v of [v0, (v0 + v1) / 2, v1]) {
    let q: V3;
    try { q = p3(a.Value(u, v)); } catch { const p = new oc.gp_Pnt_1(); a.D0(u, v, p); q = p3(p); }
    const t = (q[0] - origin[0]) * axis[0] + (q[1] - origin[1]) * axis[1] + (q[2] - origin[2]) * axis[2];
    if (t < t0) t0 = t; if (t > t1) t1 = t;
  }
  return [t0, t1];
}
/** Analytic geometry of one face (plane / cylinder / cone / sphere / torus / freeform) plus its edges. */
export function faceAnalytic(oc: OC, f: any): CadAnalytic {
  const a = new oc.BRepAdaptor_Surface_2(f, true);
  const T = oc.GeomAbs_SurfaceType; const ty = a.GetType();
  const u0 = a.FirstUParameter(), u1 = a.LastUParameter(), v0 = a.FirstVParameter(), v1 = a.LastVParameter();
  const rev = f.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;
  const edges = faceCurves(oc, f);
  const blank = (): CadAnalytic => ({ type: 'NURBS', origin: [0, 0, 0], normal: [0, 0, 1], edges });
  try {
    if (ty === T.GeomAbs_Plane) {
      const pl = a.Plane(); let n = d3(pl.Axis().Direction()); if (rev) n = [-n[0], -n[1], -n[2]];
      return { type: 'Ebene', origin: p3(pl.Location()), normal: n, edges };
    }
    if (ty === T.GeomAbs_Cylinder) {
      const cy = a.Cylinder(); const ax = cy.Axis(); const origin = p3(ax.Location()); const n = d3(ax.Direction());
      const [t0, t1] = axisExtent(a, oc, origin, n, u0, u1, v0, v1);
      return { type: 'Zylinder', origin, normal: n, radius: cy.Radius(), t0, t1, edges };
    }
    if (ty === T.GeomAbs_Cone) {
      const co = a.Cone(); const ax = co.Axis(); const apex = p3(co.Apex()); let n = d3(ax.Direction());
      const ha = Math.abs(co.SemiAngle());
      const [t0, t1] = axisExtent(a, oc, apex, n, u0, u1, v0, v1);
      // axis points away from the apex towards the face
      if (t1 < 0 && t0 < 0) n = [-n[0], -n[1], -n[2]];
      const tt = axisExtent(a, oc, apex, n, u0, u1, v0, v1);
      return { type: 'Kegel', origin: apex, apex, normal: n, halfAngle: ha, t0: tt[0], t1: tt[1], edges };
    }
    if (ty === T.GeomAbs_Sphere) {
      const s = a.Sphere(); const origin = p3(s.Location());
      let q: V3; try { q = p3(a.Value((u0 + u1) / 2, (v0 + v1) / 2)); } catch { q = origin; }
      const w = sub(q, origin); const n = norm(w);
      return { type: 'Kugel', origin, normal: n, radius: s.Radius(), edges };
    }
    if (ty === T.GeomAbs_Torus) {
      const t = a.Torus(); const ax = t.Axis(); let n = d3(ax.Direction()); if (rev) n = [-n[0], -n[1], -n[2]];
      return { type: 'Torus', origin: p3(t.Location()), normal: n, radius: t.MajorRadius(), minor: t.MinorRadius(), edges };
    }
    // freeform: a sample point and the geometric normal there
    let origin: V3 = [0, 0, 0], normal: V3 = [0, 0, 1];
    try {
      const p = new oc.gp_Pnt_1(), du = new oc.gp_Vec_1(), dv = new oc.gp_Vec_1();
      a.D1((u0 + u1) / 2, (v0 + v1) / 2, p, du, dv);
      origin = p3(p); const cr = cross([du.X(), du.Y(), du.Z()], [dv.X(), dv.Y(), dv.Z()]);
      normal = norm(cr); if (rev) normal = [-normal[0], -normal[1], -normal[2]];
    } catch { /* keep the placeholder */ }
    return { type: 'NURBS', origin, normal, edges };
  } catch { return blank(); }
  finally { a.delete?.(); }
}
export function faceClass(oc: OC, f: any): { type: FaceType; detail: string } {
  const a = new oc.BRepAdaptor_Surface_2(f, true); const t = a.GetType(); const T = oc.GeomAbs_SurfaceType; a.delete?.();
  const map: [any, FaceType, string][] = [[T.GeomAbs_Plane, 'Ebene', ''], [T.GeomAbs_Cylinder, 'Zylinder', ''], [T.GeomAbs_Cone, 'Kegel', ''], [T.GeomAbs_Sphere, 'Kugel', ''], [T.GeomAbs_Torus, 'Torus', ''],
    [T.GeomAbs_BSplineSurface, 'NURBS', 'B-Spline'], [T.GeomAbs_BezierSurface, 'NURBS', 'Bézier'], [T.GeomAbs_SurfaceOfRevolution, 'NURBS', 'Rotationsfläche'], [T.GeomAbs_SurfaceOfExtrusion, 'NURBS', 'Extrusionsfläche'], [T.GeomAbs_OffsetSurface, 'NURBS', 'Offsetfläche']];
  const m = map.find((x) => x[0] === t) ?? [t, 'NURBS' as FaceType, 'Freiform'];
  return { type: m[1], detail: m[2] };
}
export function faceInfo(oc: OC, f: any, id: number): FaceInfo {
  const m = faceClass(oc, f);
  const g = new oc.GProp_GProps_1(); oc.BRepGProp.SurfaceProperties_1(f, g, false, false); const c = g.CentreOfMass(); const r: FaceInfo = { id, type: m.type, detail: m.detail, area: g.Mass(), center: [c.X(), c.Y(), c.Z()] }; g.delete();
  return r;
}
/** Area and centroid of a display mesh (no exact surface integration). */
export function meshAreaCenter(t: Tess): { area: number; center: V3 } {
  const p = t.positions, idx = t.indices; let a = 0, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const ia = idx[i] * 3, ib = idx[i + 1] * 3, ic = idx[i + 2] * 3;
    const ux = p[ib] - p[ia], uy = p[ib + 1] - p[ia + 1], uz = p[ib + 2] - p[ia + 2];
    const vx = p[ic] - p[ia], vy = p[ic + 1] - p[ia + 1], vz = p[ic + 2] - p[ia + 2];
    const ar = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    a += ar; cx += ar * (p[ia] + p[ib] + p[ic]) / 3; cy += ar * (p[ia + 1] + p[ib + 1] + p[ic + 1]) / 3; cz += ar * (p[ia + 2] + p[ib + 2] + p[ic + 2]) / 3;
  }
  return a > 1e-12 ? { area: a, center: [cx / a, cy / a, cz / a] } : { area: 0, center: [0, 0, 0] };
}
/**
 * Display mesh for CAD import. The previous load used linear deflection diag/1500
 * (0.24 mm on a 360 mm part) and 0.35 rad, then exact surface properties on every face.
 * Chordal error stays ≤ 0.75 mm so a ray hit remains inside the nominal edge window (≥ 2 mm).
 */
export function displayDeflection(diag: number): { linear: number; angular: number } {
  const linear = Math.min(0.75, Math.max(0.15, (Number.isFinite(diag) ? diag : 1) / 250));
  // 0.8 rad with surface-deflection control: the chord stays within `linear`.
  // Finer angles (the old 0.35) spend most of their time in the mesher setup on trimmed NURBS.
  return { linear, angular: 0.8 };
}
export function bboxDiag(oc: OC, sh: any): number {
  const b = new oc.Bnd_Box_1(); oc.BRepBndLib.Add(sh, b, true); const p = b.CornerMin(), q = b.CornerMax(); const d = p.Distance(q); b.delete(); return d;
}
/** Tessellation einer Fläche bzw. eines Verbunds (Netz wird bei Bedarf erzeugt). `angular` is radians. */
export function tessellate(oc: OC, sh: any, defl: number, natural = false, angular = 0.35): Tess {
  const mesher = new oc.BRepMesh_IncrementalMesh_2(sh, defl, false, angular, false);
  try { return readTess(oc, sh, natural); }
  finally { mesher.delete?.(); }
}
function readTess(oc: OC, sh: any, natural: boolean): Tess {
  const pos: number[] = [], idx: number[] = [], nor: number[] = [];
  for (const f of faces(oc, sh)) {
    const loc = new oc.TopLoc_Location_1(); const h = oc.BRep_Tool.Triangulation(f, loc, 0); if (h.IsNull()) { loc.delete?.(); continue; }
    const T = h.get(); const tr = loc.Transformation(); const base = pos.length / 3; const n = T.NbNodes();
    const rev = !natural && f.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED; // natural: Normale der Fläche ohne Orientierungs-Flag
    for (let i = 1; i <= n; i++) { const p = T.Node(i).Transformed(tr); pos.push(p.X(), p.Y(), p.Z()); nor.push(0, 0, 0); }
    for (let i = 1; i <= T.NbTriangles(); i++) { const t = T.Triangle(i); let a = t.Value(1), b = t.Value(2); const c = t.Value(3); if (rev) [a, b] = [b, a]; idx.push(base + a - 1, base + b - 1, base + c - 1); }
    loc.delete();
  }
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ax = pos[3 * a], ay = pos[3 * a + 1], az = pos[3 * a + 2];
    const ux = pos[3 * b] - ax, uy = pos[3 * b + 1] - ay, uz = pos[3 * b + 2] - az;
    const vx = pos[3 * c] - ax, vy = pos[3 * c + 1] - ay, vz = pos[3 * c + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    nor[3 * a] += nx; nor[3 * a + 1] += ny; nor[3 * a + 2] += nz;
    nor[3 * b] += nx; nor[3 * b + 1] += ny; nor[3 * b + 2] += nz;
    nor[3 * c] += nx; nor[3 * c + 1] += ny; nor[3 * c + 2] += nz;
  }
  for (let v = 0; v < nor.length; v += 3) { const x = nor[v], y = nor[v + 1], z = nor[v + 2]; const l = Math.hypot(x, y, z) || 1; nor[v] = x / l; nor[v + 1] = y / l; nor[v + 2] = z / l; }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), normals: new Float32Array(nor) };
}
export interface LoadedFace { id: number; type: FaceType; detail: string; area: number; center: V3; geom: CadAnalytic | null; tess: Tess; }
/** One display mesh per face. Exact area/centre of mass is not computed here — that dominated import time. */
function meshShape(oc: OC, shape: any, linear: number, angular: number) {
  const p = new oc.IMeshTools_Parameters();
  p.Deflection = linear; p.Angle = angular; p.ControlSurfaceDeflection = true; p.InParallel = false;
  p.Relative = false; p.CleanModel = true; p.AllowQualityDecrease = true;
  const mesher = new oc.BRepMesh_IncrementalMesh_3(shape, p, new oc.Message_ProgressRange_1());
  mesher.delete?.(); p.delete?.();
}
export function loadDisplayFaces(oc: OC, shape: any, onProgress?: (i: number, n: number) => void): { faces: LoadedFace[]; diag: number; defl: { linear: number; angular: number } } {
  const orig = faces(oc, shape); const diag = bboxDiag(oc, shape); const defl = displayDeflection(diag);
  onProgress?.(0, orig.length);
  // One mesher for the whole model. Per-face IncrementalMesh repeated the edge setup on every face.
  meshShape(oc, shape, defl.linear, defl.angular);
  const out: LoadedFace[] = [];
  for (let i = 0; i < orig.length; i++) {
    if (i === 0 || i === orig.length - 1 || i % 25 === 0) onProgress?.(i, orig.length);
    const f = orig[i];
    let tess = readTess(oc, f, false);
    if (!tess.indices.length) tess = tessellate(oc, f, defl.linear, false, defl.angular);
    let geom: CadAnalytic | null = null; try { geom = faceAnalytic(oc, f); } catch { geom = null; }
    const cls = faceClass(oc, f); const ac = meshAreaCenter(tess);
    const center = ac.area > 0 ? ac.center : (geom?.origin ?? [0, 0, 0]);
    out.push({ id: i, type: cls.type, detail: cls.detail, area: ac.area, center, geom, tess });
  }
  return { faces: out, diag, defl };
}
function compound(oc: OC, list: any[]): any { const c = new oc.TopoDS_Compound(); const b = new oc.BRep_Builder(); b.MakeCompound(c); for (const s of list) b.Add(c, s); return c; }
function listOf(oc: OC, list: any[]): any { const l = new oc.TopTools_ListOfShape_1(); for (const s of list) l.Append_1(s); return l; }
export function boolCut(oc: OC, sh: any, tools: any[]): any {
  const op = new oc.BRepAlgoAPI_Cut_1(); op.SetArguments(listOf(oc, [sh])); op.SetTools(listOf(oc, tools)); op.SetRunParallel?.(false); op.SetUseOBB?.(true); op.Build(pr(oc));
  if (!op.IsDone()) throw new Error('Boolesche Operation fehlgeschlagen'); const r = op.Shape(); return r;
}
/** Rohr (Radius d) um eine Kante als Werkzeug-Volumen. */
export function edgeTube(oc: OC, e: any, d: number): any | null {
  const c = new oc.BRepAdaptor_Curve_2(e); const u0 = c.FirstParameter(); const p = new oc.gp_Pnt_1(), v = new oc.gp_Vec_1(); c.D1(u0, p, v); c.delete();
  if (v.Magnitude() < 1e-12) return null;
  const circ = new oc.gp_Circ_2(new oc.gp_Ax2_3(p, new oc.gp_Dir_2(v)), d);
  const prof = new oc.BRepBuilderAPI_MakeFace_15(new oc.BRepBuilderAPI_MakeWire_2(new oc.BRepBuilderAPI_MakeEdge_8(circ).Edge()).Wire(), true).Face();
  const pipe = new oc.BRepOffsetAPI_MakePipe_1(new oc.BRepBuilderAPI_MakeWire_2(e).Wire(), prof); pipe.Build(pr(oc));
  return pipe.IsDone() ? pipe.Shape() : null;
}
/**
 * Rand-Offset: alles näher als d am Rand der Fläche(n) entfernen (Minkowski-Band aus Kantenrohren + Eckkugeln);
 * Kanten, die zwei gewählte Flächen gemeinsam haben, und Nahtkanten (Zylinder) bleiben unberücksichtigt.
 */
export function offsetBoundary(oc: OC, sh: any, d: number, shared: any[] = [], opt: { batch?: number; smoothSkip?: boolean } = {}): any {
  const batch = opt.batch ?? OFFSET_BATCH, smoothSkip = opt.smoothSkip ?? true;
  const tools: any[] = []; const seen: any[] = []; const verts: { p: number[]; t: number[][] }[] = [];
  for (const f of faces(oc, sh)) for (const e of edgesOf(oc, f)) {
    if (oc.BRep_Tool.Degenerated(e) || oc.BRep_Tool.IsClosed_2(e, f)) continue;
    if (seen.some((s) => s.IsSame(e)) || shared.some((s) => s.IsSame(e))) continue; seen.push(e);
    const t = edgeTube(oc, e, d); if (t) tools.push(t);
    // end vertices with the edge tangent there (pointing into the edge) – a corner sphere is only needed where the
    // boundary turns; at tangent (G1) joints the two tubes already cover the vertex neighbourhood
    const ca = new oc.BRepAdaptor_Curve_2(e), u0 = ca.FirstParameter(), u1 = ca.LastParameter();
    for (const [u, sg] of [[u0, 1], [u1, -1]] as const) { const q = new oc.gp_Pnt_1(), v = new oc.gp_Vec_1(); ca.D1(u, q, v); const m = v.Magnitude() || 1; const tg = [sg * v.X() / m, sg * v.Y() / m, sg * v.Z() / m];
      const pt = [q.X(), q.Y(), q.Z()]; const w = verts.find((w) => Math.hypot(w.p[0] - pt[0], w.p[1] - pt[1], w.p[2] - pt[2]) < 1e-6); if (w) w.t.push(tg); else verts.push({ p: pt, t: [tg] }); }
    ca.delete();
  }
  for (const v of verts) {
    // two edges meeting tangentially: directions into the edges are opposite (dot ≈ −1)
    const smooth = smoothSkip && v.t.length === 2 && v.t[0][0] * v.t[1][0] + v.t[0][1] * v.t[1][1] + v.t[0][2] * v.t[1][2] < -0.9998;
    if (!smooth) tools.push(new oc.BRepPrimAPI_MakeSphere_5(P(oc, v.p), d).Shape());
  }
  if (!tools.length) return sh;
  // nacheinander schneiden: viele kleine Boolesche Operationen sind deutlich schneller als eine mit allen Werkzeugen
  let r = sh; for (let i = 0; i < tools.length; i += batch) { if (!faces(oc, r).length) break; r = boolCut(oc, r, tools.slice(i, i + batch)); } return r;
}
/** tools per Boolean cut in the boundary offset (1 = one by one; measured on the CAD sample) */
export let OFFSET_BATCH = 1;
export const setOffsetBatch = (n: number) => { OFFSET_BATCH = Math.max(1, n); };
/** Senkrechte Ausdehnung entlang der Blickrichtung, damit Werkzeuge das Teil sicher durchdringen. */
function sweepRange(oc: OC, sh: any, pts: number[][], dir: number[]) { const L = bboxDiag(oc, sh) * 2 + 10; return { L, base: pts.map((p) => add(p, dir, -L)) }; }
function polyWire(oc: OC, pts: number[][], closed: boolean): any {
  const w = new oc.BRepBuilderAPI_MakeWire_1();
  const n = pts.length; for (let i = 0; i < (closed ? n : n - 1); i++) { const a = pts[i], b = pts[(i + 1) % n]; if (Math.hypot(...sub(a, b)) < 1e-9) continue; w.Add_1(new oc.BRepBuilderAPI_MakeEdge_3(P(oc, a), P(oc, b)).Edge()); }
  return w.Wire();
}
/** Schnittlinie (Polylinie) entlang der Blickrichtung projizieren, Fläche teilen und das Teil am Punkt `remove` entfernen. */
export function cutByLine(oc: OC, sh: any, pts: V3[], dir: V3, remove: V3): any {
  const D = norm(dir); const { L, base } = sweepRange(oc, sh, pts, D);
  // Enden über die Fläche hinaus verlängern (Gerade schneidet ganz durch)
  const closed = pts.length >= 4 && Math.hypot(...sub(pts[0], pts[pts.length - 1])) < 1e-9;
  const b = base.slice(); if (b.length >= 2 && !closed) { const e0 = norm(sub(b[0], b[1])), e1 = norm(sub(b[b.length - 1], b[b.length - 2])); b[0] = add(b[0], e0, L); b[b.length - 1] = add(b[b.length - 1], e1, L); }
  const sheet = new oc.BRepPrimAPI_MakePrism_1(polyWire(oc, b, false), new oc.gp_Vec_4(2 * L * D[0], 2 * L * D[1], 2 * L * D[2]), false, true).Shape();
  const sp = new oc.BRepAlgoAPI_Splitter_1(); sp.SetArguments(listOf(oc, [sh])); sp.SetTools(listOf(oc, [sheet])); sp.SetFuzzyValue?.(1e-5); sp.Build(pr(oc));
  if (!sp.IsDone()) throw new Error('Teilen fehlgeschlagen');
  const parts = faces(oc, sp.Shape()); if (parts.length < 2) return sh;
  // Teile auf der Seite des Klickpunkts (bezogen auf die Schnittfläche) entfernen
  const side = (q: number[]) => closed ? (insidePoly(b, D, q) ? 1 : -1) : sideOfSheet(b, D, q);
  const s0 = side(remove);
  const keep = parts.filter((f) => { const c = innerPoint(oc, f); return side(c) !== s0; });
  return compound(oc, keep);
}
/** Geschlossenes Polygon (Projektion ⟂ D): liegt q innen? (Strahltest in einer Ebene ⟂ D) */
function insidePoly(pts: number[][], D: number[], q: number[]): boolean {
  const u = norm(Math.abs(D[0]) < 0.9 ? cross(D, [1, 0, 0]) : cross(D, [0, 1, 0])), v = cross(D, u);
  const P = pts.map((p) => [dot(p, u), dot(p, v)]), x = dot(q, u), y = dot(q, v); let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; }
  return c;
}
/** Seite eines Punkts bzgl. der extrudierten Polylinie: nächstes Segment (in der Ebene ⟂ Blickrichtung), Vorzeichen des Kreuzprodukts. */
function sideOfSheet(pts: number[][], D: number[], q: number[]): number {
  let bd = Infinity, s = 1;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], e = sub(pts[i + 1], a); const w = sub(q, a); const wp = add(w, D, -dot(w, D)); const ep = add(e, D, -dot(e, D));
    const t = Math.max(0, Math.min(1, dot(wp, ep) / (dot(ep, ep) || 1))); const r = sub(wp, [ep[0] * t, ep[1] * t, ep[2] * t]); const dd = Math.hypot(...r);
    if (dd < bd) { bd = dd; s = Math.sign(dot(cross(ep, wp), D)) || 1; }
  }
  return s;
}
/** Ein Punkt sicher innerhalb einer Fläche (Mitte eines Dreiecks der Tessellation). */
function innerPoint(oc: OC, f: any): number[] {
  const t = tessellate(oc, f, Math.max(0.05, bboxDiag(oc, f) / 200)); if (!t.indices.length) { const g = new oc.GProp_GProps_1(); oc.BRepGProp.SurfaceProperties_1(f, g, false, false); const c = g.CentreOfMass(); return [c.X(), c.Y(), c.Z()]; }
  // größtes Dreieck
  let bi = 0, ba = -1; for (let i = 0; i < t.indices.length; i += 3) { const [a, b, c] = [0, 1, 2].map((k) => Array.from(t.positions.slice(3 * t.indices[i + k], 3 * t.indices[i + k] + 3))); const ar = Math.hypot(...cross(sub(b, a), sub(c, a))); if (ar > ba) { ba = ar; bi = i; } }
  const q = [0, 0, 0]; for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) q[j] += t.positions[3 * t.indices[bi + k] + j] / 3; return q;
}
/** Insel (Kreis: pts=[Mitte, Randpunkt]; Rechteck: pts=[Ecke, Gegenecke, (dritter Punkt für Ausrichtung)] in Blickebene) als Loch ausschneiden. */
export function cutIsland(oc: OC, sh: any, shape: 'circle' | 'rect', pts: V3[], dir: V3, up?: V3): any {
  const D = norm(dir); const { L } = sweepRange(oc, sh, pts, D);
  let profile: any;
  if (shape === 'circle') {
    const c = add(pts[0], D, -L); const r = Math.hypot(...((): V3 => { const w = sub(pts[1], pts[0]); return add(w, D, -dot(w, D)); })());
    profile = new oc.BRepBuilderAPI_MakeFace_15(new oc.BRepBuilderAPI_MakeWire_2(new oc.BRepBuilderAPI_MakeEdge_8(new oc.gp_Circ_2(new oc.gp_Ax2_3(P(oc, c), Dir(oc, D)), r)).Edge()).Wire(), true).Face();
  } else {
    let U = up ? norm(add(up, D, -dot(up, D))) : norm(cross(D, Math.abs(D[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])); const R = norm(cross(U, D));
    const a = add(pts[0], D, -L), w = sub(pts[1], pts[0]); const x = dot(w, R), y = dot(w, U);
    const q = [a, add(a, R, x), add(add(a, R, x), U, y), add(a, U, y)];
    profile = new oc.BRepBuilderAPI_MakeFace_15(polyWire(oc, q, true), true).Face();
  }
  const tool = new oc.BRepPrimAPI_MakePrism_1(profile, new oc.gp_Vec_4(2 * L * D[0], 2 * L * D[1], 2 * L * D[2]), false, true).Shape();
  return boolCut(oc, sh, [tool]);
}
/** Gemeinsame Kanten zwischen den Flächen einer Auswahl (bleiben beim Rand-Offset unberücksichtigt). */
export function sharedEdges(oc: OC, list: any[]): any[] {
  const out: any[] = []; const per = list.map((f) => edgesOf(oc, f));
  for (let i = 0; i < per.length; i++) for (let j = i + 1; j < per.length; j++) for (const e of per[i]) if (per[j].some((x) => x.IsSame(e)) && !out.some((x) => x.IsSame(e))) out.push(e);
  return out;
}
/** Beschnitte nacheinander auf die Originalflächen anwenden. Liefert je Fläche das Ergebnis (Fläche/Verbund) und Fehler je Operation. */
export function applyOps(oc: OC, orig: any[], ops: TrimOp[]): { result: any[]; errors: (string | null)[] } {
  const result = orig.slice(); const errors: (string | null)[] = [];
  for (const op of ops) {
    try {
      if (op.kind === 'offset') {
        const shared = sharedEdges(oc, op.faces.map((i) => orig[i]));
        for (const i of op.faces) result[i] = offsetBoundary(oc, result[i], op.d, shared);
      } else if (op.kind === 'cut') for (const i of op.faces) result[i] = cutByLine(oc, result[i], op.pts, op.dir, op.remove);
      else for (const i of op.faces) result[i] = cutIsland(oc, result[i], op.shape, op.pts, op.dir, op.up);
      errors.push(null);
    } catch (e: any) { errors.push(String(e?.message ?? e)); }
  }
  return { result, errors };
}
/** Eine Operation auf eine Fläche anwenden (für den Worker-Cache je Fläche). */
export function applyOne(oc: OC, sh: any, op: TrimOp, orig: any[]): any {
  if (op.kind === 'offset') return offsetBoundary(oc, sh, op.d, op.faces.length > 1 ? sharedEdges(oc, op.faces.map((i) => orig[i])) : []);
  if (op.kind === 'cut') return cutByLine(oc, sh, op.pts, op.dir, op.remove);
  return cutIsland(oc, sh, op.shape, op.pts, op.dir, op.up);
}
/**
 * Fläche „direkt" machen: bei REVERSED-Orientierung Fläche mit umgekehrter Parametrisierung (u gespiegelt) neu aufbauen,
 * damit die natürliche Flächennormale der Flächennormale (Materialseite) entspricht und die Fläche FORWARD ist.
 * Wichtig für IGES 144 (Orientierung implizit über die Flächennormale) und Systeme, die das STEP-Flag same_sense ignorieren.
 */
export function directFace(oc: OC, f: any): any {
  if (f.Orientation_1() !== oc.TopAbs_Orientation.TopAbs_REVERSED) return f;
  try {
    // in B-Spline umwandeln: dort ist die Parameterumkehr eine echte Orientierungsumkehr (Elementarflächen würden linkshändig)
    const nc = new oc.BRepBuilderAPI_NurbsConvert_2(f, true); const fn = oc.TopoDS.Face_1(nc.Shape());
    f = fn; const S = oc.BRep_Tool.Surface_2(fn); const S2 = S.get().UReversed();
    const nf = new oc.TopoDS_Face(); const B = new oc.BRep_Builder(); B.MakeFace_2(nf, S2, oc.BRep_Tool.Tolerance_1(f));
    const ex = new oc.TopExp_Explorer_2(f, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) B.Add(nf, ex.Current()); ex.delete();
    const fix = new oc.ShapeFix_Face_2(nf); fix.Perform(); let r = oc.TopoDS.Face_1(fix.Face());
    if (r.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED) return f; // Neuaufbau nicht eindeutig: Original (Flag) behalten
    return r;
  } catch { return f; }
}
/** Export: STEP AP214 bzw. IGES (Flächenmodus → getrimmte Flächen, Typ 144). */
export function writeCAD(oc: OC, list: any[], fmt: 'step' | 'iges'): Uint8Array {
  // STEP: Orientierung über ADVANCED_FACE.same_sense (Standard) – Flächen unverändert; IGES 144: Normale implizit -> direkte Flächen
  const sh = compound(oc, list.flatMap((s) => faces(oc, s)).map((f) => (fmt === 'iges' ? directFace(oc, f) : f)));
  if (fmt === 'step') {
    oc.Interface_Static.SetCVal('write.step.schema', 'AP214IS'); oc.Interface_Static.SetCVal('write.step.unit', 'MM');
    const w = new oc.STEPControl_Writer_1(); const st = w.Transfer(sh, oc.STEPControl_StepModelType.STEPControl_AsIs, true, pr(oc));
    if (st !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error('STEP-Übertragung fehlgeschlagen');
    w.Write('/out.stp'); const b = oc.FS.readFile('/out.stp'); oc.FS.unlink('/out.stp'); return b;
  }
  oc.Interface_Static.SetIVal('write.iges.brep.mode', 0);
  const w = new oc.IGESControl_Writer_2('MM', 0); w.AddShape(sh, pr(oc)); w.ComputeModel(); w.Write_2('/out.igs', false);
  const b = oc.FS.readFile('/out.igs'); oc.FS.unlink('/out.igs'); return b;
}
