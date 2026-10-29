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

/** CAD wires only. The display-mesh boundary is not a substitute for a missing wire. */
export function trimLoops(wires: Vec3[][] | null | undefined): Vec3[][] {
  return wires && wires.length ? wires.filter((L) => L.length >= 3) : [];
}

type Uv = [number, number];
const cross2 = (a: Uv, b: Uv, c: Uv) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function dedupeUv(loop: Uv[]): Uv[] {
  const out: Uv[] = [];
  for (const p of loop) {
    const q = out[out.length - 1];
    if (q && Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-8) continue;
    out.push([p[0], p[1]]);
  }
  if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-8) out.pop();
  return out;
}
/** Drop samples that already lie on the chord of their neighbours (straight CAD edges collapse to their endpoints). */
function thinUv(fit: FitResult, loop: Uv[], tol: number): Uv[] {
  const pts = dedupeUv(loop);
  let guard = pts.length;
  while (pts.length > 3 && guard-- > 0) {
    let removed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const pa = pointOf(fit, a[0], a[1]), pb = pointOf(fit, b[0], b[1]), pc = pointOf(fit, c[0], c[1]);
      const mid = scale(add(pa, pc), 0.5);
      const on = pointOf(fit, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2);
      if (norm(sub(on, mid)) <= tol && norm(sub(pb, mid)) <= tol) { pts.splice(i, 1); removed = true; break; }
    }
    if (!removed) break;
  }
  return pts;
}
function segsCross(a: Uv, b: Uv, c: Uv, d: Uv): boolean {
  const d1 = cross2(a, b, c), d2 = cross2(a, b, d), d3 = cross2(c, d, a), d4 = cross2(c, d, b);
  return ((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)) && ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12));
}
const nearUv = (a: Uv, b: Uv) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7;
/** Strict interior. A sample that only touches an edge does not block the ear. */
function pointInTri(a: Uv, b: Uv, c: Uv, p: Uv): boolean {
  const c1 = cross2(a, b, p), c2 = cross2(b, c, p), c3 = cross2(c, a, p);
  if (Math.abs(c1) <= 1e-9 || Math.abs(c2) <= 1e-9 || Math.abs(c3) <= 1e-9) return false;
  return (c1 > 0 && c2 > 0 && c3 > 0) || (c1 < 0 && c2 < 0 && c3 < 0);
}
function onSeg(a: Uv, b: Uv, p: Uv): boolean {
  if (nearUv(p, a) || nearUv(p, b)) return false;
  if (Math.abs(cross2(a, b, p)) > 1e-7) return false;
  const dot = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]);
  const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  return dot > 1e-8 && dot < len2 - 1e-8;
}
function visible(poly: Uv[], i: number, p: Uv): boolean {
  const a = poly[i], n = poly.length;
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    if (k === i || k2 === i) continue;
    if (segsCross(a, p, poly[k], poly[k2])) return false;
  }
  return inside(poly, (a[0] + p[0]) / 2, (a[1] + p[1]) / 2);
}
/** Splice each hole into the outer ring so one ear-clip covers islands. */
function bridgeHoles(outer: Uv[], holes: Uv[][]): Uv[] {
  let poly = outer.slice();
  const hs = holes.map((h) => h.slice()).sort((a, b) => Math.max(...b.map((p) => p[0])) - Math.max(...a.map((p) => p[0])));
  for (const hole of hs) {
    if (hole.length < 3) continue;
    let hi = 0;
    for (let i = 1; i < hole.length; i++) if (hole[i][0] > hole[hi][0]) hi = i;
    const hp = hole[hi];
    let best = -1, bestD = Infinity;
    const consider = (requireRight: boolean) => {
      for (let i = 0; i < poly.length; i++) {
        if (requireRight && poly[i][0] < hp[0] - 1e-9) continue;
        if (!visible(poly, i, hp)) continue;
        const d = Math.hypot(poly[i][0] - hp[0], poly[i][1] - hp[1]);
        if (d < bestD) { bestD = d; best = i; }
      }
    };
    consider(true); if (best < 0) consider(false);
    if (best < 0) continue;
    const seq: Uv[] = [];
    for (let k = 0; k <= hole.length; k++) seq.push(hole[(hi + k) % hole.length]);
    poly.splice(best + 1, 0, ...seq, poly[best]);
  }
  return poly;
}
function earClip(poly: Uv[]): Uv[][] {
  const pts = poly.map((p) => [p[0], p[1]] as Uv);
  const tris: Uv[][] = [];
  const ccw = signedArea(pts) >= 0;
  let guard = pts.length * pts.length + 4;
  while (pts.length > 3 && guard-- > 0) {
    let cut = false;
    for (let i = 0; i < pts.length; i++) {
      const n = pts.length;
      const prev = pts[(i + n - 1) % n], cur = pts[i], next = pts[(i + 1) % n];
      const cr = cross2(prev, cur, next);
      if (Math.abs(cr) <= 1e-12) {
        const dotp = (cur[0] - prev[0]) * (next[0] - prev[0]) + (cur[1] - prev[1]) * (next[1] - prev[1]);
        const len2 = (next[0] - prev[0]) ** 2 + (next[1] - prev[1]) ** 2;
        if (dotp >= -1e-8 && dotp <= len2 + 1e-8) { pts.splice(i, 1); cut = true; break; }
        continue;
      }
      if (ccw ? cr <= 1e-12 : cr >= -1e-12) continue;
      let ear = true;
      for (let j = 0; j < n; j++) {
        if (j === i || j === (i + n - 1) % n || j === (i + 1) % n) continue;
        if (nearUv(pts[j], prev) || nearUv(pts[j], cur) || nearUv(pts[j], next)) continue;
        if (pointInTri(prev, cur, next, pts[j]) || onSeg(prev, next, pts[j])) { ear = false; break; }
      }
      if (!ear) continue;
      tris.push([[prev[0], prev[1]], [cur[0], cur[1]], [next[0], next[1]]]);
      pts.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (pts.length === 3) tris.push([[pts[0][0], pts[0][1]], [pts[1][0], pts[1][1]], [pts[2][0], pts[2][1]]]);
  return tris;
}
function signedArea(p: Uv[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return a / 2;
}
function orient(loop: Uv[], ccw: boolean): Uv[] {
  const p = loop.slice();
  if (ccw ? signedArea(p) < 0 : signedArea(p) > 0) p.reverse();
  return p;
}
interface SurfV { s: number; t: number; p: Vec3 }
function chordSag(fit: FitResult, a: SurfV, b: SurfV): { sag: number; s: number; t: number; on: Vec3 } {
  const s = (a.s + b.s) / 2, t = (a.t + b.t) / 2, on = pointOf(fit, s, t);
  const mid = scale(add(a.p, b.p), 0.5);
  return { sag: norm(sub(on, mid)), s, t, on };
}
/** Split edges whose chord leaves the analytic surface, without moving the wire vertices. */
function refineSurface(fit: FitResult, uvTris: Uv[][], chord: number): { p: Vec3[]; tris: number[] } {
  const verts: SurfV[] = [];
  const idx: number[] = [];
  const keyOf = (s: number, t: number) => s.toFixed(6) + ',' + t.toFixed(6);
  const id = new Map<string, number>();
  const addV = (s: number, t: number) => {
    const k = keyOf(s, t); const hit = id.get(k); if (hit != null) return hit;
    const n = verts.length; verts.push({ s, t, p: pointOf(fit, s, t) }); id.set(k, n); return n;
  };
  for (const tr of uvTris) idx.push(addV(tr[0][0], tr[0][1]), addV(tr[1][0], tr[1][1]), addV(tr[2][0], tr[2][1]));
  if (fit.type === 'Ebene' || !Number.isFinite(chord)) return { p: verts.map((v) => v.p), tris: idx };
  let tris = idx;
  for (let pass = 0; pass < 8 && tris.length / 3 < 8000; pass++) {
    const edgeMid = new Map<string, number>();
    const next: number[] = [];
    let grew = false;
    const ek = (i: number, j: number) => (i < j ? i + ',' + j : j + ',' + i);
    const mid = (i: number, j: number) => {
      const k = ek(i, j); const hit = edgeMid.get(k); if (hit != null) return hit;
      const c = chordSag(fit, verts[i], verts[j]);
      if (c.sag <= chord) return -1;
      const n = verts.length; verts.push({ s: c.s, t: c.t, p: c.on }); edgeMid.set(k, n); grew = true; return n;
    };
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      if (ab < 0 && bc < 0 && ca < 0) { next.push(a, b, c); continue; }
      if (ab >= 0 && bc >= 0 && ca >= 0) { next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca); continue; }
      if (ab >= 0 && bc >= 0) { next.push(a, ab, c, ab, bc, c, ab, b, bc); continue; }
      if (bc >= 0 && ca >= 0) { next.push(b, bc, a, bc, ca, a, bc, c, ca); continue; }
      if (ca >= 0 && ab >= 0) { next.push(c, ca, b, ca, ab, b, ca, a, ab); continue; }
      if (ab >= 0) { next.push(a, ab, c, ab, b, c); continue; }
      if (bc >= 0) { next.push(b, bc, a, bc, c, a); continue; }
      next.push(c, ca, b, ca, a, b);
    }
    tris = next;
    if (!grew) break;
  }
  return { p: verts.map((v) => v.p), tris };
}

/**
 * Analytic face bounded by the true outer wire and its islands.
 * Triangle edges lie on those wires (a plane keeps the straight CAD edges; a curved
 * face is refined until each chord stays on the surface). This is not a grid of
 * cells kept by their centres — that fill stepped off the model curves.
 */
export function facePatch(fit: FitResult, loops: Vec3[][], div = 24): { tri: Float32Array; edges: Float32Array } | null {
  const clean = loops.filter((L) => L.length >= 3);
  if (!clean.length) return null;
  const chord = Math.max(0.05, 2 / Math.max(4, div));
  const uv = clean.map((L) => thinUv(fit, unwrap(fit, L), chord));
  if (uv[0].length < 3) return null;
  const outer = orient(uv[0], true);
  const holes = uv.slice(1).filter((h) => h.length >= 3).map((h) => orient(h, false));
  const raw = earClip(bridgeHoles(outer, holes)).filter((tr) => {
    const c: Uv = [(tr[0][0] + tr[1][0] + tr[2][0]) / 3, (tr[0][1] + tr[1][1] + tr[2][1]) / 3];
    return inside(outer, c[0], c[1]) && holes.every((h) => !inside(h, c[0], c[1]));
  });
  if (!raw.length) return null;
  const mesh = refineSurface(fit, raw, fit.type === 'Ebene' ? Infinity : chord);
  const tri: number[] = [];
  for (let i = 0; i < mesh.tris.length; i += 3) {
    const a = mesh.p[mesh.tris[i]], b = mesh.p[mesh.tris[i + 1]], c = mesh.p[mesh.tris[i + 2]];
    if (norm(cross(sub(b, a), sub(c, a))) < 1e-8) continue;
    tri.push(...a, ...b, ...c);
  }
  if (!tri.length) return null;
  const cnt = new Map<string, [number, number, number]>();
  for (let i = 0; i < mesh.tris.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = mesh.tris[i + k], b = mesh.tris[i + ((k + 1) % 3)];
    const key = a < b ? a + ',' + b : b + ',' + a;
    const e = cnt.get(key); if (e) e[2]++; else cnt.set(key, [a, b, 1]);
  }
  const edges: number[] = [];
  for (const [a, b, n] of cnt.values()) if (n === 1) edges.push(...mesh.p[a], ...mesh.p[b]);
  return { tri: new Float32Array(tri), edges: new Float32Array(edges) };
}
