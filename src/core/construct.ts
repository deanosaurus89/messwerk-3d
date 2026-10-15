// Constructed features: geometry derived from other features (parents) instead of mesh points.
// Each construction declares its input slots and a compute(); results are FitResults like measured features, so
// controls, datums, distances and coordinate systems work unchanged. Constructions are recomputed whenever a parent
// changes (see recomputeOrder). Best-fit constructions report a form deviation of the parent centers.
import { FitResult, GeomType, fitCircle3D, fitLine, fitPlane, fitSphere, centroid } from './fit';
import { Vec3, add, cross, dot, norm, scale, sub, unit, basis, solve } from './linalg';

export type Cls = 'plane' | 'line' | 'point' | 'circle' | 'cyl' | 'cone' | 'sphere' | 'slot' | 'torus' | 'any';
/** Classes a feature type satisfies. Axis-like features (cylinder, cone, torus, slot, circle) also count as lines. */
export function classesOf(t: GeomType): Cls[] {
  switch (t) {
    case 'Ebene': return ['plane', 'any'];
    case 'Linie': return ['line', 'any'];
    case 'Punkt': return ['point', 'any'];
    case 'Kreis': return ['circle', 'point', 'line', 'any'];
    case 'Zylinder': return ['cyl', 'line', 'point', 'any'];
    case 'Kegel': return ['cone', 'line', 'point', 'any'];
    case 'Kugel': return ['sphere', 'point', 'any'];
    case 'Langloch': return ['slot', 'point', 'line', 'any'];
    case 'Torus': return ['torus', 'line', 'point', 'any'];
    case 'Abstand': case 'Winkel': case 'Freiformfläche': return [];
  }
}
export interface Slot { label: string; cls: Cls[] }
export interface ConParam { key: string; label: string; def: number; unit?: string; choices?: string[] }
export interface Construction {
  key: string; out: GeomType; label: string;
  /** fixed slots, or `multi` = min count of a repeated slot */
  slots: Slot[]; multi?: { min: number; slot: Slot };
  params?: ConParam[];
  compute: (f: FitResult[], p: Record<string, number>) => FitResult;
}

const R0 = { rms: 0, form: 0, maxPos: 0, maxNeg: 0, n: 0 };
const stats = (res: number[]) => { if (!res.length) return R0; let s = 0, mn = Infinity, mx = -Infinity; for (const r of res) { s += r * r; mn = Math.min(mn, r); mx = Math.max(mx, r); } return { rms: Math.sqrt(s / res.length), form: mx - mn, maxPos: mx, maxNeg: mn, n: res.length }; };
const P = (c: Vec3, n: Vec3 = [0, 0, 1]): FitResult => ({ type: 'Punkt', center: c, normal: n, ...R0, n: 1 });
const canon = (d: Vec3): Vec3 => { const k = [0, 1, 2].reduce((a, b) => (Math.abs(d[b]) > Math.abs(d[a]) ? b : a), 0); return d[k] < 0 ? scale(d, -1) : d; };
const L = (c: Vec3, d: Vec3, len = 0, extra: Partial<FitResult> = {}): FitResult => { const u = canon(unit(d)); return { type: 'Linie', center: c, normal: u, direction: u, length: len, ...R0, ...extra }; };
const PL = (c: Vec3, n: Vec3, extra: Partial<FitResult> = {}): FitResult => ({ type: 'Ebene', center: c, normal: unit(n), ...R0, ...extra });
const C = (c: Vec3, n: Vec3, r: number, extra: Partial<FitResult> = {}): FitResult => ({ type: 'Kreis', center: c, normal: unit(n), radius: r, diameter: 2 * r, ...R0, ...extra });
/** direction of a line-like feature */
const dirOf = (f: FitResult): Vec3 => unit((f.type === 'Linie' || f.type === 'Langloch') && f.direction ? f.direction : f.normal);
const pt = (f: FitResult): Vec3 => f.center;
const projPlane = (pl: FitResult, q: Vec3): Vec3 => sub(q, scale(pl.normal, dot(sub(q, pl.center), pl.normal)));
const projLine = (ln: FitResult, q: Vec3): Vec3 => { const d = dirOf(ln); return add(ln.center, scale(d, dot(sub(q, ln.center), d))); };
function linePlane(ln: FitResult, pl: FitResult): Vec3 {
  const d = dirOf(ln), den = dot(d, pl.normal);
  if (Math.abs(den) < 1e-9) throw new Error('Line is parallel to the plane');
  return add(ln.center, scale(d, dot(sub(pl.center, ln.center), pl.normal) / den));
}
function closest2(a: FitResult, b: FitResult): [Vec3, Vec3] {
  const d1 = dirOf(a), d2 = dirOf(b), r = sub(a.center, b.center);
  const A = dot(d1, d1), B = dot(d1, d2), Cc = dot(d2, d2), D = dot(d1, r), E = dot(d2, r), den = A * Cc - B * B;
  if (Math.abs(den) < 1e-12) throw new Error('Lines are parallel');
  const s = (B * E - Cc * D) / den, t = (A * E - B * D) / den;
  return [add(a.center, scale(d1, s)), add(b.center, scale(d2, t))];
}
function planePlane(a: FitResult, b: FitResult): FitResult {
  const d = cross(a.normal, b.normal); if (norm(d) < 1e-9) throw new Error('Planes are parallel');
  const u = unit(d);
  // point on both planes closest to the mean of both centers
  const m = scale(add(a.center, b.center), 0.5);
  const x = solve([[...a.normal], [...b.normal], [...u]], [dot(a.normal, a.center), dot(b.normal, b.center), dot(u, m)]);
  if (!x) throw new Error('Planes are parallel');
  return L(x as Vec3, u, 0);
}
const planeOf = (pl: FitResult) => ({ center: pl.center, normal: pl.normal });
const center = (fs: FitResult[]) => fs.map(pt);
const S = (label: string, ...cls: Cls[]): Slot => ({ label, cls });

