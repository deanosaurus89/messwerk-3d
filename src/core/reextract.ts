// Re-extraction: the existing actual geometry is the start; scan points are re-collected inside a SEARCH REGION that is
// built from the geometry (not a bounding box), with the usual industry criteria (search distance, normal angle, outlier removal).
// ONE search region: ± search distance normal to the fitted surface/curve (also the band of 'All inside boundary'),
// laterally extended beyond the actual contour by the lateral extension (Advanced; default 0 = original contour).
// Regions:
//  plane (trimmed)  → prism over its contour (occupancy grid of the current points in the plane, + edge margin)
//  plane (no points, e.g. anchor) → rectangular box over the anchor points + margin
//  cylinder / cone  → hollow shell over the trimmed height (+ margin)
//  sphere           → spherical shell
//  circle / slot    → band along the curve (in-plane distance to the contour, over the current height + margin)
//  line             → tube along the line (over its extent + margin)
import { FitResult, GeomType, fitType, modelNormal, signedDistance } from './fit';
import { Vec3, basis, cross, dot, norm, scale, sub, unit } from './linalg';
import { fillOuterBoundary, insetPlane, rasterTris } from './fillplane';
import { fitInPlane } from './aux';
import { FrozenBoundary, frozenCells, frozenTester } from './frozen';

export interface ReexParams {
  /** search distance ± [mm]: normal thickness of the search region (and band for All inside boundary) */
  maxDist: number;
  /** outlier removal: exclude points beyond n × RMS (std. dev.) of the residuals; 0 = off (keep all) */
  sigma: number; maxAngleDeg: number;
  /** lateral extension beyond the actual contour [mm]; null/undefined = automatic (see lateralOf) */
  margin?: number | null; iterations?: number;
  /** planes: then capture all points inside the outer boundary within ± search distance */
  fill?: boolean;
  /** with fill: drop raised features (boss, sphere, step) as a whole */
  excludeRaised?: boolean;
  /** with fill: include detected islands inside the outer contour (default true) */
  islands?: boolean;
  /** planes: boundary exclusion distance [mm] (inset from the outer contour / openings / excluded islands) */
  inset?: number;
  /** normal angle criterion on/off (default on) */
  angleOn?: boolean;
  /** outlier removal on/off (default on); off = nothing removed regardless of sigma */
  sigmaOn?: boolean;
  /** user trims of the zone: lasso polygons in a stored view (keep inside / remove inside) */
  trims?: ZoneTrim[];
  /** 0.33: frozen boundary of a plane (set at creation) – the zone is exactly this boundary, offset by −inset */
  frozen?: FrozenBoundary | null;
  /** 0.35: the frozen point set itself (union of all regions after island edits, at creation) – exclusion 0 gives exactly it */
  frozenIdx?: Uint32Array | number[] | null;
  /** @deprecated pre-0.19 projects: separate band of All inside boundary (migrated by normReex) */
  fillBand?: number;
}
/** 0.39 (Martin): Suchabstand 1 mm als Standard für die Extraktion (Optionen › Extraktion) */
export const REEX_DEFAULT: ReexParams = { maxDist: 1, sigma: 3, maxAngleDeg: 30, margin: 0, iterations: 3 };
/** A fitted-geometry zone replaces the grown selection only when the refit still describes that surface.
 *  Form may rise a little (more of the same noisy face). A zone that runs onto a blend (sphere/torus) inflates it. */
export function zoneFitAcceptable(grownForm: number, zoneForm: number): boolean {
  if (!isFinite(zoneForm)) return false;
  const g = isFinite(grownForm) && grownForm > 0 ? grownForm : zoneForm;
  return zoneForm <= Math.max(0.1, g * 4);
}
/** default lateral extension: 0 – the zone follows the original contour exactly (no hidden margin) */
export const lateralAuto = (_p: { maxDist: number }) => 0;
export const lateralOf = (p: ReexParams) => (p.margin != null && isFinite(p.margin) ? p.margin : lateralAuto(p));
/** Migrate old parameter sets (max. distance + search margin + separate fill band) to the unified search region. */
export function normReex<T extends Partial<ReexParams>>(p: T): T & ReexParams {
  const q: any = { ...REEX_DEFAULT, ...p };
  if (p.fillBand != null) { if (p.fillBand > 0) { q.fill = true; q.maxDist = Math.max(q.maxDist, p.fillBand); } delete q.fillBand; }
  if (q.margin === undefined || q.margin === null) q.margin = 0;
  return q;
}
/** Lasso trim of the extraction zone: polygon in normalized device coordinates of a stored view matrix
 *  (projection × view, column-major). keep = only points inside survive; otherwise points inside are removed. */
