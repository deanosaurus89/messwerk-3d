// Trim an analytic fit to a face boundary (outer loop + islands) instead of drawing
// the infinite plane or the full cylinder/sphere. Loops are model-space polylines.
import type { FitResult } from './fit';
import { Vec3, add, basis, cross, dot, norm, scale, sub, unit } from './linalg';
import { projectOnto } from './trim';

function inside(poly: [number, number][], x: number, y: number): boolean {
  let w = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi) w = !w;
  }
  return w;
}

function paramOf(fit: FitResult, p: Vec3): [number, number] {
  const n = unit(fit.normal), c = fit.center, [u, v] = basis(n), d = sub(p, c);
  if (fit.type === 'Zylinder' || fit.type === 'Kegel') {
    const h = dot(d, n), radial = sub(d, scale(n, h));
    return [Math.atan2(dot(radial, v), dot(radial, u)), h];
  }
  if (fit.type === 'Kugel' && fit.radius) {
    const w = unit(d);
    const phi = Math.acos(Math.max(-1, Math.min(1, dot(w, n))));
    const pl = sub(w, scale(n, dot(w, n)));
    return [Math.atan2(dot(pl, v), dot(pl, u)), phi];
  }
  if (fit.type === 'Torus' && fit.radius && fit.minorRadius) {
    const radial = sub(d, scale(n, dot(d, n)));
    const major = Math.atan2(dot(radial, v), dot(radial, u));
    const m = add(c, scale(unit(radial), fit.radius));
    const tube = sub(p, m);
    const radU = unit(radial);
    return [major, Math.atan2(dot(tube, n), dot(tube, radU))];
  }
  return [dot(d, u), dot(d, v)];
}

function pointOf(fit: FitResult, s: number, t: number): Vec3 {
  const n = unit(fit.normal), c = fit.center, [u, v] = basis(n);
  if (fit.type === 'Zylinder' && fit.radius) return add(c, add(scale(n, t), add(scale(u, fit.radius * Math.cos(s)), scale(v, fit.radius * Math.sin(s)))));
  if (fit.type === 'Kegel' && fit.halfAngle != null) {
    const R = Math.max(0, (fit.radius ?? 0) + t * Math.tan(fit.halfAngle));
    return add(c, add(scale(n, t), add(scale(u, R * Math.cos(s)), scale(v, R * Math.sin(s)))));
  }
  if (fit.type === 'Kugel' && fit.radius) {
    const st = Math.sin(t);
    return add(c, scale(add(add(scale(u, st * Math.cos(s)), scale(v, st * Math.sin(s))), scale(n, Math.cos(t))), fit.radius));
  }
  if (fit.type === 'Torus' && fit.radius && fit.minorRadius) {
    const rad = add(scale(u, Math.cos(s)), scale(v, Math.sin(s)));
    const tube = add(scale(rad, Math.cos(t)), scale(n, Math.sin(t)));
    return add(c, add(scale(rad, fit.radius), scale(tube, fit.minorRadius)));
  }
  return add(c, add(scale(u, s), scale(v, t)));
}

function unwrap(fit: FitResult, loop: Vec3[]): [number, number][] {
  const raw = loop.map((p) => paramOf(fit, projectOnto(fit, p)));
  if (fit.type === 'Ebene' || raw.length < 2) return raw;
  const out: [number, number][] = [[raw[0][0], raw[0][1]]];
  let prev = raw[0][0];
  for (let i = 1; i < raw.length; i++) {
    let a = raw[i][0];
    while (a - prev > Math.PI) a -= Math.PI * 2;
    while (prev - a > Math.PI) a += Math.PI * 2;
    prev = a; out.push([a, raw[i][1]]);
  }
  return out;
}

/** Closed boundary loops of a triangle mesh: edges used by one triangle, chained.
 *  The longest loop is first (outer); the rest are islands. */
