// Ausgleichsrechnung (kleinste Quadrate) für Regelgeometrien + automatische Typwahl.
import { Vec3, add, basis, cross, dot, eigSym3, levenbergMarquardt, norm, scale, sub, unit } from './linalg';

export type GeomType = 'Ebene' | 'Kreis' | 'Zylinder' | 'Langloch' | 'Kegel' | 'Kugel' | 'Punkt' | 'Abstand';
export const GEOM_TYPES: GeomType[] = ['Ebene', 'Kreis', 'Zylinder', 'Langloch', 'Kegel', 'Kugel', 'Punkt'];

/** Gemessene (Ist-)Geometrie. */
export interface FitResult {
  type: GeomType;
  center: Vec3;          // Mittelpunkt XYZ
  normal: Vec3;          // Orientierung IJK (Ebenennormale bzw. Achse)
  radius?: number;
  diameter?: number;
  length?: number;       // Langloch-Länge bzw. Zylinder/Kegel-Höhe
  width?: number;        // Langloch-Breite
  direction?: Vec3;      // Langloch-Längsrichtung
  halfAngle?: number;    // Kegel, rad
  apex?: Vec3;
  rms: number;           // Standardabweichung der orth. Abstände
  form: number;          // Formabweichung max-min
  maxPos: number;        // größte positive Abweichung (außerhalb Material bzw. vom Mittel weg)
  maxNeg: number;        // größte negative Abweichung
  n: number;             // Anzahl verwendeter Punkte
  outliers?: number;     // vom robusten Fit verworfene Punkte
  // nur Abstand
  distance?: number;
  delta?: Vec3;          // p2 - p1
  p1?: Vec3; p2?: Vec3;
  rule?: string;
  residuals?: Float64Array;
}

const stats = (res: Float64Array) => {
  let s = 0, mn = Infinity, mx = -Infinity;
  for (const r of res) { s += r * r; if (r < mn) mn = r; if (r > mx) mx = r; }
  const k = res.length > 0;
  return { rms: k ? Math.sqrt(s / res.length) : 0, form: k ? mx - mn : 0, maxPos: k ? mx : 0, maxNeg: k ? mn : 0, n: res.length };
};

export function centroid(p: Vec3[]): Vec3 {
  let x = 0, y = 0, z = 0;
  for (const q of p) { x += q[0]; y += q[1]; z += q[2]; }
  return [x / p.length, y / p.length, z / p.length];
}

function scatter(p: Vec3[], c: Vec3 = [0, 0, 0]): number[][] {
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const q of p) {
    const d = [q[0] - c[0], q[1] - c[1], q[2] - c[2]];
    for (let i = 0; i < 3; i++) for (let j = i; j < 3; j++) m[i][j] += d[i] * d[j];
  }
  m[1][0] = m[0][1]; m[2][0] = m[0][2]; m[2][1] = m[1][2];
  return m;
}

// ---------------------------------------------------------------- Ebene
export function fitPlane(p: Vec3[], normalHint?: Vec3): FitResult {
  if (p.length < 3) throw new Error('Ebene: mindestens 3 Punkte');
  const c = centroid(p);
  let n = eigSym3(scatter(p, c)).vectors[0];
  if (normalHint && dot(n, normalHint) < 0) n = scale(n, -1);
  const res = new Float64Array(p.length);
  p.forEach((q, i) => (res[i] = dot(sub(q, c), n)));
  return { type: 'Ebene', center: c, normal: n, residuals: res, ...stats(res) };
}

// ---------------------------------------------------------------- Kreis 2D
export function fitCircle2D(xy: [number, number][]): { cx: number; cy: number; r: number } {
  // algebraischer Startwert (Kasa)
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sz = 0, sxz = 0, syz = 0;
  const n = xy.length;
  for (const [x, y] of xy) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sz += z; sxz += x * z; syz += y * z;
  }
  const A = [[4 * sxx, 4 * sxy, 2 * sx], [4 * sxy, 4 * syy, 2 * sy], [2 * sx, 2 * sy, n]];
  const b = [2 * sxz, 2 * syz, sz];
  const M = A.map((r) => r.slice());
  const s = solveSmall(M, b.slice()) ?? [0, 0, 0];
  const cx0 = s[0], cy0 = s[1], r0 = Math.sqrt(Math.max(s[2] + cx0 * cx0 + cy0 * cy0, 1e-12));
  const out = levenbergMarquardt((q, o) => {
    for (let i = 0; i < n; i++) o[i] = Math.hypot(xy[i][0] - q[0], xy[i][1] - q[1]) - q[2];
  }, [cx0, cy0, r0], n);
  return { cx: out.x[0], cy: out.x[1], r: Math.abs(out.x[2]) };
}