export interface ZoneTrim { m: number[]; poly: [number, number][]; keep: boolean }
function inPoly(x: number, y: number, P: [number, number][]) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }
/** Does point q pass all trims? */
export function trimPass(trims: ZoneTrim[] | undefined, q: Vec3): boolean {
  if (!trims?.length) return true;
  for (const t of trims) { const m = t.m, w = m[3] * q[0] + m[7] * q[1] + m[11] * q[2] + m[15];
    const ins = w > 0 && inPoly((m[0] * q[0] + m[4] * q[1] + m[8] * q[2] + m[12]) / w, (m[1] * q[0] + m[5] * q[1] + m[9] * q[2] + m[13]) / w, t.poly);
    if (t.keep ? !ins : ins) return false; }
  return true;
}
export interface ReexResult { fit: FitResult; indices: Uint32Array; removedSigma: number; candidates: number; iterations: number; region: SearchRegion }

/** Geometry of the search region – also used for the transparent preview body. */
export type SearchRegion =
  | { kind: 'prism'; o: Vec3; n: Vec3; u: Vec3; v: Vec3; h: number; i0: number; j0: number; w: number; hgt: number; cells: Uint8Array; d: number }
  | { kind: 'box'; o: Vec3; n: Vec3; u: Vec3; v: Vec3; u0: number; u1: number; v0: number; v1: number; d: number }
  | { kind: 'shell'; type: 'Zylinder' | 'Kegel'; c: Vec3; a: Vec3; t0: number; t1: number; d: number; fit: FitResult }
  | { kind: 'sphere'; c: Vec3; r: number; d: number }
  | { kind: 'torus'; fit: FitResult; d: number }   // toroidal shell (tube radius ± d)
  | { kind: 'band'; type: 'Kreis' | 'Langloch'; fit: FitResult; t0: number; t1: number; d: number }
  | { kind: 'tube'; c: Vec3; a: Vec3; t0: number; t1: number; d: number };

const P3 = (pos: ArrayLike<number>, v: number): Vec3 => [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]];
const along = (pos: ArrayLike<number>, idx: ArrayLike<number>, c: Vec3, a: Vec3, extra: Vec3[]): [number, number] => {
  let t0 = Infinity, t1 = -Infinity; const f = (q: Vec3) => { const t = dot(sub(q, c), a); if (t < t0) t0 = t; if (t > t1) t1 = t; };
  for (let i = 0; i < idx.length; i++) f(P3(pos, idx[i])); extra.forEach(f); return [t0, t1];
};
/** in-plane distance from 2D point (x,y) to the slot contour (stadium, centre line along x, half length hl, radius r) */
const stadiumDist = (x: number, y: number, hl: number, r: number) => { const cx = Math.max(-hl, Math.min(hl, x)); return Math.hypot(x - cx, y) - r; };

