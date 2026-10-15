// Trimmed feature geometry: the fitted surface restricted to the triangles of the selected points
// (all 3 vertices in the feature), each vertex projected onto the fitted element; plus the boundary contour.
import type { FitResult } from './fit';
import { Vec3, add, basis, cross, dot, norm, scale, sub, unit } from './linalg';

export const TRIM_TYPES = ['Ebene', 'Zylinder', 'Kugel', 'Kegel', 'Torus'];
/** curve features: trimmed display = only the covered arc / segment of the curve */
export const CURVE_TRIM_TYPES = ['Kreis', 'Langloch', 'Linie'];
export function projectOnto(f: FitResult, p: Vec3): Vec3 {
  const n = unit(f.normal), c = f.center;
  switch (f.type) {
    case 'Ebene': return sub(p, scale(n, dot(sub(p, c), n)));
    case 'Kugel': { const d = sub(p, c), l = norm(d) || 1; return add(c, scale(d, f.radius! / l)); }
    case 'Zylinder': case 'Kegel': {
      const q = sub(p, c), t = dot(q, n), r = sub(q, scale(n, t)), l = norm(r) || 1;
      const R = f.type === 'Kegel' ? Math.max(0, f.radius! + t * Math.tan(f.halfAngle ?? 0)) : f.radius!;
      return add(c, add(scale(n, t), scale(r, R / l)));
    }
    case 'Torus': { // nearest point on the tube: via the nearest point of the centre circle
      const q = sub(p, c), r = sub(q, scale(n, dot(q, n))), l = norm(r) || 1, m = add(c, scale(r, f.radius! / l)), d = sub(p, m), dl = norm(d) || 1;
      return add(m, scale(d, (f.minorRadius ?? 0) / dl)); }
    default: return p;
  }
}
/** Stadium (slot) perimeter: centre c, unit dx, in-plane y, half straight length hl, radius r; s ∈ [0, P). */
function stadium(c: Vec3, dx: Vec3, y: Vec3, hl: number, r: number) {
  const P = 4 * hl + 2 * Math.PI * r;
  const at = (s: number): Vec3 => { s = ((s % P) + P) % P;
    if (s < 2 * hl) return add(c, add(scale(dx, -hl + s), scale(y, -r))); s -= 2 * hl;
    if (s < Math.PI * r) { const a = -Math.PI / 2 + s / r; return add(c, add(scale(dx, hl + r * Math.cos(a)), scale(y, r * Math.sin(a)))); } s -= Math.PI * r;
    if (s < 2 * hl) return add(c, add(scale(dx, hl - s), scale(y, r))); s -= 2 * hl;
    const a = Math.PI / 2 + s / r; return add(c, add(scale(dx, -hl + r * Math.cos(a)), scale(y, r * Math.sin(a)))); };
  const param = (p: Vec3): number => { const q = sub(p, c), x = dot(q, dx), yy = dot(q, y);
    if (Math.abs(x) <= hl) return yy < 0 ? x + hl : 2 * hl + Math.PI * r + (hl - x);
    if (x > hl) { const a = Math.atan2(yy, x - hl); return 2 * hl + (a + Math.PI / 2) * r; }
    let a = Math.atan2(yy, x + hl); if (a < Math.PI / 2) a += 2 * Math.PI; return 4 * hl + Math.PI * r + (a - Math.PI / 2) * r; };
  return { P, at, param };
}
/** Covered part of a curve feature as line segments, or null when the points cover the whole closed curve
 *  (largest gap < minGapDeg of the perimeter). */
export function trimmedCurve(f: FitResult, pts: Vec3[], minGapDeg = 15): Float32Array | null {
  if (pts.length < 2) return null;
  const n = unit(f.normal), c = f.center;
  if (f.type === 'Linie') { const d = unit(f.direction!); let t0 = Infinity, t1 = -Infinity; for (const p of pts) { const t = dot(sub(p, c), d); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    return new Float32Array([...add(c, scale(d, t0)), ...add(c, scale(d, t1))]); }
  let at: (s: number) => Vec3, param: (p: Vec3) => number, P: number;
  if (f.type === 'Kreis') { const [u, v] = basis(n), r = f.radius!; P = 2 * Math.PI;
    at = (s) => add(c, add(scale(u, r * Math.cos(s)), scale(v, r * Math.sin(s)))); param = (p) => { const q = sub(p, c); const a = Math.atan2(dot(q, v), dot(q, u)); return a < 0 ? a + P : a; }; }
  else if (f.type === 'Langloch') { const dx = unit(f.direction!), y = unit(cross(n, dx)), r = f.radius!, st = stadium(c, dx, y, Math.max(0, f.length! / 2 - r), r); P = st.P; at = st.at; param = st.param; }
  else return null;
  const s = pts.map(param).sort((a, b) => a - b); let gap = s[0] + P - s[s.length - 1], start = s[0];
  for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] > gap) { gap = s[i] - s[i - 1]; start = s[i]; }
  if (gap < (minGapDeg / 360) * P) return null;
  const span = P - gap, N = Math.max(8, Math.ceil(96 * span / P)), out: number[] = [];
  for (let i = 0; i < N; i++) out.push(...at(start + (span * i) / N), ...at(start + (span * (i + 1)) / N));
  return new Float32Array(out);
}
/** sorted vertex indices of the feature → projected triangle soup + boundary edge segments */
export function trimmedSurface(f: FitResult, pos: ArrayLike<number>, tris: ArrayLike<number>, verts: Uint32Array, maxTris = 60000): { tri: Float32Array; edges: Float32Array } {
  const inSet = new Uint8Array(pos.length / 3); for (const v of verts) inSet[v] = 1;
  const sel: number[] = [];
  for (let t = 0; t < tris.length / 3; t++) if (inSet[tris[3 * t]] && inSet[tris[3 * t + 1]] && inSet[tris[3 * t + 2]]) sel.push(t);
  const step = Math.max(1, Math.ceil(sel.length / maxTris));
  const P = (v: number) => projectOnto(f, [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]]);
  const out: number[] = []; for (let i = 0; i < sel.length; i += step) { const t = sel[i]; for (let k = 0; k < 3; k++) out.push(...P(tris[3 * t + k])); }
  // boundary: edges used by exactly one selected triangle
  const cnt = new Map<string, [number, number, number]>();
  for (const t of sel) for (let k = 0; k < 3; k++) { const a = tris[3 * t + k], b = tris[3 * t + ((k + 1) % 3)], key = a < b ? a + ',' + b : b + ',' + a; const e = cnt.get(key); if (e) e[2]++; else cnt.set(key, [a, b, 1]); }
  const ed: number[] = []; for (const [a, b, c] of cnt.values()) if (c === 1) ed.push(...P(a), ...P(b));
  return { tri: new Float32Array(out), edges: new Float32Array(ed) };
}