export const CONSTRUCTIONS: Construction[] = [
  // ---------------- points
  { key: 'pt-plane-line', out: 'Punkt', label: 'Intersection plane ∩ line/axis', slots: [S('Plane', 'plane'), S('Line / axis', 'line')], compute: ([pl, ln]) => P(linePlane(ln, pl), pl.normal) },
  { key: 'pt-3planes', out: 'Punkt', label: 'Intersection of 3 planes', slots: [S('Plane 1', 'plane'), S('Plane 2', 'plane'), S('Plane 3', 'plane')],
    compute: ([a, b, c]) => { const x = solve([[...a.normal], [...b.normal], [...c.normal]], [dot(a.normal, a.center), dot(b.normal, b.center), dot(c.normal, c.center)]);
      if (!x || x.some((v) => !isFinite(v)) || Math.abs(dot(a.normal, cross(b.normal, c.normal))) < 1e-6) throw new Error('Planes do not meet in one point'); return P(x as Vec3); } },
  { key: 'pt-2lines', out: 'Punkt', label: 'Closest point of 2 lines (midpoint)', slots: [S('Line 1', 'line'), S('Line 2', 'line')],
    compute: ([a, b]) => { const [p, q] = closest2(a, b); const g = norm(sub(p, q)); return { ...P(scale(add(p, q), 0.5)), form: g, maxPos: g / 2, maxNeg: -g / 2, rms: g / 2 }; } },
  { key: 'pt-center', out: 'Punkt', label: 'Center of circle, sphere, slot or torus', slots: [S('Feature', 'circle', 'sphere', 'slot', 'torus', 'cyl')], compute: ([f]) => P(f.center, f.normal) },
  { key: 'pt-apex', out: 'Punkt', label: 'Cone apex', slots: [S('Cone', 'cone')], compute: ([f]) => { if (!f.apex) throw new Error('Cone without apex'); return P(f.apex, f.normal); } },
  { key: 'pt-proj-plane', out: 'Punkt', label: 'Projection of a point onto a plane', slots: [S('Point / center', 'point'), S('Plane', 'plane')], compute: ([p, pl]) => P(projPlane(pl, pt(p)), pl.normal) },
  { key: 'pt-proj-line', out: 'Punkt', label: 'Projection of a point onto a line', slots: [S('Point / center', 'point'), S('Line / axis', 'line')], compute: ([p, ln]) => P(projLine(ln, pt(p))) },
  { key: 'pt-mid', out: 'Punkt', label: 'Midpoint of 2 features', slots: [S('Feature 1', 'point', 'plane', 'line'), S('Feature 2', 'point', 'plane', 'line')], compute: ([a, b]) => P(scale(add(a.center, b.center), 0.5)) },
  { key: 'pt-centroid', out: 'Punkt', label: 'Centroid of several features', slots: [], multi: { min: 2, slot: S('Feature', 'point', 'plane', 'line') }, compute: (fs) => P(centroid(center(fs))) },
  // ---------------- lines
  { key: 'ln-planes', out: 'Linie', label: 'Intersection plane ∩ plane', slots: [S('Plane 1', 'plane'), S('Plane 2', 'plane')], compute: ([a, b]) => planePlane(a, b) },
  { key: 'ln-axis', out: 'Linie', label: 'Axis of cylinder, cone or torus', slots: [S('Feature', 'cyl', 'cone', 'torus')], compute: ([f]) => L(f.center, f.normal, f.length ?? 0) },
  { key: 'ln-slot', out: 'Linie', label: 'Slot center line', slots: [S('Slot', 'slot')], compute: ([f]) => L(f.center, f.direction ?? f.normal, Math.max(0, (f.length ?? 0) - (f.width ?? 0))) },
  { key: 'ln-normal', out: 'Linie', label: 'Circle normal (axis through center)', slots: [S('Circle', 'circle')], compute: ([f]) => L(f.center, f.normal, f.diameter ?? 0) },
  { key: 'ln-2pts', out: 'Linie', label: 'Line through 2 points or centers (circle, slot, sphere, cylinder …)', slots: [S('Point 1', 'point'), S('Point 2', 'point')],
    compute: ([a, b]) => { const d = sub(pt(b), pt(a)); if (norm(d) < 1e-9) throw new Error('Points coincide'); return L(scale(add(pt(a), pt(b)), 0.5), d, norm(d)); } },
  { key: 'ln-fit', out: 'Linie', label: 'Best-fit line (straightness)', slots: [], multi: { min: 3, slot: S('Point / center', 'point') }, compute: (fs) => { const r = fitLine(center(fs)); delete r.residuals; return r; } },
  { key: 'ln-proj', out: 'Linie', label: 'Projection of a line onto a plane', slots: [S('Line / axis', 'line'), S('Plane', 'plane')],
    compute: ([ln, pl]) => { const d = dirOf(ln), dp = sub(d, scale(pl.normal, dot(d, pl.normal))); if (norm(dp) < 1e-9) throw new Error('Line is perpendicular to the plane'); return L(projPlane(pl, ln.center), dp, ln.length ?? 0); } },
  { key: 'ln-mid', out: 'Linie', label: 'Middle line of 2 lines', slots: [S('Line 1', 'line'), S('Line 2', 'line')],
    compute: ([a, b]) => { let d2 = dirOf(b); const d1 = dirOf(a); if (dot(d1, d2) < 0) d2 = scale(d2, -1); return L(scale(add(a.center, projLine(b, a.center)), 0.5), add(d1, d2), Math.max(a.length ?? 0, b.length ?? 0)); } },
  { key: 'ln-perp', out: 'Linie', label: 'Perpendicular from a point to a line', slots: [S('Point / center', 'point'), S('Line / axis', 'line')],
    compute: ([p, ln]) => { const q = pt(p), f = projLine(ln, q), d = sub(q, f); if (norm(d) < 1e-9) throw new Error('Point lies on the line'); return L(scale(add(q, f), 0.5), d, norm(d)); } },
  // ---------------- planes
  { key: 'pl-fit', out: 'Ebene', label: 'Best-fit plane (flatness)', slots: [], multi: { min: 3, slot: S('Point / center', 'point', 'plane', 'line') }, compute: (fs) => { const r = fitPlane(center(fs), fs[0].type === 'Ebene' ? fs[0].normal : undefined); delete r.residuals; return r; } },
  { key: 'pl-3pts', out: 'Ebene', label: 'Plane through 3 points', slots: [S('Point 1', 'point'), S('Point 2', 'point'), S('Point 3', 'point')],
    compute: ([a, b, c]) => { const n = cross(sub(pt(b), pt(a)), sub(pt(c), pt(a))); if (norm(n) < 1e-9) throw new Error('Points are collinear'); return PL(centroid([pt(a), pt(b), pt(c)]), canon(n)); } },
  { key: 'pl-linept', out: 'Ebene', label: 'Plane through line and point', slots: [S('Line / axis', 'line'), S('Point / center', 'point')],
    compute: ([ln, p]) => { const n = cross(dirOf(ln), sub(pt(p), ln.center)); if (norm(n) < 1e-9) throw new Error('Point lies on the line'); return PL(scale(add(ln.center, pt(p)), 0.5), canon(n)); } },
  { key: 'pl-2lines', out: 'Ebene', label: 'Plane through 2 parallel lines', slots: [S('Line 1', 'line'), S('Line 2', 'line')],
    compute: ([a, b]) => { const d = dirOf(a), w = sub(projLine(b, a.center), a.center); if (norm(w) < 1e-9) throw new Error('Lines coincide');
      const n = cross(d, w), par = Math.acos(Math.min(1, Math.abs(dot(d, dirOf(b))))); const g = norm(w) * Math.sin(par);
      return PL(scale(add(a.center, b.center), 0.5), canon(n), { form: g, maxPos: g / 2, maxNeg: -g / 2, rms: g / 2 }); } },
  { key: 'pl-mid', out: 'Ebene', label: 'Mid-plane of 2 planes', slots: [S('Plane 1', 'plane'), S('Plane 2', 'plane')],
    compute: ([a, b]) => { let n2 = b.normal; if (dot(a.normal, n2) < 0) n2 = scale(n2, -1); const n = unit(add(a.normal, n2)); return PL(scale(add(a.center, projPlane(b, a.center)), 0.5), n); } },
  { key: 'pl-offset', out: 'Ebene', label: 'Offset plane', slots: [S('Plane', 'plane')], params: [{ key: 'd', label: 'Offset', def: 5, unit: 'mm' }],
    compute: ([a], p) => PL(add(a.center, scale(a.normal, p.d ?? 0)), a.normal) },
  { key: 'pl-perp', out: 'Ebene', label: 'Plane perpendicular to an axis through a point', slots: [S('Line / axis', 'line'), S('Point / center', 'point')], compute: ([ln, p]) => PL(pt(p), dirOf(ln)) },
  { key: 'pl-tangent', out: 'Ebene', label: 'Tangent plane to sphere/cylinder, parallel to a plane', slots: [S('Sphere / cylinder', 'sphere', 'cyl'), S('Reference plane', 'plane')],
    params: [{ key: 'side', label: 'Side', def: 0, choices: ['+ normal', '− normal'] }],
    compute: ([s, pl], p) => { const n = scale(pl.normal, p.side ? -1 : 1);
      if (s.type === 'Zylinder' && Math.abs(dot(unit(s.normal), n)) > 0.02) throw new Error('Cylinder axis must be parallel to the plane');
      return PL(add(s.center, scale(n, s.radius ?? 0)), n); } },
  // ---------------- circles, cylinder, sphere, pattern
  { key: 'ci-plane-cyl', out: 'Kreis', label: 'Section plane ∩ cylinder, cone or sphere', slots: [S('Plane', 'plane'), S('Cylinder / cone / sphere', 'cyl', 'cone', 'sphere')],
    compute: ([pl, f]) => {
      if (f.type === 'Kugel') { const d = dot(sub(f.center, pl.center), pl.normal), r = f.radius!; if (Math.abs(d) >= r) throw new Error('Plane does not cut the sphere'); return C(projPlane(pl, f.center), pl.normal, Math.sqrt(r * r - d * d)); }
      const c = linePlane(f, pl), tilt = Math.abs(dot(unit(f.normal), pl.normal));
      if (tilt < 0.98) throw new Error('Plane must be (nearly) perpendicular to the axis');
      if (f.type === 'Kegel') { if (!f.apex || f.halfAngle == null) throw new Error('Cone without apex'); return C(c, pl.normal, norm(sub(c, f.apex)) * Math.tan(f.halfAngle)); }
      return C(c, pl.normal, f.radius!);
    } },
  { key: 'ci-fit', out: 'Kreis', label: 'Best-fit circle through centers (bolt circle)', slots: [], multi: { min: 3, slot: S('Point / center', 'point') },
    compute: (fs) => { const pts = center(fs), r = fitCircle3D(pts, fs.find((f) => f.type !== 'Kugel' && f.type !== 'Punkt')?.normal); delete r.residuals; return r; } },
  { key: 'ci-proj', out: 'Kreis', label: 'Projection of a circle onto a plane', slots: [S('Circle', 'circle'), S('Plane', 'plane')], compute: ([c, pl]) => C(projPlane(pl, c.center), pl.normal, c.radius!) },
  { key: 'cy-axis', out: 'Zylinder', label: 'Cylinder from axis and radius', slots: [S('Line / axis', 'line')], params: [{ key: 'r', label: 'Radius', def: 5, unit: 'mm' }, { key: 'h', label: 'Height', def: 20, unit: 'mm' }],
    compute: ([ln], p) => ({ type: 'Zylinder', center: ln.center, normal: canon(dirOf(ln)), radius: p.r, diameter: 2 * p.r, length: p.h || ln.length || 0, ...R0 }) },
  { key: 'sp-fit', out: 'Kugel', label: 'Best-fit sphere through centers', slots: [], multi: { min: 4, slot: S('Point / center', 'point') }, compute: (fs) => { const r = fitSphere(center(fs)); delete r.residuals; return r; } },
  { key: 'bc-pattern', out: 'Kreis', label: 'Bolt-circle pattern with pitch', slots: [], multi: { min: 3, slot: S('Hole / center', 'point') },
    compute: (fs) => {
      const pts = center(fs), c = fitCircle3D(pts, fs.find((f) => f.type !== 'Kugel' && f.type !== 'Punkt')?.normal); delete c.residuals;
      const [u, v] = basis(c.normal), ang = pts.map((q) => { const d = sub(q, c.center); return (Math.atan2(dot(d, v), dot(d, u)) * 180 / Math.PI + 360) % 360; });
      const order = ang.map((a, i) => [a, i]).sort((x, y) => x[0] - y[0]);
      const n = pts.length, pitch = 360 / n, a0 = order[0][0];
      // pitch deviation: angular position vs ideal equal division (best rotation), in degrees
      const offs = order.map(([a], k) => ((a - a0 - k * pitch + 540) % 360) - 180), mean = offs.reduce((s, x) => s + x, 0) / n;
      const pd = offs.map((x) => x - mean), pitchDev = Math.max(...pd.map(Math.abs));
      return { ...c, pattern: { n, angles: order.map(([a]) => +a.toFixed(4)), pitch, pitchDev, radialDev: c.form } };
    } },
  // ---------------- angle
  { key: 'an-2', out: 'Winkel', label: 'Angle between 2 features (lines, planes, cylinder/cone axes, slots, circle normals)', slots: [S('Feature 1', 'line', 'plane'), S('Feature 2', 'line', 'plane')],
    compute: ([a, b]) => {
      const da = a.type === 'Ebene' ? a.normal : dirOf(a), db = b.type === 'Ebene' ? b.normal : dirOf(b);
      let t = Math.acos(Math.min(1, Math.abs(dot(unit(da), unit(db))))) * 180 / Math.PI;
      // plane–line: angle between the line and the plane = 90° − angle to the normal
      if ((a.type === 'Ebene') !== (b.type === 'Ebene')) t = 90 - t;
      let p0: Vec3; try { p0 = a.type !== 'Ebene' && b.type !== 'Ebene' ? scale(add(...closest2(a, b)), 0.5) : scale(add(a.center, b.center), 0.5); } catch { p0 = scale(add(a.center, b.center), 0.5); }
      return { type: 'Winkel', center: p0, normal: unit(cross(da, db)).some(isNaN) ? [0, 0, 1] : unit(cross(da, db)), angle: t, p1: a.center, p2: b.center, ...R0 };
    } },
];
export const conByKey = (k: string) => CONSTRUCTIONS.find((c) => c.key === k);
export const constructionsFor = (out: GeomType) => CONSTRUCTIONS.filter((c) => c.out === out);
/** Output types that can be constructed (ribbon order). */
export const CON_OUTS: { out: GeomType; label: string; key?: string }[] = [
  { out: 'Punkt', label: 'Point' }, { out: 'Linie', label: 'Line / axis' }, { out: 'Ebene', label: 'Plane' }, { out: 'Kreis', label: 'Circle' },
  { out: 'Zylinder', label: 'Cylinder' }, { out: 'Kugel', label: 'Sphere' }, { out: 'Kreis', label: 'Bolt circle', key: 'bc-pattern' }, { out: 'Winkel', label: 'Angle' }];
