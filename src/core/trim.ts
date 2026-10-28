// Trimmed feature geometry: the fitted surface restricted to the triangles of the selected points
// (all 3 vertices in the feature), each vertex projected onto the fitted element; plus the boundary contour.
import { type FitResult, signedDistance } from './fit';
import { Vec3, add, basis, cross, dot, norm, scale, sub, unit } from './linalg';

/** Vertices within this distance [mm] of a fitted cone count toward its full surface extent.
 *  Tighter than the extract search distance, so a fillet just off the cone does not stretch the frustum.
 *  Open ends stay at that mesh/CAD limit — a mathematical apex past the scan is not added. */
export const SURFACE_SPAN_BAND = 0.35;

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

export interface ShellOpt {
  /** 'points' (default): axial and angular extent of `verts` only.
   *  'surface': every mesh vertex within `band` of the fitted surface — the frustum the mesh actually covers,
   *  not the click-grown patch. Open ends stay at that mesh/CAD limit. */
  span?: 'points' | 'surface';
  band?: number;
}
/** Axial extent [mm] along the fitted axis of mesh vertices within `band` of the surface, or null when too few. */
export function surfaceAxial(f: FitResult, pos: ArrayLike<number>, band = SURFACE_SPAN_BAND): [number, number] | null {
  const n = unit(f.normal), c = f.center; let t0 = Infinity, t1 = -Infinity, k = 0;
  for (let i = 0; i < pos.length / 3; i++) {
    const p: Vec3 = [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
    if (Math.abs(signedDistance(f, p)) > band) continue;
    const t = (p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1] + (p[2] - c[2]) * n[2];
    if (t < t0) t0 = t; if (t > t1) t1 = t; k++;
  }
  return k >= 8 && t1 > t0 + 1e-6 ? [t0, t1] : null;
}
/**
 * Analytic display of a cylinder/cone whose boundary comes from the FITTED GEOMETRY (not the selected triangles):
 * the surface between an axial extent (t0…t1 along the axis), over the full 360° when the wall is closed, otherwise
 * over the covered angular range (largest empty sector cut out). Default extent is the given points (cylinder, 0.27).
 * `span: 'surface'` uses the whole mesh frustum of a cone. Edges are clean circles/arcs at t0 and t1 (+ the two axial
 * lines of an open wall) – no polygonal outline of the mesh selection.
 */
export function analyticShell(f: FitResult, pos: ArrayLike<number>, verts: Uint32Array, bins = 72, opt?: ShellOpt): { tri: Float32Array; edges: Float32Array; closed: boolean; t0: number; t1: number; a0: number; a1: number } {
  const n = unit(f.normal), c = f.center, [u, v] = basis(n), occ = new Uint8Array(bins);
  const ts: number[] = [], surf = opt?.span === 'surface', band = opt?.band ?? SURFACE_SPAN_BAND;
  const take = (k: number) => {
    const p: Vec3 = [pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]];
    if (surf && Math.abs(signedDistance(f, p)) > band) return;
    const q: Vec3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    ts.push(dot(q, n)); const a = Math.atan2(dot(q, v), dot(q, u)); occ[Math.min(bins - 1, Math.floor(((a + Math.PI) / (2 * Math.PI)) * bins))] = 1;
  };
  if (surf) { for (let k = 0; k < pos.length / 3; k++) take(k); if (ts.length < 8) { ts.length = 0; occ.fill(0); for (let i = 0; i < verts.length; i++) take(verts[i]); } }
  else for (let i = 0; i < verts.length; i++) take(verts[i]);
  ts.sort((a, b) => a - b);
  const qn = (p: number) => ts.length ? ts[Math.min(ts.length - 1, Math.max(0, Math.round(p * (ts.length - 1))))] : 0;
  const t0 = qn(0.001), t1 = qn(0.999);
  // largest run of empty bins (cyclic)
  let best = 0, bestEnd = -1, run = 0;
  for (let i = 0; i < 2 * bins; i++) { if (!occ[i % bins]) { run++; if (run > best && run <= bins) { best = run; bestEnd = i; } } else run = 0; }
  const closed = best <= 2; // ≤ 10° gap (scan holes, sparse lines) counts as a closed wall
  const step = (2 * Math.PI) / bins;
  let a0 = -Math.PI, a1 = Math.PI;
  if (!closed) { a0 = -Math.PI + ((bestEnd + 1) % bins) * step; a1 = a0 + (bins - best) * step; }
  const R = (t: number) => f.type === 'Kegel' ? Math.max(0, f.radius! + t * Math.tan(f.halfAngle ?? 0)) : f.radius!;
  const P = (a: number, t: number): Vec3 => { const r = R(t), ca = Math.cos(a) * r, sa = Math.sin(a) * r; return [c[0] + n[0] * t + u[0] * ca + v[0] * sa, c[1] + n[1] * t + u[1] * ca + v[1] * sa, c[2] + n[2] * t + u[2] * ca + v[2] * sa]; };
  const na = Math.max(8, Math.round(((a1 - a0) / (2 * Math.PI)) * 96)), nt = 4, tri: number[] = [], ed: number[] = [];
  for (let i = 0; i < na; i++) for (let j = 0; j < nt; j++) {
    const aa = a0 + ((a1 - a0) * i) / na, ab = a0 + ((a1 - a0) * (i + 1)) / na, ta = t0 + ((t1 - t0) * j) / nt, tb = t0 + ((t1 - t0) * (j + 1)) / nt;
    const p00 = P(aa, ta), p10 = P(ab, ta), p01 = P(aa, tb), p11 = P(ab, tb); tri.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
  }
  for (const t of [t0, t1]) for (let i = 0; i < na; i++) ed.push(...P(a0 + ((a1 - a0) * i) / na, t), ...P(a0 + ((a1 - a0) * (i + 1)) / na, t));
  if (!closed) for (const a of [a0, a1]) ed.push(...P(a, t0), ...P(a, t1));
  return { tri: new Float32Array(tri), edges: new Float32Array(ed), closed, t0, t1, a0, a1 };
}
/** Complete fitted sphere (both hemispheres). A selected cap is not the feature geometry. */
export function analyticSphere(f: FitResult, nLat = 16, nLon = 32): { tri: Float32Array; edges: Float32Array } {
  const c = f.center, r = Math.max(1e-6, f.radius ?? 1);
  const P = (i: number, j: number): Vec3 => {
    const b = Math.PI * (j / nLat) - Math.PI / 2, a = (2 * Math.PI * i) / nLon, cb = Math.cos(b), sb = Math.sin(b);
    return [c[0] + r * cb * Math.cos(a), c[1] + r * cb * Math.sin(a), c[2] + r * sb];
  };
  const tri: number[] = [], ed: number[] = [];
  for (let j = 0; j < nLat; j++) for (let i = 0; i < nLon; i++) {
    const i1 = (i + 1) % nLon, p00 = P(i, j), p10 = P(i1, j), p01 = P(i, j + 1), p11 = P(i1, j + 1);
    if (j === 0) tri.push(...p00, ...p11, ...p01); else if (j === nLat - 1) tri.push(...p00, ...p10, ...p01);
    else tri.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
  }
  for (let i = 0; i < nLon; i++) ed.push(...P(i, nLat >> 1), ...P(i + 1, nLat >> 1));
  for (const i of [0, nLon >> 2]) for (let j = 0; j < nLat; j++) ed.push(...P(i, j), ...P(i, j + 1));
  return { tri: new Float32Array(tri), edges: new Float32Array(ed) };
}