function solveSmall(A: number[][], b: number[]) {
  // kleine Hilfsfunktion (Cramer-frei), nutzt Gauß aus linalg indirekt
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    if (Math.abs(A[p][i]) < 1e-300) return null;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let r = i + 1; r < n; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / A[i][i]; }
  return x;
}

/** Kreis im Raum: Punkte in Ebene ⟂ normal projizieren, 2D-Kreis fitten. */
export function fitCircle3D(p: Vec3[], normal?: Vec3): FitResult {
  if (p.length < 3) throw new Error('Kreis: mindestens 3 Punkte');
  const n = normal ? unit(normal) : fitPlane(p).normal;
  const c = centroid(p);
  const [u, v] = basis(n);
  const xy = p.map((q) => { const d = sub(q, c); return [dot(d, u), dot(d, v)] as [number, number]; });
  const k = fitCircle2D(xy);
  const center = add(c, add(scale(u, k.cx), scale(v, k.cy)));
  const res = new Float64Array(p.length);
  xy.forEach((q, i) => (res[i] = Math.hypot(q[0] - k.cx, q[1] - k.cy) - k.r));
  return { type: 'Kreis', center, normal: n, radius: k.r, diameter: 2 * k.r, residuals: res, ...stats(res) };
}

// ---------------------------------------------------------------- Kugel
export function fitSphere(p: Vec3[]): FitResult {
  if (p.length < 4) throw new Error('Kugel: mindestens 4 Punkte');
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], b = [0, 0, 0, 0];
  for (const q of p) {
    const row = [2 * q[0], 2 * q[1], 2 * q[2], 1], z = dot(q, q);
    for (let i = 0; i < 4; i++) { b[i] += row[i] * z; for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j]; }
  }
  const s = solveSmall(A, b) ?? [0, 0, 0, 1];
  const c0: Vec3 = [s[0], s[1], s[2]];
  const r0 = Math.sqrt(Math.max(s[3] + dot(c0, c0), 1e-12));
  const f = (x: number[], o: Float64Array) => {
    for (let i = 0; i < p.length; i++) o[i] = Math.hypot(p[i][0] - x[0], p[i][1] - x[1], p[i][2] - x[2]) - x[3];
  };
  const out = levenbergMarquardt(f, [...c0, r0], p.length);
  const res = new Float64Array(p.length); f(out.x, res);
  const center: Vec3 = [out.x[0], out.x[1], out.x[2]];
  const r = Math.abs(out.x[3]);
  // Orientierung: Richtung von Kugelmitte zum Punktschwerpunkt (Kalotte)
  const nrm = unit(sub(centroid(p), center));
  return { type: 'Kugel', center, normal: norm(nrm) > 0 ? nrm : [0, 0, 1], radius: r, diameter: 2 * r, residuals: res, ...stats(res) };
}

// ------------------------------------------------- Achse aus Normalen (Prismen/Rotationskörper)
/** Achsschätzung aus Flächennormalen: Normalen eines Zylinders/Langlochs stehen ⟂ zur Achse,
 *  beim Kegel haben sie einen konstanten Winkel zur Achse -> kleinster Eigenvektor der
 *  (zentrierten) Normalen-Streumatrix. */
export function axisFromNormals(nrm: Vec3[], centered = false): { axis: Vec3; ratio: number } {
  const c = centered ? centroid(nrm) : ([0, 0, 0] as Vec3);
  const e = eigSym3(scatter(nrm, c));
  return { axis: e.vectors[0], ratio: e.values[0] / Math.max(e.values[2], 1e-300) };
}

function tiltAxis(d0: Vec3, a: number, b: number): Vec3 {
  const [u, v] = basis(d0);
  return unit(add(d0, add(scale(u, a), scale(v, b))));
}