export function buildRegion(fit: FitResult, pos: ArrayLike<number>, current: Uint32Array, p0: ReexParams, seedPts: Vec3[] = [], tris: ArrayLike<number> | null = null): SearchRegion {
  const p = normReex(p0);
  const d = p.maxDist, m = lateralOf(p), n = unit(fit.normal), c = fit.center;
  if (!current.length && !seedPts.length) throw new Error('No start points');
  switch (fit.type) {
    case 'Ebene': {
      if (p.frozen) { const F = p.frozen, g = frozenCells(F, m - (p.inset ?? 0)); return { kind: 'prism', o: F.o, n: F.n, u: F.u, v: F.v, ...g, d }; }
      const [u, v] = basis(n);
      if (current.length < 3) { // rectangular box over the anchor/start points
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (const q of seedPts) { const w = sub(q, c), a = dot(w, u), b = dot(w, v); u0 = Math.min(u0, a); u1 = Math.max(u1, a); v0 = Math.min(v0, b); v1 = Math.max(v1, b); }
        return { kind: 'box', o: c, n, u, v, u0: u0 - m, u1: u1 + m, v0: v0 - m, v1: v1 + m, d };
      }
      // zone = the original region itself: triangles of the current points rasterized onto a fine grid (exact contour,
      // holes stay open), then offset by (lateral extension − boundary exclusion distance): > 0 grows outward by a
      // constant distance (hence rounded corners), < 0 shrinks inward. Default 0 = exactly the original contour.
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity; const uv: number[] = [];
      for (let i = 0; i < current.length; i++) { const w = sub(P3(pos, current[i]), c), a = dot(w, u), b = dot(w, v); uv.push(a, b); a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
      const off = m - (p.inset ?? 0), area = Math.max(1e-6, (a1 - a0) * (b1 - b0));
      let h = tris ? Math.min(1, Math.max(0.05, 0.7 * Math.sqrt(area / current.length))) : Math.max(0.05, 1.5 * Math.sqrt(area / current.length));
      const ext = Math.max(0, off) + 2 * h;
      while (((a1 - a0 + 2 * ext) / h + 4) * ((b1 - b0 + 2 * ext) / h + 4) > 4e6) h *= 1.4;
      const pad = Math.ceil(Math.max(0, off) / h) + 2, i0 = Math.floor(a0 / h) - pad, j0 = Math.floor(b0 / h) - pad, W = Math.ceil(a1 / h) + pad - i0 + 1, H = Math.ceil(b1 / h) + pad - j0 + 1;
      let cells = new Uint8Array(W * H);
      for (let k = 0; k < uv.length; k += 2) cells[(Math.floor(uv[k + 1] / h) - j0) * W + (Math.floor(uv[k] / h) - i0)] = 1;
      if (tris) { const mk = new Uint8Array(pos.length / 3); for (let i = 0; i < current.length; i++) mk[current[i]] = 1;
        // rasterTris works in grid units with origin x0 = i0·h (margin M = 0)
        rasterTris(pos, tris, mk, c, u, v, i0 * h, j0 * h, h, 0, W, H, cells); }
      const dil = (src: Uint8Array, r: number) => { const out = new Uint8Array(src.length);
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (src[j * W + i]) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < W && jj < H && di * di + dj * dj <= r * r + 0.5) out[jj * W + ii] = 1; }
        return out; };
      if (!tris) cells = dil(cells, 1); // vertex occupancy only: close the 1-cell sampling gaps
      const r = Math.round(Math.abs(off) / h);
      if (off > 0 && r > 0) cells = dil(cells, r);
      else if (off < 0 && r > 0) { const inv = new Uint8Array(W * H); for (let k = 0; k < W * H; k++) inv[k] = cells[k] ? 0 : 1; const g = dil(inv, r); for (let k = 0; k < W * H; k++) cells[k] = cells[k] && !g[k] ? 1 : 0; }
      return { kind: 'prism', o: c, n, u, v, h, i0, j0, w: W, hgt: H, cells, d };
    }
    case 'Zylinder': case 'Kegel': { const [t0, t1] = along(pos, current, c, n, seedPts); return { kind: 'shell', type: fit.type, c, a: n, t0: t0 - m, t1: t1 + m, d, fit }; }
    case 'Kugel': return { kind: 'sphere', c, r: fit.radius!, d };
    case 'Torus': return { kind: 'torus', fit, d };
    case 'Kreis': case 'Langloch': { const [t0, t1] = along(pos, current, c, n, seedPts); return { kind: 'band', type: fit.type, fit, t0: t0 - m, t1: t1 + m, d }; }
    case 'Linie': { const a = unit(fit.direction ?? n), L = (fit.length || 0) / 2; const [t0, t1] = current.length ? along(pos, current, c, a, seedPts) : [-L, L]; return { kind: 'tube', c, a, t0: t0 - m, t1: t1 + m, d }; }
    default: throw new Error('Re-extraction not available for this type');
  }
}
export function inRegion(R: SearchRegion, q: Vec3): boolean {
  switch (R.kind) {
    case 'prism': { const w = sub(q, R.o); if (Math.abs(dot(w, R.n)) > R.d) return false; const i = Math.floor(dot(w, R.u) / R.h) - R.i0, j = Math.floor(dot(w, R.v) / R.h) - R.j0; return i >= 0 && j >= 0 && i < R.w && j < R.hgt && R.cells[j * R.w + i] === 1; }
    case 'box': { const w = sub(q, R.o), a = dot(w, R.u), b = dot(w, R.v); return Math.abs(dot(w, R.n)) <= R.d && a >= R.u0 && a <= R.u1 && b >= R.v0 && b <= R.v1; }
    case 'shell': { const t = dot(sub(q, R.c), R.a); return t >= R.t0 && t <= R.t1 && Math.abs(signedDistance(R.fit, q)) <= R.d; }
    case 'sphere': return Math.abs(norm(sub(q, R.c)) - R.r) <= R.d;
    case 'torus': return Math.abs(signedDistance(R.fit, q)) <= R.d;
    case 'band': { const f = R.fit, a = unit(f.normal), w = sub(q, f.center), t = dot(w, a); if (t < R.t0 || t > R.t1) return false;
      const r = sub(w, scale(a, t));
      if (R.type === 'Kreis') return Math.abs(norm(r) - f.radius!) <= R.d;
      const dx = unit(f.direction!), y = unit(cross(a, dx));
      return Math.abs(stadiumDist(dot(r, dx), dot(r, y), f.length! / 2 - f.radius!, f.radius!)) <= R.d; }
    case 'tube': { const w = sub(q, R.c), t = dot(w, R.a); return t >= R.t0 && t <= R.t1 && norm(sub(w, scale(R.a, t))) <= R.d; }
  }
}

