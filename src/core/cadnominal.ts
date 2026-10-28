// Nominal (Soll) from a CAD face: analytic geometry under the pointer, and which component
// (Soll / Ist) a Feature Builder hit writes. Ist extraction from a nominal reuses re-extract:
// the nominal is the seed, scan points near it are collected and fitted. The scan and the CAD
// model must already share one coordinate system — this module does not align them.
import type { CadAnalytic, CadCurve } from '../cad/analytic';
import { FitResult, GeomType, canonical } from './fit';
import { Vec3, add, dot, norm, scale, sub, unit } from './linalg';
import { ReexParams, ReexResult, normReex, reextract } from './reextract';

export type { CadAnalytic, CadCurve };
/** Session choice. There is no Auto: Nominal and Measured are explicit and stick until changed. */
export type SideMode = 'soll' | 'ist';
export interface SideHit { cad: boolean; mesh: boolean; /** CAD surface is in front of the mesh (or the mesh was missed) */ cadCloser: boolean }

/** Nominal uses the CAD hit only. Measured uses the polygon hit only. The choice is not inferred from which surface is closer. */
export function creationSide(hit: SideHit, mode: SideMode): 'soll' | 'ist' | null {
  if (mode === 'soll') return hit.cad ? 'soll' : null;
  return hit.mesh ? 'ist' : null;
}
/** Ray distances (null = miss). Equal distance prefers the CAD surface. */
export function nearerTarget(cadDist: number | null, meshDist: number | null): 'cad' | 'mesh' | 'none' {
  if (cadDist == null && meshDist == null) return 'none';
  if (cadDist == null) return 'mesh';
  if (meshDist == null) return 'cad';
  return cadDist <= meshDist ? 'cad' : 'mesh';
}

const ZERO = { rms: 0, form: 0, maxPos: 0, maxNeg: 0, n: 0 };
const surfOf: Record<string, GeomType | 'Freiformfläche'> = {
  Ebene: 'Ebene', Zylinder: 'Zylinder', Kegel: 'Kegel', Kugel: 'Kugel', Torus: 'Torus', NURBS: 'Freiformfläche',
};

function distSeg(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a), ap = sub(p, a), L2 = dot(ab, ab) || 1;
  const t = Math.max(0, Math.min(1, dot(ap, ab) / L2));
  return norm(sub(ap, scale(ab, t)));
}
/** Distance from a point to a circle curve. */
export function distCircle(p: Vec3, c: Vec3, n: Vec3, r: number): number {
  const a = unit(n), w = sub(p, c), ax = dot(w, a), rad = sub(w, scale(a, ax));
  return Math.hypot(ax, norm(rad) - r);
}

export interface SlotGeom { center: Vec3; normal: Vec3; direction: Vec3; radius: number; length: number; width: number }

/** Stadium from two equal arcs and two parallel straight edges of one face (a slot contour). */
export function detectSlot(edges: CadCurve[]): SlotGeom | null {
  const lines = edges.filter((e) => e.kind === 'line' && e.a && e.b);
  const arcs = edges.filter((e) => e.kind === 'circle' && e.center && e.normal && e.radius != null);
  for (let i = 0; i < arcs.length; i++) for (let j = i + 1; j < arcs.length; j++) {
    const A = arcs[i], B = arcs[j];
    const r = (A.radius! + B.radius!) / 2;
    if (Math.abs(A.radius! - B.radius!) > Math.max(0.05, 0.02 * r)) continue;
    const n = unit(A.normal!);
    if (Math.abs(Math.abs(dot(n, unit(B.normal!))) - 1) > 0.04) continue;
    const d = sub(B.center!, A.center!);
    if (Math.abs(dot(d, n)) > Math.max(0.3, 0.02 * r)) continue;
    const sep = norm(sub(d, scale(n, dot(d, n))));
    if (sep < Math.max(0.5, 0.25 * r)) continue;
    const dir = unit(sub(d, scale(n, dot(d, n))));
    const parallel = lines.filter((L) => Math.abs(Math.abs(dot(unit(sub(L.b!, L.a!)), dir)) - 1) < 0.08);
    if (parallel.length < 2) continue;
    return { center: add(A.center!, scale(dir, sep / 2)), normal: n, direction: canonical(dir), radius: r, width: 2 * r, length: sep + 2 * r };
  }
  return null;
}
function slotDist(p: Vec3, s: SlotGeom): number {
  const n = unit(s.normal), w = sub(p, s.center), ax = dot(w, n), pl = sub(w, scale(n, ax));
  const x = dot(pl, unit(s.direction)), yv = sub(pl, scale(unit(s.direction), x));
  const h = Math.max(0, s.length / 2 - s.radius), cx = Math.max(-h, Math.min(h, x));
  return Math.hypot(ax, Math.hypot(x - cx, norm(yv)) - s.radius);
}