// ---------------------------------------------------------------- Zylinder
export function fitCylinder(p: Vec3[], axisHint: Vec3): FitResult {
  if (p.length < 5) throw new Error('Zylinder: mindestens 5 Punkte');
  const d0 = unit(axisHint);
  const c0 = centroid(p);
  const [u, v] = basis(d0);
  const xy = p.map((q) => { const d = sub(q, c0); return [dot(d, u), dot(d, v)] as [number, number]; });
  const k = fitCircle2D(xy);
  const f = (x: number[], o: Float64Array) => {
    const d = tiltAxis(d0, x[0], x[1]);
    const c = add(c0, add(scale(u, x[2]), scale(v, x[3])));
    for (let i = 0; i < p.length; i++) {
      const w = sub(p[i], c); const t = dot(w, d);
      o[i] = Math.hypot(w[0] - t * d[0], w[1] - t * d[1], w[2] - t * d[2]) - x[4];
    }
  };
  const out = levenbergMarquardt(f, [0, 0, k.cx, k.cy, k.r], p.length);
  const x = out.x;
  const d = tiltAxis(d0, x[0], x[1]);
  const c = add(c0, add(scale(u, x[2]), scale(v, x[3])));
  let tmin = Infinity, tmax = -Infinity;
  for (const q of p) { const t = dot(sub(q, c), d); tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); }
  const center = add(c, scale(d, 0.5 * (tmin + tmax)));
  const res = new Float64Array(p.length); f(x, res);
  const r = Math.abs(x[4]);
  return { type: 'Zylinder', center, normal: canonical(d), radius: r, diameter: 2 * r, length: tmax - tmin, residuals: res, ...stats(res) };
}

/** Achsrichtung eindeutig machen (größte Komponente positiv bzw. +Z bevorzugt). */
export function canonical(d: Vec3): Vec3 {
  const i = [0, 1, 2].reduce((a, b) => (Math.abs(d[b]) > Math.abs(d[a]) + 1e-9 ? b : a), 2);
  return d[i] < 0 ? scale(d, -1) : d;
}

// ---------------------------------------------------------------- Kegel
export function fitCone(p: Vec3[], nrm: Vec3[]): FitResult {
  if (p.length < 6) throw new Error('Kegel: mindestens 6 Punkte');
  let d0 = axisFromNormals(nrm, true).axis;
  // Spitze: n_i·(p_i - A) = 0  ->  (Σ n nᵀ) A = Σ n nᵀ p
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  nrm.forEach((n, i) => {
    const np = dot(n, p[i]);
    for (let r = 0; r < 3; r++) { b[r] += n[r] * np; for (let c = 0; c < 3; c++) M[r][c] += n[r] * n[c]; }
  });
  const a = solveSmall(M, b);
  let apex0: Vec3 = a ? [a[0], a[1], a[2]] : centroid(p);
  const cp = centroid(p);
  if (dot(sub(cp, apex0), d0) < 0) d0 = scale(d0, -1);
  // halber Öffnungswinkel aus Punkten
  let sa = 0;
  for (const q of p) { const w = sub(q, apex0); const t = dot(w, d0); sa += Math.atan2(norm(sub(w, scale(d0, t))), t); }
  const alpha0 = sa / p.length;
  const sc = Math.max(norm(sub(cp, apex0)), 1e-6);
  const f = (x: number[], o: Float64Array) => {
    const d = tiltAxis(d0, x[0], x[1]);
    const ap: Vec3 = [apex0[0] + x[2] * sc, apex0[1] + x[3] * sc, apex0[2] + x[4] * sc];
    const ca = Math.cos(x[5]), sn = Math.sin(x[5]);
    for (let i = 0; i < p.length; i++) {
      const w = sub(p[i], ap); const t = dot(w, d);
      const rad = Math.hypot(w[0] - t * d[0], w[1] - t * d[1], w[2] - t * d[2]);
      o[i] = rad * ca - t * sn;
    }
  };
  const out = levenbergMarquardt(f, [0, 0, 0, 0, 0, alpha0], p.length);
  const x = out.x;
  const d = tiltAxis(d0, x[0], x[1]);
  const apex: Vec3 = [apex0[0] + x[2] * sc, apex0[1] + x[3] * sc, apex0[2] + x[4] * sc];
  let tmin = Infinity, tmax = -Infinity;
  for (const q of p) { const t = dot(sub(q, apex), d); tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); }
  const tm = 0.5 * (tmin + tmax), ha = Math.abs(x[5]);
  const res = new Float64Array(p.length); f(x, res);
  const r = tm * Math.tan(ha);
  return { type: 'Kegel', center: add(apex, scale(d, tm)), normal: d, apex, halfAngle: ha, radius: r, diameter: 2 * r, length: tmax - tmin, residuals: res, ...stats(res) };
}

