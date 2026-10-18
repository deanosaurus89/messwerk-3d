// Local coordinate systems (output frames for XYZ values; not an alignment) from features, 3-2-1 principle ("Level – Rotate – Origin").
// Primary locks 2 rotations (axis from plane normal / cylinder, cone, line axis), secondary locks the rotation about it
// (direction projected into the primary plane), origin X/Y/Z each from a feature (+ offset). Recomputed from the
// features whenever they change; data are never transformed – only outputs are expressed in the active system.
import type { Feature } from './features';
import { Vec3, add, cross, dot, norm, scale, sub, unit } from './linalg';

export type Axis = 'X' | 'Y' | 'Z';
/** inv: the feature direction (plane normal) is reversed so that it points OUT of the material (set by smartAxis);
 *  flip: user choice of the axis sign (+/−) on top of that */
export interface AxisRef { fid: number | null; axis: Axis; flip: boolean; inv?: boolean }
/** auto: reason text when the entry was auto-filled by suggestOrigin (cleared when the user picks/changes it). */
export interface OriginRef { fid: number | null; off: number; auto?: string }
export interface CSys {
  id: number; name: string;
  primary: AxisRef;          // default +Z
  secondary: AxisRef;        // default +X
  /** tertiary datum feature: locks the remaining translation(s) (origin); axis = the axis it refers to (default Y) */
  tertiary?: AxisRef;
  origin: Record<Axis, OriginRef>;
  visible: boolean;
}
/** Rows of R are the local axes ex, ey, ez in global coordinates; local = R·(p − o). */
export interface Frame { o: Vec3; R: [Vec3, Vec3, Vec3] }
export interface CSysResult { frame: Frame | null; dof: number; error?: string; warnings: string[] }