export const slotFor = (c: Construction, i: number): Slot | null => (i < c.slots.length ? c.slots[i] : c.multi ? c.multi.slot : null);
export const accepts = (s: Slot, t: GeomType) => classesOf(t).some((k) => s.cls.includes(k));
export function runConstruction(key: string, parents: FitResult[], params: Record<string, number> = {}): FitResult {
  const c = conByKey(key); if (!c) throw new Error('Unknown construction');
  const need = c.slots.length + (c.multi?.min ?? 0); if (parents.length < Math.max(need, c.slots.length)) throw new Error(`Needs ${need} features`);
  const p: Record<string, number> = {}; for (const q of c.params ?? []) p[q.key] = params[q.key] ?? q.def;
  const r = c.compute(parents, p);
  if ([r.center, r.normal].some((v) => v.some((x) => !isFinite(x)))) throw new Error('No solution');
  return r;
}
/** Parent-first order of constructed features (ids); cycles are dropped. */
export function recomputeOrder(items: { id: number; refs: number[] }[]): number[] {
  const m = new Map(items.map((i) => [i.id, i.refs])), out: number[] = [], st = new Map<number, 1 | 2>();
  const visit = (id: number) => { if (st.get(id) === 2) return; if (st.get(id) === 1) return; st.set(id, 1); for (const r of m.get(id) ?? []) if (m.has(r)) visit(r); st.set(id, 2); out.push(id); };
  for (const i of items) visit(i.id);
  return out;
}
export { stats as conStats };