// ---------------------------------------------------------------- Langloch
function stadium(x: number, y: number, cx: number, cy: number, th: number, h: number, r: number) {
  const c = Math.cos(th), s = Math.sin(th);
  const lx = (x - cx) * c + (y - cy) * s, ly = -(x - cx) * s + (y - cy) * c;
  const lc = Math.max(-h, Math.min(h, lx));
  return Math.hypot(lx - lc, ly) - r;
}

/** Langloch: Wandpunkte in Ebene ⟂ Achse projizieren, Stadion-Kontur fitten.
 *  Länge = Gesamtlänge inkl. Radien, Breite = 2r. */
export function fitSlot(p: Vec3[], axis: Vec3): FitResult {
  if (p.length < 8) throw new Error('Langloch: mindestens 8 Punkte');
  const n = canonical(unit(axis));
  const c0 = centroid(p);
  const [u, v] = basis(n);
  const xy = p.map((q) => { const d = sub(q, c0); return [dot(d, u), dot(d, v)] as [number, number]; });
  // Startwerte aus 2D-Hauptachsen
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of xy) { sxx += x * x; syy += y * y; sxy += x * y; }
  const th0 = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let lmax = 0, wmax = 0;
  for (const [x, y] of xy) {
    lmax = Math.max(lmax, Math.abs(x * Math.cos(th0) + y * Math.sin(th0)));
    wmax = Math.max(wmax, Math.abs(-x * Math.sin(th0) + y * Math.cos(th0)));
  }
  const f = (q: number[], o: Float64Array) => {
    for (let i = 0; i < xy.length; i++) o[i] = stadium(xy[i][0], xy[i][1], q[0], q[1], q[2], Math.abs(q[3]), q[4]);
  };
  const out = levenbergMarquardt(f, [0, 0, th0, Math.max(lmax - wmax, 1e-3), wmax], p.length, { maxIter: 200 });
  const q = out.x;
  const res = new Float64Array(p.length); f(q, res);
  const dir = unit(add(scale(u, Math.cos(q[2])), scale(v, Math.sin(q[2]))));
  let tmin = Infinity, tmax = -Infinity;
  for (const pt of p) { const t = dot(sub(pt, c0), n); tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); }
  const center = add(c0, add(add(scale(u, q[0]), scale(v, q[1])), scale(n, 0.5 * (tmin + tmax))));
  const r = Math.abs(q[4]), h = Math.abs(q[3]);
  return { type: 'Langloch', center, normal: n, direction: canonical(dir), radius: r, width: 2 * r, length: 2 * h + 2 * r, residuals: res, ...stats(res) };
}

// ---------------------------------------------------------------- Punkt
export function fitPoint(p: Vec3[], nrm?: Vec3[]): FitResult {
  const c = centroid(p);
  const n = nrm && nrm.length ? unit(centroid(nrm)) : ([0, 0, 1] as Vec3);
  const res = new Float64Array(p.length);
  p.forEach((q, i) => (res[i] = dot(sub(q, c), n)));
  return { type: 'Punkt', center: c, normal: n, residuals: res, ...stats(res) };
}

// ---------------------------------------------------------------- Robust + Auto
function robust(fit: (p: Vec3[], n: Vec3[]) => FitResult, p: Vec3[], n: Vec3[], k = 3): FitResult {
  // Iterativ: Fit, Ausreißer > k·σ (σ robust aus MAD) entfernen, neu fitten – bis stabil (max. 3 Runden).
  let r = fit(p, n), P = p, N = n;
  for (let iter = 0; iter < 3; iter++) {
    const res = r.residuals!;
    const abs = Array.from(res, Math.abs).sort((a, b) => a - b);
    const sigma = 1.4826 * abs[Math.floor(abs.length / 2)];
    const thr = Math.max(k * sigma, 1e-9);
    const keep: number[] = [];
    res.forEach((v, i) => { if (Math.abs(v) <= thr) keep.push(i); });
    if (keep.length === P.length || keep.length < 10) break;
    P = keep.map((i) => P[i]); N = N.length ? keep.map((i) => N[i]) : N;
    r = fit(P, N);
  }
  r.outliers = p.length - P.length;
  return r;
}