function planeFit(origin: Vec3, normal: Vec3, at: Vec3): FitResult {
  const n = unit(normal);
  const center = sub(at, scale(n, dot(sub(at, origin), n)));
  return { type: 'Ebene', center, normal: n, ...ZERO };
}
function circleFit(e: CadCurve): { fit: FitResult; aux: FitResult } {
  const n = unit(e.normal!);
  const fit: FitResult = { type: 'Kreis', center: e.center!, normal: n, radius: e.radius, diameter: 2 * e.radius!, ...ZERO };
  return { fit, aux: planeFit(e.center!, n, e.center!) };
}
function slotFit(s: SlotGeom): { fit: FitResult; aux: FitResult } {
  const fit: FitResult = { type: 'Langloch', center: s.center, normal: unit(s.normal), direction: s.direction, radius: s.radius, width: s.width, length: s.length, ...ZERO };
  return { fit, aux: planeFit(s.center, s.normal, s.center) };
}
function surfaceFit(face: CadAnalytic, at: Vec3): FitResult | null {
  const n = unit(face.normal);
  if (face.type === 'Ebene') return planeFit(face.origin, n, at);
  if (face.type === 'Zylinder' && face.radius != null) {
    const t0 = face.t0 ?? 0, t1 = face.t1 ?? t0, mid = (t0 + t1) / 2;
    // Keep the face axis. canonical() would flip a downward axis and drop the stored orientation.
    return { type: 'Zylinder', center: add(face.origin, scale(n, mid)), normal: n, radius: face.radius, diameter: 2 * face.radius, length: Math.abs(t1 - t0) || face.radius, ...ZERO };
  }
  if (face.type === 'Kegel' && face.halfAngle != null && face.apex) {
    const d = n, t0 = face.t0 ?? 0, t1 = face.t1 ?? 0, tm = (t0 + t1) / 2;
    const r = Math.abs(tm * Math.tan(face.halfAngle));
    return { type: 'Kegel', center: add(face.apex, scale(d, tm)), normal: d, apex: face.apex, halfAngle: face.halfAngle, radius: r, diameter: 2 * r, length: Math.abs(t1 - t0), ...ZERO };
  }
  if (face.type === 'Kugel' && face.radius != null) {
    const nn = norm(sub(at, face.origin)) > 1e-9 ? unit(sub(at, face.origin)) : n;
    return { type: 'Kugel', center: face.origin, normal: nn, radius: face.radius, diameter: 2 * face.radius, ...ZERO };
  }
  if (face.type === 'Torus' && face.radius != null && face.minor != null)
    return { type: 'Torus', center: face.origin, normal: n, radius: face.radius, diameter: 2 * face.radius, minorRadius: face.minor, ...ZERO };
  if (face.type === 'NURBS')
    return { type: 'Freiformfläche', center: face.origin, normal: n, ...ZERO };
  return null;
}

export interface NominalPick { fit: FitResult; aux?: FitResult; /** NURBS: fit is only a frame until the face samples are fitted */ freeform?: boolean }