const AX: Axis[] = ['X', 'Y', 'Z'];
export const IDENTITY: Frame = { o: [0, 0, 0], R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
export const newCSys = (id: number, name: string): CSys => ({ id, name, visible: true,
  primary: { fid: null, axis: 'Z', flip: false }, secondary: { fid: null, axis: 'X', flip: false }, tertiary: { fid: null, axis: 'Y', flip: false },
  origin: { X: { fid: null, off: 0 }, Y: { fid: null, off: 0 }, Z: { fid: null, off: 0 } } });

const AXIS_TYPES = ['Zylinder', 'Kegel', 'Linie', 'Torus'];
const POINT_TYPES = ['Kreis', 'Kugel', 'Punkt'];
/** Which features may be used in which step. */
export const usableAs = (t: string, step: 'primary' | 'secondary' | 'tertiary' | 'origin') =>
  step === 'origin' || step === 'tertiary' ? t !== 'Abstand' && t !== 'Freiformfläche'
    : step === 'primary' ? t === 'Ebene' || AXIS_TYPES.includes(t) || t === 'Kreis' || t === 'Langloch'
      : t === 'Ebene' || AXIS_TYPES.includes(t) || POINT_TYPES.includes(t) || t === 'Langloch';
/** Direction of a feature: plane normal, axis, line/slot direction (secondary). */
function dirOf(f: Feature, secondary: boolean): Vec3 {
  const m = f.measured!;
  if (secondary && (f.type === 'Linie' || f.type === 'Langloch') && m.direction) return unit(m.direction);
  return unit(m.normal);
}

export function computeCSys(cs: CSys, feats: Map<number, Feature>): CSysResult {
  const warnings: string[] = []; const get = (id: number | null) => (id == null ? null : feats.get(id) ?? null);
  const p = get(cs.primary.fid), s = get(cs.secondary.fid);
  if (cs.primary.fid != null && !p?.measured) return { frame: null, dof: 0, error: 'Primary feature missing', warnings };
  if (cs.secondary.fid != null && !s?.measured) return { frame: null, dof: 0, error: 'Secondary feature missing', warnings };
  if (cs.tertiary?.fid != null && !get(cs.tertiary.fid)?.measured) return { frame: null, dof: 0, error: 'Tertiary feature missing', warnings };
  for (const a of AX) { const id = cs.origin[a].fid; if (id != null && !get(id)?.measured) return { frame: null, dof: 0, error: `Origin ${a} feature missing`, warnings }; }
  if (cs.primary.axis === cs.secondary.axis) return { frame: null, dof: 0, error: 'Primary and secondary need different axes', warnings };
  const ex: (Vec3 | null)[] = [null, null, null];
  const ip = AX.indexOf(cs.primary.axis), is = AX.indexOf(cs.secondary.axis);
  let dof = 0;
  // primary
  let e1: Vec3 = (IDENTITY.R[ip] as Vec3).slice() as Vec3;
  if (p) { e1 = dirOf(p, false); if (cs.primary.inv) e1 = scale(e1, -1); if (p.type === 'Kreis') warnings.push('Circle used as axis via its normal'); dof += 2; }
  if (cs.primary.flip) e1 = scale(e1, -1);
  // secondary: projected into the primary plane
  let d2: Vec3;
  if (s) {
    if (POINT_TYPES.includes(s.type)) {
      const of = AX.map((a) => get(cs.origin[a].fid)).find((f) => f && f.id !== s.id && f.type !== 'Ebene');
      const p0 = of ? of.measured!.center : [0, 0, 0] as Vec3;
      d2 = sub(s.measured!.center, p0);
    } else { d2 = dirOf(s, true); if (cs.secondary.inv) d2 = scale(d2, -1); }
    dof += 1;
  } else d2 = (IDENTITY.R[is] as Vec3).slice() as Vec3;
  let e2 = sub(d2, scale(e1, dot(d2, e1)));
  if (norm(e2) < 1e-3 * Math.max(1, norm(d2))) {
    if (s) return { frame: null, dof: 0, error: 'Secondary is parallel to the primary axis', warnings };
    // no secondary: pick any global axis not parallel
    const alt = IDENTITY.R.map((r) => sub(r, scale(e1, dot(r, e1)))).sort((a, b) => norm(b) - norm(a))[0]; e2 = alt;
  }
  e2 = unit(e2); if (s && norm(sub(d2, scale(e1, dot(d2, e1)))) / norm(d2) < 0.985 && !POINT_TYPES.includes(s.type)) warnings.push('Secondary is not perpendicular to the primary – projected');
  if (cs.secondary.flip) e2 = scale(e2, -1);
  ex[ip] = e1; ex[is] = e2;
  const it = 3 - ip - is; // third axis, right-handed
  ex[it] = unit(cross(ex[(it + 1) % 3]!, ex[(it + 2) % 3]!));
  const R = ex as [Vec3, Vec3, Vec3];
  // origin
  let o: Vec3 = [0, 0, 0];
  AX.forEach((a, k) => {
    const r = cs.origin[a], f = get(r.fid);
    const v = f ? dot(R[k], f.measured!.center) : 0;
    if (f) dof += 1;
    o = add(o, scale(R[k], v + (r.off || 0)));
  });
  // tertiary plane/axis direction vs. the right-handed result (informative: adjust with flip / rotate 90°)
  const t = get(cs.tertiary?.fid ?? null);
  if (t && (t.type === 'Ebene') && cs.tertiary) { const k = AX.indexOf(cs.tertiary.axis), dv = dirOf(t, false), c = dot(R[k], dv);
    if (Math.abs(c) < 0.985) warnings.push('Tertiary is not perpendicular to its axis'); }
  // the unset origin axes stay at the global origin's projection
  return { frame: { o, R }, dof, warnings };
}

export const toLocal = (fr: Frame, p: Vec3): Vec3 => { const d = sub(p, fr.o); return [dot(fr.R[0], d), dot(fr.R[1], d), dot(fr.R[2], d)]; };
export const dirLocal = (fr: Frame, v: Vec3): Vec3 => [dot(fr.R[0], v), dot(fr.R[1], v), dot(fr.R[2], v)];
/** Suggest origin features after primary/secondary were picked (plane → its axis; circle/cylinder → the two others). */
export function suggestOrigin(cs: CSys, feats: Map<number, Feature>) {
  // free step order: drop earlier automatic entries (they may stem from a previous primary/secondary); manual picks stay
  for (const a of AX) if (cs.origin[a].auto) cs.origin[a] = { ...cs.origin[a], fid: null, auto: undefined };
  const p = cs.primary.fid != null ? feats.get(cs.primary.fid) : undefined, s = cs.secondary.fid != null ? feats.get(cs.secondary.fid) : undefined;
  const ip = cs.primary.axis, is = cs.secondary.axis, it = AX.find((a) => a !== ip && a !== is)!;
  const set = (a: Axis, f: Feature, why: string) => { if (cs.origin[a].fid == null) cs.origin[a] = { ...cs.origin[a], fid: f.id, auto: why }; };
  // primary plane: its surface is the zero of the primary axis (the plane fixes this translation)
  if (p && p.type === 'Ebene') set(ip, p, 'primary plane fixes the ' + ip + ' translation');
  // primary axis (cylinder/cone/line/torus/circle): the axis passes through the origin → it fixes BOTH other translations
  if (p && AXIS_TYPES.concat('Kreis').includes(p.type)) { set(is, p, 'primary axis passes through the origin'); set(it, p, 'primary axis passes through the origin'); }
  // secondary plane: zero of the secondary axis
  if (s && s.type === 'Ebene') set(is, s, 'secondary plane fixes the ' + is + ' translation');
  // secondary axis (line/cylinder …) lying in the primary plane: it passes through the origin → fixes the third translation
  if (s && AXIS_TYPES.includes(s.type)) set(it, s, 'secondary axis passes through the origin');
  // secondary circle/sphere/point: its centre fixes the secondary translation (and the third if still free)
  if (s && POINT_TYPES.includes(s.type)) set(is, s, 'secondary centre fixes the ' + is + ' translation');
  // tertiary: plane → zero of its axis; axis/point feature → the remaining free translations
  const t = cs.tertiary?.fid != null ? feats.get(cs.tertiary.fid) : undefined;
  if (t) { const ta = cs.tertiary!.axis;
    if (t.type === 'Ebene') set(ta, t, 'tertiary plane fixes the ' + ta + ' translation');
    else for (const a of AX) if (a !== ip || !(p && p.type === 'Ebene')) set(a, t, 'tertiary centre/axis fixes the ' + a + ' translation'); }
}
/** Rotate the frame by 90° about the primary axis: the secondary's axis steps +A → +B → −A → −B (A, B = the two
 *  axes ⟂ primary); the tertiary axis follows to the remaining axis. */
export function rotate90(cs: CSys) {
  const ip = cs.primary.axis, [A, B] = AX.filter((a) => a !== ip), seq: [Axis, boolean][] = [[A, false], [B, false], [A, true], [B, true]];
  const k = seq.findIndex(([a, f]) => a === cs.secondary.axis && f === cs.secondary.flip);
  [cs.secondary.axis, cs.secondary.flip] = seq[(k + 1) % 4];
  if (cs.tertiary) cs.tertiary.axis = AX.find((a) => a !== ip && a !== cs.secondary.axis)!;
}
/** Smart axis defaults when a slot gets a feature: primary → Z (plane: +Z out of material), secondary → X (plane: out of
 *  material), tertiary → the remaining axis. `outward` = mean surface normal of the feature points (material side). */
export function smartAxis(cs: CSys, slot: 'p' | 's' | 't', f: Feature, outward: Vec3 | null) {
  const out = (n: Vec3) => (outward && f.type === 'Ebene' ? dot(n, outward) < 0 : false);
  if (slot === 'p') { cs.primary.axis = 'Z'; cs.primary.flip = false; cs.primary.inv = out(unit(f.measured!.normal));
    if (cs.secondary.axis === 'Z') cs.secondary.axis = 'X'; }
  else if (slot === 's') { cs.secondary.axis = cs.primary.axis === 'X' ? 'Y' : 'X'; cs.secondary.flip = false; cs.secondary.inv = out(dirOf(f, true)); }
  if (!cs.tertiary) cs.tertiary = { fid: null, axis: 'Y', flip: false };
  cs.tertiary.axis = AX.find((a) => a !== cs.primary.axis && a !== cs.secondary.axis)!;
}
/** Next empty step after `cur` (wrapping around) – steps can be filled in any order. */
export function nextEmptyField(cs: CSys, cur: 'p' | 's' | 't' | Axis | null): 'p' | 's' | 't' | Axis | null {
  const order = ['p', 's', 't', 'X', 'Y', 'Z'] as const, i = cur ? order.indexOf(cur) : -1;
  const empty = (k: typeof order[number]) => (k === 'p' ? cs.primary.fid : k === 's' ? cs.secondary.fid : k === 't' ? cs.tertiary?.fid ?? null : cs.origin[k].fid) == null;
  for (let j = 1; j <= order.length; j++) { const k = order[(i + j + order.length) % order.length]; if (k !== cur && empty(k)) return k; }
  return null;
}