export function fitType(type: GeomType, p: Vec3[], n: Vec3[], robustFit = true): FitResult {
  const run = (pp: Vec3[], nn: Vec3[]): FitResult => {
    switch (type) {
      case 'Ebene': return fitPlane(pp, nn.length ? centroid(nn) : undefined);
      case 'Kugel': return fitSphere(pp);
      case 'Zylinder': return fitCylinder(pp, axisFromNormals(nn).axis);
      case 'Kreis': {
        const cyl = fitCylinder(pp, axisFromNormals(nn).axis);
        const c = fitCircle3D(pp, cyl.normal);
        // Mittelpunkt auf die Zylinderachse (Mitte des erfassten Bereichs) legen
        const t = dot(sub(cyl.center, c.center), cyl.normal);
        return { ...c, center: add(c.center, scale(cyl.normal, t)), normal: cyl.normal };
      }
      case 'Langloch': return fitSlot(pp, axisFromNormals(nn).axis);
      case 'Kegel': return fitCone(pp, nn);
      case 'Punkt': return fitPoint(pp, nn);
      default: throw new Error('Typ nicht fitbar: ' + type);
    }
  };
  return robustFit && type !== 'Punkt' ? robust(run, p, n) : run(p, n);
}

/** Automatische Erkennung: alle plausiblen Typen fitten, einfachsten Typ wählen,
 *  dessen RMS nahe am besten liegt (Modellauswahl mit Komplexitätsreihenfolge). */
export function autoFit(p: Vec3[], n: Vec3[]): { best: FitResult; candidates: FitResult[] } {
  const ext = extent(p);
  const cands: FitResult[] = [];
  const tryFit = (t: GeomType) => { try { cands.push(fitType(t, p, n)); } catch { /* ignorieren */ } };
  tryFit('Ebene');
  // Ebene: wenn (fast) alle Normalen innerhalb 3° um die Ebenennormale liegen, sofort akzeptieren
  if (cands[0] && n.length) {
    const pn = cands[0].normal; let inside = 0;
    for (const q of n) if (Math.abs(dot(q, pn)) > Math.cos(3 * Math.PI / 180)) inside++;
    if (inside > 0.95 * n.length) return { best: cands[0], candidates: cands };
  }
  const nAx = axisFromNormals(n);
  const nCen = axisFromNormals(n, true);
  tryFit('Kugel'); tryFit('Zylinder'); tryFit('Kegel');
  if (nAx.ratio < 0.05) tryFit('Langloch');
  const valid = cands.filter((c) => {
    if (!isFinite(c.rms)) return false;
    if (c.type === 'Kugel' || c.type === 'Zylinder') return (c.radius ?? 0) < 3 * ext;
    if (c.type === 'Kegel') return (c.halfAngle ?? 0) > 0.035 && (c.halfAngle ?? 0) < 1.4 && nCen.ratio < 0.2;
    if (c.type === 'Langloch') return (c.length ?? 0) - (c.width ?? 0) > 0.2 * (c.width ?? 0) && (c.width ?? 0) < 3 * ext;
    return true;
  });
  const order: GeomType[] = ['Ebene', 'Kugel', 'Zylinder', 'Langloch', 'Kegel'];
  valid.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  const minRms = Math.min(...valid.map((c) => c.rms));
  let best = valid.find((c) => c.rms <= 1.3 * minRms + 1e-4 * ext) ?? valid[0];
  // kurzer Zylinder (Kante/Bohrungsrand) -> Kreis
  if (best.type === 'Zylinder' && (best.length ?? 0) < 0.25 * (best.diameter ?? 0)) {
    try { best = fitType('Kreis', p, n); } catch { /* bleibt Zylinder */ }
  }
  return { best, candidates: cands };
}

function extent(p: Vec3[]) {
  const mn: Vec3 = [Infinity, Infinity, Infinity], mx: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const q of p) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], q[i]); mx[i] = Math.max(mx[i], q[i]); }
  return norm(sub(mx, mn));
}

export { cross };