function nearestLine(face: CadAnalytic, point: Vec3): { e: CadCurve | null; d: number } {
  const lines = face.edges.filter((e) => e.kind === 'line' && e.a && e.b);
  let e: CadCurve | null = null, d = Infinity;
  for (const L of lines) { const dd = distSeg(point, L.a!, L.b!); if (dd < d) { d = dd; e = L; } }
  return { e, d };
}
/**
 * Analytic nominal under a hit on a CAD face.
 * Smart Detect: an edge hit (within edgeTol) is a curve — slot, circle or line.
 * A face hit is the surface, including freeform. Polyline is only the explicit Polyline type:
 * line segments joined while they stay tangent (G1), stopping at a corner.
 * An explicit type uses that geometry when the face has it.
 */
export function nominalFromCad(face: CadAnalytic, point: Vec3, want: GeomType | 'auto', edgeTol: number): NominalPick | null {
  if (want === 'Linienzug') return nominalPolyline(face, point, edgeTol);
  const circles = face.edges.filter((e) => e.kind === 'circle' && e.center && e.normal && e.radius != null);
  let best: CadCurve | null = null, bestD = Infinity;
  for (const e of circles) { const d = distCircle(point, e.center!, e.normal!, e.radius!); if (d < bestD) { bestD = d; best = e; } }
  const slot = detectSlot(face.edges);
  const slotD = slot ? slotDist(point, slot) : Infinity;
  const surf = surfaceFit(face, point);
  const seamOnly = face.type === 'Kugel' || face.type === 'Torus';
  const line = nearestLine(face, point);
  if (want === 'auto') {
    const edge = !seamOnly && ((slot && slotD <= edgeTol) || (best && bestD <= edgeTol) || (line.e && line.d <= edgeTol));
    if (edge) {
      if (slot && slotD <= edgeTol && slotD <= bestD + 1e-6 && slotD <= line.d + 1e-6) return slotFit(slot);
      if (best && bestD <= edgeTol && bestD <= line.d + 1e-6) return circleFit(best);
      if (line.e && line.d <= edgeTol) return lineFit(line.e);
      return null;
    }
    if (!surf) return null;
    if (surf.type === 'Freiformfläche') return { fit: surf, freeform: true };
    return { fit: surf };
  }
  if (want === 'Kreis') return best ? circleFit(best) : null;
  if (want === 'Langloch') return slot ? slotFit(slot) : null;
  if (want === 'Freiformfläche') return surf ? { fit: { ...surf, type: 'Freiformfläche' }, freeform: face.type === 'NURBS' || surf.type !== 'Freiformfläche' } : null;
  if (surf && surf.type === want) return { fit: surf };
  if (want === 'Linie') {
    const lines = face.edges.filter((e) => e.kind === 'line' && e.a && e.b);
    let L: CadCurve | null = null, ld = Infinity;
    for (const e of lines) { const d = distSeg(point, e.a!, e.b!); if (d < ld) { ld = d; L = e; } }
    return L && ld <= edgeTol ? lineFit(L) : null;
  }
  return null;
}
/** Polyline along CAD edges: the hit segment, extended through tangent (G1) joints, stopped at a corner. */
export function nominalPolyline(face: CadAnalytic, point: Vec3, edgeTol: number): NominalPick | null {
  const lines = face.edges.filter((e) => e.kind === 'line' && e.a && e.b);
  let seedI = -1, bd = Infinity;
  for (let i = 0; i < lines.length; i++) { const d = distSeg(point, lines[i].a!, lines[i].b!); if (d < bd) { bd = d; seedI = i; } }
  if (seedI < 0 || bd > edgeTol) return null;
  const ang = Math.cos((12 * Math.PI) / 180);
  const tol = Math.max(0.05, 0.002 * (lines[seedI].length || 1));
  const same = (p: Vec3, q: Vec3) => norm(sub(p, q)) < tol;
  /** Next segment leaving `from` along `dir` (away from the chain). Returns the far point. */
  const step = (from: Vec3, dir: Vec3, used: Set<number>): Vec3 | null => {
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue;
      const e = lines[i], d = unit(sub(e.b!, e.a!));
      if (same(e.a!, from) && dot(d, dir) >= ang) { used.add(i); return e.b!; }
      if (same(e.b!, from) && dot(scale(d, -1), dir) >= ang) { used.add(i); return e.a!; }
    }
    return null;
  };
  const used = new Set<number>([seedI]);
  const seed = lines[seedI];
  const fwd: Vec3[] = [seed.b!];
  let from = seed.b!, dir = unit(sub(seed.b!, seed.a!));
  for (;;) { const n = step(from, dir, used); if (!n) break; dir = unit(sub(n, from)); from = n; fwd.push(n); }
  const back: Vec3[] = [seed.a!];
  from = seed.a!; dir = unit(sub(seed.a!, seed.b!));
  for (;;) { const n = step(from, dir, used); if (!n) break; dir = unit(sub(n, from)); from = n; back.push(n); }
  const pts = [...back.reverse(), ...fwd];
  const center = pts.reduce((s, q) => add(s, q), [0, 0, 0] as Vec3).map((v) => v / pts.length) as Vec3;
  const span = norm(sub(pts[pts.length - 1], pts[0]));
  return { fit: { type: 'Linienzug', center, normal: unit(face.normal), direction: span > 1e-9 ? unit(sub(pts[pts.length - 1], pts[0])) : [1, 0, 0], pts, length: span, ...ZERO } };
}
function lineFit(e: CadCurve): NominalPick {
  const a = e.a!, b = e.b!, d = unit(sub(b, a));
  const center = add(a, scale(d, norm(sub(b, a)) / 2));
  const dir = unit(d);
  const n = faceNormalForLine(e);
  return { fit: { type: 'Linie', center, normal: dir, direction: dir, length: norm(sub(b, a)), ...ZERO }, aux: { type: 'Ebene', center, normal: n, ...ZERO } };
}
function faceNormalForLine(e: CadCurve): Vec3 {
  const d = unit(sub(e.b!, e.a!));
  const up: Vec3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  return unit([d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]]);
}