export function loopsFromMesh(pos: ArrayLike<number>, idx: ArrayLike<number>): Vec3[][] {
  const cnt = new Map<string, { a: number; b: number; n: number }>();
  const key = (a: number, b: number) => (a < b ? a + ',' + b : b + ',' + a);
  for (let i = 0; i < idx.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = idx[i + k], b = idx[i + ((k + 1) % 3)], k2 = key(a, b), e = cnt.get(k2);
    if (e) e.n++; else cnt.set(k2, { a, b, n: 1 });
  }
  const next = new Map<number, number[]>();
  for (const e of cnt.values()) if (e.n === 1) {
    (next.get(e.a) ?? next.set(e.a, []).get(e.a)!).push(e.b);
    (next.get(e.b) ?? next.set(e.b, []).get(e.b)!).push(e.a);
  }
  const used = new Set<string>();
  const loops: Vec3[][] = [];
  const P = (i: number): Vec3 => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
  for (const s of next.keys()) {
    const nb = next.get(s)!;
    for (const t0 of nb) {
      const ek = key(s, t0); if (used.has(ek)) continue;
      const loop: Vec3[] = [P(s)];
      let prev = s, cur = t0; used.add(ek);
      for (let guard = 0; guard < idx.length + 4; guard++) {
        loop.push(P(cur));
        const nbs = next.get(cur) ?? [];
        const nx = nbs.find((v) => v !== prev && !used.has(key(cur, v))) ?? nbs.find((v) => v !== prev);
        if (nx == null || nx === s) break;
        const k2 = key(cur, nx); if (used.has(k2)) break;
        used.add(k2); prev = cur; cur = nx;
      }
      if (loop.length >= 3) loops.push(loop);
    }
  }
  const area = (L: Vec3[]) => { let a = 0; for (let i = 1; i + 1 < L.length; i++) a += norm(cross(sub(L[i], L[0]), sub(L[i + 1], L[0]))); return a; };
  loops.sort((a, b) => area(b) - area(a));
  return loops;
}

/** Analytic patch limited to the outer loop, with later loops cut out as islands. */
export function facePatch(fit: FitResult, loops: Vec3[][], div = 24): { tri: Float32Array; edges: Float32Array } | null {
  const clean = loops.filter((L) => L.length >= 3);
  if (!clean.length) return null;
  const uv = clean.map((L) => unwrap(fit, L));
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (const L of uv) for (const [s, t] of L) { if (s < s0) s0 = s; if (s > s1) s1 = s; if (t < t0) t0 = t; if (t > t1) t1 = t; }
  if (!(s1 > s0) || !(t1 > t0)) return null;
  const padS = (s1 - s0) * 0.02, padT = (t1 - t0) * 0.02;
  s0 -= padS; s1 += padS; t0 -= padT; t1 += padT;
  const kept = (s: number, t: number) => inside(uv[0], s, t) && uv.slice(1).every((h) => !inside(h, s, t));
  const n = Math.max(4, div);
  const ds = (s1 - s0) / n, dt = (t1 - t0) / n;
  const tri: number[] = [], edges: number[] = [];
  const pushTri = (a: Vec3, b: Vec3, c: Vec3) => tri.push(...a, ...b, ...c);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const sc = s0 + (i + 0.5) * ds, tc = t0 + (j + 0.5) * dt;
    if (!kept(sc, tc)) continue;
    const p00 = pointOf(fit, s0 + i * ds, t0 + j * dt);
    const p10 = pointOf(fit, s0 + (i + 1) * ds, t0 + j * dt);
    const p01 = pointOf(fit, s0 + i * ds, t0 + (j + 1) * dt);
    const p11 = pointOf(fit, s0 + (i + 1) * ds, t0 + (j + 1) * dt);
    pushTri(p00, p10, p11); pushTri(p00, p11, p01);
  }
  for (const L of clean) for (let i = 0; i < L.length; i++) {
    const a = projectOnto(fit, L[i]), b = projectOnto(fit, L[(i + 1) % L.length]);
    edges.push(...a, ...b);
  }
  if (!tri.length) return null;
  return { tri: new Float32Array(tri), edges: new Float32Array(edges) };
}
