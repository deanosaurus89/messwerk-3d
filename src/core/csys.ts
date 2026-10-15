// Local coordinate systems (output frames for XYZ values; not an alignment) from features, 3-2-1 principle ("Level – Rotate – Origin").
// Primary locks 2 rotations (axis from plane normal / cylinder, cone, line axis), secondary locks the rotation about it
// (direction projected into the primary plane), origin X/Y/Z each from a feature (+ offset). Recomputed from the
// features whenever they change; data are never transformed – only outputs are expressed in the active system.
import type { Feature } from './features';
import { Vec3, add, cross, dot, norm, scale, sub, unit } from './linalg';

export type Axis = 'X' | 'Y' | 'Z';
export interface AxisRef { fid: number | null; axis: Axis; flip: boolean }
/** auto: reason text when the entry was auto-filled by suggestOrigin (cleared when the user picks/changes it). */
export interface OriginRef { fid: number | null; off: number; auto?: string }
export interface CSys {
  id: number; name: string;
  primary: AxisRef;          // default +Z
  secondary: AxisRef;        // default +X
  origin: Record<Axis, OriginRef>;
  visible: boolean;
}
/** Rows of R are the local axes ex, ey, ez in global coordinates; local = R·(p − o). */
export interface Frame { o: Vec3; R: [Vec3, Vec3, Vec3] }
export interface CSysResult { frame: Frame | null; dof: number; error?: string; warnings: string[] }

const AX: Axis[] = ['X', 'Y', 'Z'];
export const IDENTITY: Frame = { o: [0, 0, 0], R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
export const newCSys = (id: number, name: string): CSys => ({ id, name, visible: true,
  primary: { fid: null, axis: 'Z', flip: false }, secondary: { fid: null, axis: 'X', flip: false },
  origin: { X: { fid: null, off: 0 }, Y: { fid: null, off: 0 }, Z: { fid: null, off: 0 } } });

const AXIS_TYPES = ['Zylinder', 'Kegel', 'Linie', 'Torus'];
const POINT_TYPES = ['Kreis', 'Kugel', 'Punkt'];
/** Which features may be used in which step. */
export const usableAs = (t: string, step: 'primary' | 'secondary' | 'origin') =>
  step === 'origin' ? t !== 'Abstand' && t !== 'Freiformfläche'
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
  for (const a of AX) { const id = cs.origin[a].fid; if (id != null && !get(id)?.measured) return { frame: null, dof: 0, error: `Origin ${a} feature missing`, warnings }; }
  if (cs.primary.axis === cs.secondary.axis) return { frame: null, dof: 0, error: 'Primary and secondary need different axes', warnings };
  const ex: (Vec3 | null)[] = [null, null, null];
  const ip = AX.indexOf(cs.primary.axis), is = AX.indexOf(cs.secondary.axis);
  let dof = 0;
  // primary
  let e1: Vec3 = (IDENTITY.R[ip] as Vec3).slice() as Vec3;
  if (p) { e1 = dirOf(p, false); if (p.type === 'Kreis') warnings.push('Circle used as axis via its normal'); dof += 2; }
  if (cs.primary.flip) e1 = scale(e1, -1);
  // secondary: projected into the primary plane
  let d2: Vec3;
  if (s) {
    if (POINT_TYPES.includes(s.type)) {
      const of = AX.map((a) => get(cs.origin[a].fid)).find((f) => f && f.id !== s.id && f.type !== 'Ebene');
      const p0 = of ? of.measured!.center : [0, 0, 0] as Vec3;
      d2 = sub(s.measured!.center, p0);
    } else d2 = dirOf(s, true);
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
}
/** Next empty step after `cur` (wrapping around) – steps can be filled in any order. */
export function nextEmptyField(cs: CSys, cur: 'p' | 's' | Axis | null): 'p' | 's' | Axis | null {
  const order = ['p', 's', 'X', 'Y', 'Z'] as const, i = cur ? order.indexOf(cur) : -1;
  const empty = (k: typeof order[number]) => (k === 'p' ? cs.primary.fid : k === 's' ? cs.secondary.fid : cs.origin[k].fid) == null;
  for (let j = 1; j <= order.length; j++) { const k = order[(i + j + order.length) % order.length]; if (k !== cur && empty(k)) return k; }
  return null;
}