/** Search parameters for an extraction whose seed is the nominal, not a previous measured fit. */
export function nominalReexParams(fit: FitResult, maxDist = 1): ReexParams {
  const curve = fit.type === 'Kreis' || fit.type === 'Langloch' || fit.type === 'Linie';
  return normReex({
    maxDist, sigma: 3, sigmaOn: false, maxAngleDeg: 35, angleOn: true,
    margin: curve ? maxDist : 0, iterations: 3, fill: false, pointBound: false, frozen: null, frozenIdx: null,
  });
}
/**
 * Ist from a CAD nominal: same search region + fit as re-extract, seeded by the nominal
 * (and optional CAD face samples). Throws a clear error when the scan has nothing near the nominal.
 */
export function extractFromNominal(fit: FitResult, seed: Vec3[], pos: ArrayLike<number>, nrm: ArrayLike<number> | null, tris: ArrayLike<number> | null = null, aux: FitResult | null = null, maxDist = 1): ReexResult {
  const seedPts = seed.length ? seed : [fit.center];
  try {
    return reextract(fit, pos, nrm, new Uint32Array(0), nominalReexParams(fit, maxDist), seedPts, tris, aux);
  } catch (e: any) {
    const m = String(e?.message ?? e);
    if (m.includes('Too few points')) throw new Error('Too few scan points near the nominal. Align the scan to the CAD model first (same coordinate system). This prototype does not run an alignment.');
    throw e;
  }
}

export function samplePositions(positions: ArrayLike<number>, max = 240): Vec3[] {
  const n = Math.floor(positions.length / 3); if (!n) return [];
  const step = Math.max(1, Math.ceil(n / max)); const out: Vec3[] = [];
  for (let i = 0; i < n; i += step) out.push([positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]]);
  return out;
}

/** Face type the nominal classifier expects for an explicit ribbon type (for status text). */
export const CAD_SURFACE: Record<string, string> = surfOf;