export function reextract(fit0: FitResult, pos: ArrayLike<number>, nrm: ArrayLike<number> | null, current: Uint32Array, p0: ReexParams, seedPts: Vec3[] = [], tris: ArrayLike<number> | null = null, auxPlane: FitResult | null = null): ReexResult {
  // 0.32 fix: features with an aux plane (circle, slot, line) keep THEIR plane – the curve is fitted in it, never re-detected
  const inPl = auxPlane && (fit0.type === 'Kreis' || fit0.type === 'Langloch' || fit0.type === 'Linie') ? auxPlane : null;
  const fitT = (t: GeomType, Pp: Vec3[], Nn: Vec3[]): FitResult => !inPl ? fitType(t, Pp, Nn, false)
    : t === 'Linie' ? { ...fitType('Linie', Pp.map((q) => sub(q, scale(inPl.normal, dot(sub(q, inPl.center), inPl.normal)))), Nn, false) }
    : fitInPlane(t as 'Kreis' | 'Langloch', Pp, inPl, false);
  const p0f = fit0.type === 'Ebene' && p0.frozen ? { ...p0, fill: false } : p0; // frozen boundary: no inner/outer/island questions
  const p = normReex(p0f);
  const type = fit0.type as GeomType;
  // 0.38 (F11): the zone of a non-plane is always built from its creation point set (if known), never from the last
  // result – otherwise each re-extract with a lateral margin grew the zone again until it saturated
  const base = type !== 'Ebene' && p.frozenIdx && p.frozenIdx.length >= 3 ? Uint32Array.from(p.frozenIdx) : current;
  const R0 = buildRegion(fit0, pos, base, p, seedPts, tris);
  // planes: the zone already contains the boundary exclusion distance (inset > 0 shrinks, < 0 grows it). With All inside
  // boundary and a positive inset the candidates come from the full zone (so the raised-feature classification sees the
  // whole face); the inset is then applied by the fill (contour + openings) and the result clipped to the shown zone.
  const zoneInset = type === 'Ebene' && R0.kind === 'prism', fillInset = !!p.fill && type === 'Ebene' && (p.inset ?? 0) > 0 && zoneInset;
  const Rc = fillInset ? buildRegion(fit0, pos, base, { ...p, inset: 0 }, seedPts, tris) : R0;
  let dispR: SearchRegion = R0; // shown zone (with fill + inset: the zone of the final points)
  const cosA = p.angleOn === false ? -2 : Math.cos((p.maxAngleDeg * Math.PI) / 180), N = pos.length / 3, outl = p.sigmaOn !== false && p.sigma > 0;
  // candidates of the region (region fixed from the start geometry; the distance test is part of the region)
  // Plane zone not grown outward (lateral extension − exclusion ≤ 0): the zone is exactly the grown region, i.e. only the
  // region's own vertices (eroded by the exclusion distance). The raster alone is not exact on anisotropic scan meshes
  // (dense along scan lines, ~1 mm between them): an occupied cell also held not-grown neighbours, so the zone collected
  // ~27k instead of 14.7k points. Gap filling (All inside boundary) is unchanged – it fills from the contour separately.
  const offR = lateralOf(p) - (Rc === R0 ? (p.inset ?? 0) : 0);
  let own: Uint8Array | null = null;
  if (Rc.kind === 'prism' && tris && current.length >= 3 && offR <= 1e-9 && !p.frozen) { own = new Uint8Array(N); for (let i = 0; i < current.length; i++) own[current[i]] = 1; }
  // 0.38 (F11): non-planes with “Boundary from: Point selection” also keep their creation point set – before, the zone was
  // rebuilt from the LAST result, so every re-extract grew the set until it saturated.
  const fset = p.frozenIdx && p.frozenIdx.length >= 3 && lateralOf(p) <= 1e-9 && (type === 'Ebene' ? !!p.frozen : true) ? p.frozenIdx : null;
  const ft = p.frozen && type === 'Ebene' ? frozenTester(p.frozen, p.maxDist, lateralOf(p) - (p.inset ?? 0), !!fset) : null; // exact frozen boundary (no raster)
  const cands: number[] = [];
  if (fset) { for (const v of fset) { if (v >= N) continue; const q = P3(pos, v); if ((ft ? ft(q) : true) && trimPass(p.trims, q)) cands.push(v); } cands.sort((a, b) => a - b); } // 0.35: frozen point set
  else for (let v = 0; v < N; v++) { if (own && !own[v]) continue; const q = P3(pos, v); if ((ft ? ft(q) : inRegion(Rc, q)) && trimPass(p.trims, q)) cands.push(v); }
  let fit = fit0, idx = current, removed = 0, cand = 0, it = 0;
  for (it = 0; it < (p.iterations ?? 3); it++) {
    const sel: number[] = [];
    for (const v of cands) { const q = P3(pos, v); if (!fset && Math.abs(signedDistance(fit, q)) > p.maxDist) continue; // frozen point set at exclusion 0: keep every creation point
      if (nrm && cosA > -1) { const nn: Vec3 = [nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]]; if (Math.abs(dot(nn, modelNormal(fit, q))) < cosA) continue; } sel.push(v); }
    cand = sel.length; if (sel.length < 5) throw new Error('Too few points within the distance/angle criteria');
    const dv = sel.map((v) => signedDistance(fit, P3(pos, v)));
    const mu = dv.reduce((a, b) => a + b, 0) / dv.length, sd = Math.sqrt(dv.reduce((a, b) => a + (b - mu) ** 2, 0) / dv.length);
    const keep = outl ? sel.filter((_, i) => Math.abs(dv[i] - mu) <= p.sigma * sd || sd === 0) : sel; removed = sel.length - keep.length;
    const Pp: Vec3[] = keep.map((v) => P3(pos, v)), Nn: Vec3[] = nrm ? keep.map((v) => [nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]]) : [];
    const nf = fitT(type, Pp, Nn.length ? Nn : Pp.map(() => fit.normal));
    const nIdx = Uint32Array.from(keep); const same = nIdx.length === idx.length && nIdx.every((v, i) => v === idx[i]);
    fit = { ...nf, type }; idx = nIdx; if (same) break;
  }
  if (p.fill && type === 'Ebene') {
    // region from the re-extraction gives the outer contour; then all points inside it within the band (no σ/angle filter)
    const fr = fillOuterBoundary(pos, nrm, idx, fit, { band: p.maxDist, excludeRaised: !!p.excludeRaised, islands: p.islands !== false, inset: fillInset || !zoneInset ? Math.max(0, p.inset ?? 0) : 0 }, tris);
    if (p.trims?.length) fr.indices = Uint32Array.from(Array.from(fr.indices).filter((v) => trimPass(p.trims, P3(pos, v))));
    if (fillInset) { if (fr.indices.length < 5) throw new Error('Boundary exclusion distance removes all points'); dispR = buildRegion(fit, pos, fr.indices, { ...p, inset: 0, margin: 0 }, seedPts, tris); }
    const Pp: Vec3[] = Array.from(fr.indices, (v) => P3(pos, v)), Nn: Vec3[] = nrm ? Array.from(fr.indices, (v) => [nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]] as Vec3) : Pp.map(() => fit.normal);
    fit = { ...fitType(type, Pp, Nn, false), type }; idx = fr.indices; removed = 0;
  }
  else if (type === 'Ebene' && !zoneInset && (p.inset ?? 0) > 0) {
    idx = insetPlane(pos, idx, fit, p.inset!, tris); if (idx.length < 5) throw new Error('Boundary exclusion distance removes all points');
    const Pp: Vec3[] = Array.from(idx, (v) => P3(pos, v)), Nn: Vec3[] = nrm ? Array.from(idx, (v) => [nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]] as Vec3) : Pp.map(() => fit.normal);
    fit = { ...fitType(type, Pp, Nn, false), type };
  }
  return { fit, indices: idx, removedSigma: removed, candidates: cand, iterations: it + 1, region: dispR };
}
