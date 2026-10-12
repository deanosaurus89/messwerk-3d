// Freiformfläche: B-Spline-Flächenrückführung (Tensorprodukt, nicht-rational = NURBS mit Gewicht 1).
// Ablauf: Randschleife der Auswahl → Ecken (vierseitig) bzw. getrimmtes Patch → Parametrisierung (Projektion auf
// Ausgleichsrechteck) → LSQ mit Glättung (P-Spline, 2. Differenzen) → Parameterkorrektur (Fußpunkte) → Abweichungen.
import { Vec3, add, cross, dot, eigSym3, norm, scale, sub, unit } from './linalg';

export interface BSplineSurface { degU: number; degV: number; nu: number; nv: number; ku: number[]; kv: number[]; ctrl: number[]; }
export interface BSplineCurve { deg: number; n: number; knots: number[]; ctrl: number[]; }
export interface NurbsParams { nu: number; nv: number; deg: number; smooth: number; iterations?: number; }
export interface NurbsFit {
  surface: BSplineSurface;
  frame: { o: Vec3; e1: Vec3; e2: Vec3; n: Vec3; su: number; sv: number; u0: number; v0: number };
  kind: 'vierseitig' | 'getrimmt';
  corners: Vec3[];                 // 4 Ecken (vierseitig)
  boundary: BSplineCurve[];        // Randkurven (4 bzw. 1 geschlossene)
  trimUV: number[];                // Trimmschleife im Parameterraum (u,v,…) – nur getrimmt
  dev: Float32Array;               // vorzeichenbehaftete Normalabweichung je Punkt
  uv: Float32Array;
  rms: number; std: number; mean: number; maxPos: number; maxNeg: number; form: number; n: number;
}

// ---------------------------------------------------------------- B-Spline-Grundlagen
export function clampedKnots(n: number, p: number): number[] {
  const k: number[] = []; const m = n - p; // Anzahl Segmente
  for (let i = 0; i <= p; i++) k.push(0);
  for (let i = 1; i < m; i++) k.push(i / m);
  for (let i = 0; i <= p; i++) k.push(1);
  return k;
}
export function findSpan(n: number, p: number, u: number, U: number[]): number {
  if (u >= U[n]) return n - 1;
  if (u <= U[p]) return p;
  let lo = p, hi = n;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (u < U[mid]) hi = mid; else lo = mid; }
  return lo;
}
/** Basisfunktionen und 1./2. Ableitung (Piegl & Tiller A2.3), ders[k][j]. */
export function basisDers(span: number, u: number, p: number, U: number[], nd = 1): number[][] {
  const ndu = Array.from({ length: p + 1 }, () => new Array(p + 1).fill(0));
  const left = new Array(p + 1).fill(0), right = new Array(p + 1).fill(0);
  ndu[0][0] = 1;
  for (let j = 1; j <= p; j++) {
    left[j] = u - U[span + 1 - j]; right[j] = U[span + j] - u; let saved = 0;
    for (let r = 0; r < j; r++) {
      ndu[j][r] = right[r + 1] + left[j - r]; const t = ndu[r][j - 1] / ndu[j][r];
      ndu[r][j] = saved + right[r + 1] * t; saved = left[j - r] * t;
    }
    ndu[j][j] = saved;
  }
  const ders = Array.from({ length: nd + 1 }, () => new Array(p + 1).fill(0));
  for (let j = 0; j <= p; j++) ders[0][j] = ndu[j][p];
  const a = [new Array(p + 1).fill(0), new Array(p + 1).fill(0)];
  for (let r = 0; r <= p; r++) {
    let s1 = 0, s2 = 1; a[0][0] = 1;
    for (let k = 1; k <= nd; k++) {
      let d = 0; const rk = r - k, pk = p - k;
      if (r >= k) { a[s2][0] = a[s1][0] / ndu[pk + 1][rk]; d = a[s2][0] * ndu[rk][pk]; }
      const j1 = rk >= -1 ? 1 : -rk, j2 = r - 1 <= pk ? k - 1 : p - r;
      for (let j = j1; j <= j2; j++) { a[s2][j] = (a[s1][j] - a[s1][j - 1]) / ndu[pk + 1][rk + j]; d += a[s2][j] * ndu[rk + j][pk]; }
      if (r <= pk) { a[s2][k] = -a[s1][k - 1] / ndu[pk + 1][r]; d += a[s2][k] * ndu[r][pk]; }
      ders[k][r] = d; const t = s1; s1 = s2; s2 = t;
    }
  }
  let r = p;
  for (let k = 1; k <= nd; k++) { for (let j = 0; j <= p; j++) ders[k][j] *= r; r *= p - k; }
  return ders;
}
/** Fläche und Ableitungen: [S, Su, Sv, Suu, Suv, Svv]. */
export function evalSurface(S: BSplineSurface, u: number, v: number, nd = 1): Vec3[] {
  const su = findSpan(S.nu, S.degU, u, S.ku), sv = findSpan(S.nv, S.degV, v, S.kv);
  const Nu = basisDers(su, u, S.degU, S.ku, nd), Nv = basisDers(sv, v, S.degV, S.kv, nd);
  const out: Vec3[] = []; const combos = nd >= 2 ? [[0, 0], [1, 0], [0, 1], [2, 0], [1, 1], [0, 2]] : nd >= 1 ? [[0, 0], [1, 0], [0, 1]] : [[0, 0]];
  for (const [a, b] of combos) {
    const r: Vec3 = [0, 0, 0];
    for (let i = 0; i <= S.degU; i++) for (let j = 0; j <= S.degV; j++) {
      const w = Nu[a][i] * Nv[b][j]; if (!w) continue;
      const c = 3 * ((su - S.degU + i) * S.nv + (sv - S.degV + j));
      r[0] += w * S.ctrl[c]; r[1] += w * S.ctrl[c + 1]; r[2] += w * S.ctrl[c + 2];
    }
    out.push(r);
  }
  return out;
}
export function evalCurve(C: BSplineCurve, t: number): Vec3 {
  const s = findSpan(C.n, C.deg, t, C.knots), N = basisDers(s, t, C.deg, C.knots, 0)[0]; const r: Vec3 = [0, 0, 0];
  for (let i = 0; i <= C.deg; i++) { const c = 3 * (s - C.deg + i); r[0] += N[i] * C.ctrl[c]; r[1] += N[i] * C.ctrl[c + 1]; r[2] += N[i] * C.ctrl[c + 2]; }
  return r;
}

// ---------------------------------------------------------------- Lineare Algebra (dicht, SPD)
function cholSolve(A: Float64Array, n: number, B: Float64Array, m: number): boolean {
  // A (n×n) wird überschrieben (L), B (n×m) wird zur Lösung.
  for (let j = 0; j < n; j++) {
    let s = A[j * n + j];
    for (let k = 0; k < j; k++) s -= A[j * n + k] ** 2;
    if (s <= 1e-14) return false;
    const d = Math.sqrt(s); A[j * n + j] = d;
    for (let i = j + 1; i < n; i++) { let t = A[i * n + j]; for (let k = 0; k < j; k++) t -= A[i * n + k] * A[j * n + k]; A[i * n + j] = t / d; }
  }
  for (let c = 0; c < m; c++) {
    for (let i = 0; i < n; i++) { let t = B[i * m + c]; for (let k = 0; k < i; k++) t -= A[i * n + k] * B[k * m + c]; B[i * m + c] = t / A[i * n + i]; }
    for (let i = n - 1; i >= 0; i--) { let t = B[i * m + c]; for (let k = i + 1; k < n; k++) t -= A[k * n + i] * B[k * m + c]; B[i * m + c] = t / A[i * n + i]; }
  }
  return true;
}
/** Glättungsmatrix: Summe quadrierter 2. Differenzen der Kontrollpunkte in u und v. */
function addSmoothing(A: Float64Array, nu: number, nv: number, lam: number) {
  const N = nu * nv, id = (i: number, j: number) => i * nv + j;
  const add3 = (a: number, b: number, c: number) => { const ix = [a, b, c], w = [1, -2, 1];
    for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) A[ix[r] * N + ix[s]] += lam * w[r] * w[s]; };
  for (let i = 0; i < nu; i++) for (let j = 1; j < nv - 1; j++) add3(id(i, j - 1), id(i, j), id(i, j + 1));
  for (let j = 0; j < nv; j++) for (let i = 1; i < nu - 1; i++) add3(id(i - 1, j), id(i, j), id(i + 1, j));
}

// ---------------------------------------------------------------- Rand
/** Randschleifen der von den Vertices `sel` vollständig überdeckten Dreiecke; liefert die längste Schleife (Vertexindizes). */
export function boundaryLoop(indices: Uint32Array, sel: Uint32Array, nv: number): number[] {
  const inS = new Uint8Array(nv); for (const v of sel) inS[v] = 1;
  const cnt = new Map<number, number>(); const key = (a: number, b: number) => (a < b ? a * nv + b : b * nv + a);
  const dirE = new Map<number, number>();
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    if (!inS[a] || !inS[b] || !inS[c]) continue;
    for (const [x, y] of [[a, b], [b, c], [c, a]]) { const k = key(x, y); cnt.set(k, (cnt.get(k) ?? 0) + 1); dirE.set(k, x * nv + y); }
  }
  const next = new Map<number, number[]>();
  for (const [k, c] of cnt) if (c === 1) { const d = dirE.get(k)!; const x = Math.floor(d / nv), y = d % nv; (next.get(x) ?? next.set(x, []).get(x)!).push(y); }
  const used = new Set<number>(); let best: number[] = [];
  for (const s of next.keys()) {
    if (used.has(s)) continue;
    const loop = [s]; used.add(s); let cur = s;
    for (let g = 0; g < 1e6; g++) {
      const nx = (next.get(cur) ?? []).find((y) => !used.has(y));
      if (nx == null) break; loop.push(nx); used.add(nx); cur = nx;
    }
    if (loop.length > best.length) best = loop;
  }
  return best;
}

/** Minimales umschließendes Rechteck (rotierende Achsen, Kandidatwinkel aus den Kanten der konvexen Hülle). */
function minRect(xy: [number, number][]): { c: number; s: number; x0: number; x1: number; y0: number; y1: number } {
  const P = [...xy].sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of P.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const H = lo.slice(0, -1).concat(up.slice(0, -1));
  let best = { a: Infinity, c: 1, s: 0, x0: 0, x1: 0, y0: 0, y1: 0 };
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-12) continue;
    const c = (b[0] - a[0]) / L, s = (b[1] - a[1]) / L;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of H) { const x = c * p[0] + s * p[1], y = -s * p[0] + c * p[1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const ar = (x1 - x0) * (y1 - y0); if (ar < best.a) best = { a: ar, c, s, x0, x1, y0, y1 };
  }
  return best;
}
const polyArea = (xy: [number, number][]) => { let a = 0; for (let i = 0; i < xy.length; i++) { const p = xy[i], q = xy[(i + 1) % xy.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };

/** Kurven-LSQ (kubisch, Sehnenlängen-Parametrisierung, Endpunkte interpoliert über starke Gewichtung). */
export function fitCurve(P: Vec3[], nCtrl: number, deg = 3): BSplineCurve {
  const n = Math.max(deg + 1, Math.min(nCtrl, P.length)); const U = clampedKnots(n, deg);
  const t = [0]; for (let i = 1; i < P.length; i++) t.push(t[i - 1] + norm(sub(P[i], P[i - 1])));
  const L = t[t.length - 1] || 1;
  const A = new Float64Array(n * n), B = new Float64Array(n * 3);
  P.forEach((p, k) => {
    const u = t[k] / L, s = findSpan(n, deg, u, U), N = basisDers(s, u, deg, U, 0)[0], w = k === 0 || k === P.length - 1 ? 1e4 : 1;
    for (let i = 0; i <= deg; i++) { const I = s - deg + i; for (let j = 0; j <= deg; j++) A[I * n + s - deg + j] += w * N[i] * N[j]; for (let c = 0; c < 3; c++) B[I * 3 + c] += w * N[i] * p[c]; }
  });
  for (let i = 0; i < n; i++) A[i * n + i] += 1e-9;
  cholSolve(A, n, B, 3);
  return { deg, n, knots: U, ctrl: Array.from(B) };
}

// ---------------------------------------------------------------- Flächenfit
export function fitFreeform(p: Vec3[], nrm: Vec3[], loop: Vec3[] | null, o: NurbsParams): NurbsFit {
  const N = p.length; if (N < 16) throw new Error('Zu wenige Punkte für eine Freiformfläche');
  const deg = Math.max(1, Math.min(5, Math.round(o.deg)));
  const nu = Math.max(deg + 1, Math.round(o.nu)), nv = Math.max(deg + 1, Math.round(o.nv));
  // Ausgleichsebene
  const c: Vec3 = [0, 0, 0]; for (const q of p) { c[0] += q[0] / N; c[1] += q[1] / N; c[2] += q[2] / N; }
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const q of p) { const d = sub(q, c); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += d[i] * d[j]; }
  const eg = eigSym3(M); const ord = [0, 1, 2].sort((a, b) => eg.values[a] - eg.values[b]);
  let n = unit(eg.vectors[ord[0]]);
  if (nrm.length) { const mn = nrm.reduce((s, v) => add(s, v), [0, 0, 0] as Vec3); if (dot(mn, n) < 0) n = scale(n, -1); }
  let e1 = unit(eg.vectors[ord[2]]); let e2 = cross(n, e1);
  // Rand in der Ebene → minimales Rechteck (Achsen + Ausdehnung), Ecken
  const loopP = loop && loop.length >= 8 ? loop : null;
  const to2 = (q: Vec3): [number, number] => { const d = sub(q, c); return [dot(d, e1), dot(d, e2)]; };
  const ref2 = (loopP ?? p).map(to2);
  const R = minRect(ref2);
  e1 = unit(add(scale(e1, R.c), scale(e2, R.s))); e2 = cross(n, e1);
  const u0 = R.x0, v0 = R.y0, su = R.x1 - R.x0 || 1, sv = R.y1 - R.y0 || 1;
  const toUV = (q: Vec3): [number, number] => { const d = sub(q, c); return [Math.min(1, Math.max(0, (dot(d, e1) - u0) / su)), Math.min(1, Math.max(0, (dot(d, e2) - v0) / sv))]; };
  let kind: NurbsFit['kind'] = 'getrimmt'; const corners: Vec3[] = []; const boundary: BSplineCurve[] = []; let trimUV: number[] = [];
  if (loopP) {
    const luv = loopP.map(toUV); const fill = polyArea(luv);
    if (fill > 0.9) {
      kind = 'vierseitig';
      const ci = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([a, b]) => { let k = 0, bd = Infinity; luv.forEach((q, i) => { const d = (q[0] - a) ** 2 + (q[1] - b) ** 2; if (d < bd) { bd = d; k = i; } }); return k; });
      ci.forEach((k) => corners.push(loopP[k]));
      // Schleife so drehen, dass sie bei Ecke 0 beginnt; Reihenfolge der Ecken entlang der Schleife
      const sorted = [...ci].sort((a, b) => a - b);
      for (let s = 0; s < 4; s++) {
        const a = sorted[s], b = sorted[(s + 1) % 4]; const seg: Vec3[] = [];
        for (let k = a; ; k = (k + 1) % loopP.length) { seg.push(loopP[k]); if (k === b) break; }
        if (seg.length >= 2) boundary.push(fitCurve(seg, Math.min(16, Math.max(4, Math.round(seg.length / 6)))));
      }
    } else {
      const closed = [...loopP, loopP[0]]; boundary.push(fitCurve(closed, Math.min(40, Math.max(8, Math.round(closed.length / 6)))));
      trimUV = luv.flat();
    }
  }
  const ku = clampedKnots(nu, deg), kv = clampedKnots(nv, deg), NC = nu * nv;
  const uv = new Float32Array(2 * N); p.forEach((q, i) => { const [a, b] = toUV(q); uv[2 * i] = a; uv[2 * i + 1] = b; });
  const S: BSplineSurface = { degU: deg, degV: deg, nu, nv, ku, kv, ctrl: new Array(3 * NC).fill(0) };
  const solveLSQ = () => {
    const A = new Float64Array(NC * NC), B = new Float64Array(NC * 3);
    const idx = new Int32Array((deg + 1) ** 2), w = new Float64Array((deg + 1) ** 2);
    for (let k = 0; k < N; k++) {
      const u = uv[2 * k], v = uv[2 * k + 1]; const s1 = findSpan(nu, deg, u, ku), s2 = findSpan(nv, deg, v, kv);
      const Bu = basisDers(s1, u, deg, ku, 0)[0], Bv = basisDers(s2, v, deg, kv, 0)[0]; let m = 0;
      for (let i = 0; i <= deg; i++) for (let j = 0; j <= deg; j++) { idx[m] = (s1 - deg + i) * nv + (s2 - deg + j); w[m++] = Bu[i] * Bv[j]; }
      for (let a = 0; a < m; a++) { const ia = idx[a] * NC; for (let b = 0; b < m; b++) A[ia + idx[b]] += w[a] * w[b]; for (let cc = 0; cc < 3; cc++) B[idx[a] * 3 + cc] += w[a] * p[k][cc]; }
    }
    let tr = 0; for (let i = 0; i < NC; i++) tr += A[i * NC + i];
    // Glättung relativ zur Datenmatrix skaliert; kleine Grundregularisierung füllt leere Bereiche (getrimmt)
    addSmoothing(A, nu, nv, (Math.max(0, o.smooth) + 1e-6) * (tr / NC));
    for (let i = 0; i < NC; i++) A[i * NC + i] += 1e-10 * (tr / NC);
    if (!cholSolve(A, NC, B, 3)) throw new Error('Gleichungssystem singulär – weniger Kontrollpunkte wählen');
    S.ctrl = Array.from(B);
  };
  solveLSQ();
  // Parameterkorrektur: Fußpunkt je Punkt (Newton auf (S−p)·Su = (S−p)·Sv = 0), danach neu lösen
  const foot = (k: number, its = 4) => {
    let u = uv[2 * k], v = uv[2 * k + 1];
    for (let it = 0; it < its; it++) {
      const [P0, Su, Sv, Suu, Suv, Svv] = evalSurface(S, u, v, 2); const r = sub(P0, p[k]);
      const f = dot(r, Su), g = dot(r, Sv);
      const a = dot(Su, Su) + dot(r, Suu), b = dot(Su, Sv) + dot(r, Suv), d = dot(Sv, Sv) + dot(r, Svv);
      const det = a * d - b * b; if (Math.abs(det) < 1e-18) break;
      const du = (d * f - b * g) / det, dv = (a * g - b * f) / det;
      u = Math.min(1, Math.max(0, u - du)); v = Math.min(1, Math.max(0, v - dv));
      if (Math.abs(du) + Math.abs(dv) < 1e-9) break;
    }
    uv[2 * k] = u; uv[2 * k + 1] = v;
  };
  for (let it = 0; it < (o.iterations ?? 2); it++) { for (let k = 0; k < N; k++) foot(k); solveLSQ(); }
  for (let k = 0; k < N; k++) foot(k, 3);
  // Abweichungen (Vorzeichen: entlang Flächennormale, ausgerichtet auf die mittlere Messnormale)
  const dev = new Float32Array(N); let s = 0, s2 = 0, mx = -Infinity, mn = Infinity;
  for (let k = 0; k < N; k++) {
    const [P0, Su, Sv] = evalSurface(S, uv[2 * k], uv[2 * k + 1], 1); let nn = unit(cross(Su, Sv)); if (dot(nn, n) < 0) nn = scale(nn, -1);
    const r = sub(p[k], P0); const d = Math.abs(dot(r, nn)) > 0.98 * norm(r) ? dot(r, nn) : Math.sign(dot(r, nn) || 1) * norm(r);
    dev[k] = d; s += d; s2 += d * d; mx = Math.max(mx, d); mn = Math.min(mn, d);
  }
  const mean = s / N, rms = Math.sqrt(s2 / N), std = Math.sqrt(Math.max(0, s2 / N - mean * mean));
  return { surface: S, frame: { o: c, e1, e2, n, su, sv, u0, v0 }, kind, corners, boundary, trimUV, dev, uv, rms, std, mean, maxPos: mx, maxNeg: mn, form: mx - mn, n: N };
}

/** Punkt im Polygon (uv), für getrimmte Flächen. */
export function insideTrim(trim: number[], u: number, v: number): boolean {
  if (!trim.length) return true; let ins = false;
  for (let i = 0, j = trim.length / 2 - 1; i < trim.length / 2; j = i++) {
    const xi = trim[2 * i], yi = trim[2 * i + 1], xj = trim[2 * j], yj = trim[2 * j + 1];
    if ((yi > v) !== (yj > v) && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
/** Dreiecksnetz der (getrimmten) Fläche zur Anzeige. */
export function tessellate(f: NurbsFit, res = 48): { positions: Float32Array; indices: Uint32Array } {
  const P: number[] = [], I: number[] = [], ok: boolean[] = [];
  for (let i = 0; i <= res; i++) for (let j = 0; j <= res; j++) {
    const u = i / res, v = j / res; P.push(...evalSurface(f.surface, u, v, 0)[0]); ok.push(insideTrim(f.trimUV, u, v));
  }
  const id = (i: number, j: number) => i * (res + 1) + j;
  for (let i = 0; i < res; i++) for (let j = 0; j < res; j++) {
    const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
    if (f.trimUV.length && !(ok[a] && ok[b] && ok[c] && ok[d])) continue;
    I.push(a, b, c, a, c, d);
  }
  return { positions: new Float32Array(P), indices: new Uint32Array(I) };
}

// ---------------------------------------------------------------- Export
const fx = (x: number) => { const s = x.toPrecision(12); return /[.eE]/.test(s) ? s.replace('e', 'E') : s + '.'; };
/** IGES 5.3, Entity 128 (Rational B-Spline Surface, Gewichte 1) + Randkurven als Entity 126. */
export function toIGES(f: NurbsFit, name = 'Freiformflaeche'): string {
  const S = f.surface, ents: { type: number; params: string }[] = [];
  const surfParams = [128, S.nu - 1, S.nv - 1, S.degU, S.degV, 0, 0, 1, 0, 0, ...S.ku, ...S.kv, ...new Array(S.nu * S.nv).fill(1)].map(String);
  const cps: string[] = []; for (let j = 0; j < S.nv; j++) for (let i = 0; i < S.nu; i++) { const c = 3 * (i * S.nv + j); cps.push(fx(S.ctrl[c]), fx(S.ctrl[c + 1]), fx(S.ctrl[c + 2])); }
  ents.push({ type: 128, params: [...surfParams.slice(0, 10), ...S.ku.map(fx), ...S.kv.map(fx), ...new Array(S.nu * S.nv).fill('1.'), ...cps, '0.', '1.', '0.', '1.'].join(',') + ';' });
  for (const C of f.boundary) ents.push({ type: 126, params: [126, C.n - 1, C.deg, 0, 0, 1, 0, ...C.knots.map(fx), ...new Array(C.n).fill('1.'), ...C.ctrl.map(fx), '0.', '1.', '0.', '0.', '0.'].join(',') + ';' });
  const line = (s: string, sec: string, n: number) => s.padEnd(72).slice(0, 72) + sec + String(n).padStart(7);
  const wrap = (s: string, w: number) => { const out: string[] = []; let cur = ''; for (const tok of s.split(/(?<=,)/)) { if ((cur + tok).length > w) { out.push(cur); cur = ''; } cur += tok; } if (cur) out.push(cur); return out; };
  const date = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15).replace(/^(\d{8})(\d{6}).*/, '$1.$2');
  const G = `1H,,1H;,${name.length}H${name},${(name + '.igs').length}H${name}.igs,11HMessWerk 3D,3H1.0,32,38,6,308,15,${name.length}H${name},1.,2,2HMM,1,0.01,15H${date},1E-06,1000.,4HUser,6HMesswk,11,0,15H${date};`;
  const out: string[] = [line('MessWerk 3D - B-Spline-Flaechenrueckfuehrung', 'S', 1)];
  wrap(G, 72).forEach((s, i) => out.push(line(s, 'G', i + 1)));
  const D: string[] = [], P: string[] = []; let pLine = 1;
  ents.forEach((e, k) => {
    const dNo = 2 * k + 1; const pl = wrap(e.params, 64);
    const f8 = (x: number | string) => String(x).padStart(8);
    D.push([e.type, pLine, 0, 0, 0, 0, 0, 0, '00000000'].map(f8).join('') + 'D' + String(D.length + 1).padStart(7));
    D.push([e.type, 0, 0, pl.length, 0, '', '', '', 0].map(f8).join('') + 'D' + String(D.length + 1).padStart(7));
    pl.forEach((s) => P.push(s.padEnd(64) + String(dNo).padStart(8) + 'P' + String(P.length + 1).padStart(7)));
    pLine += pl.length;
  });
  out.push(...D, ...P);
  out.push(('S' + String(1).padStart(7) + 'G' + String(wrap(G, 72).length).padStart(7) + 'D' + String(D.length).padStart(7) + 'P' + String(P.length).padStart(7)).padEnd(72) + 'T' + String(1).padStart(7));
  return out.join('\n') + '\n';
}
/** STEP AP214: B_SPLINE_SURFACE_WITH_KNOTS (+ Randkurven B_SPLINE_CURVE_WITH_KNOTS). */
export function toSTEP(f: NurbsFit, name = 'Freiformflaeche'): string {
  const S = f.surface; let id = 1; const L: string[] = []; const e = (s: string) => { L.push(`#${id}=${s};`); return id++; };
  const mult = (k: number[]) => { const u: number[] = [], m: number[] = []; for (const x of k) { if (u.length && Math.abs(u[u.length - 1] - x) < 1e-12) m[m.length - 1]++; else { u.push(x); m.push(1); } } return { u, m }; };
  const pts: number[][] = []; for (let i = 0; i < S.nu; i++) { const row: number[] = []; for (let j = 0; j < S.nv; j++) { const c = 3 * (i * S.nv + j); row.push(e(`CARTESIAN_POINT('',(${fx(S.ctrl[c])},${fx(S.ctrl[c + 1])},${fx(S.ctrl[c + 2])}))`)); } pts.push(row); }
  const U = mult(S.ku), V = mult(S.kv);
  const surf = e(`B_SPLINE_SURFACE_WITH_KNOTS('${name}',${S.degU},${S.degV},(${pts.map((r) => '(' + r.map((x) => '#' + x).join(',') + ')').join(',')}),.UNSPECIFIED.,.F.,.F.,.F.,(${U.m.join(',')}),(${V.m.join(',')}),(${U.u.map(fx).join(',')}),(${V.u.map(fx).join(',')}),.UNSPECIFIED.)`);
  const items = ['#' + surf];
  f.boundary.forEach((C, k) => {
    const cp: number[] = []; for (let i = 0; i < C.n; i++) cp.push(e(`CARTESIAN_POINT('',(${fx(C.ctrl[3 * i])},${fx(C.ctrl[3 * i + 1])},${fx(C.ctrl[3 * i + 2])}))`));
    const K = mult(C.knots);
    items.push('#' + e(`B_SPLINE_CURVE_WITH_KNOTS('Rand ${k + 1}',${C.deg},(${cp.map((x) => '#' + x).join(',')}),.UNSPECIFIED.,.F.,.F.,(${K.m.join(',')}),(${K.u.map(fx).join(',')}),.UNSPECIFIED.)`));
  });
  const ctx = e(`(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${id + 1})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${id + 2},#${id + 3},#${id + 4})) REPRESENTATION_CONTEXT('',''))`);
  const lu = id + 2;
  e(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),#${lu},'distance_accuracy_value','')`);
  e(`(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))`); e(`(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))`); e(`(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())`);
  const rep = e(`GEOMETRICALLY_BOUNDED_SURFACE_SHAPE_REPRESENTATION('${name}',(#${e(`GEOMETRIC_SET('',(${items.join(',')}))`)}),#${ctx})`);
  const ac = e(`APPLICATION_CONTEXT('automotive design')`);
  e(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${ac})`);
  const pc = e(`PRODUCT_CONTEXT('',#${ac},'mechanical')`);
  const pr = e(`PRODUCT('${name}','${name}','',(#${pc}))`);
  const pf = e(`PRODUCT_DEFINITION_FORMATION('','',#${pr})`);
  const pdc = e(`PRODUCT_DEFINITION_CONTEXT('part definition',#${ac},'design')`);
  const pd = e(`PRODUCT_DEFINITION('design','',#${pf},#${pdc})`);
  const pds = e(`PRODUCT_DEFINITION_SHAPE('','',#${pd})`);
  e(`SHAPE_DEFINITION_REPRESENTATION(#${pds},#${rep})`);
  const d = new Date().toISOString().slice(0, 19);
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('MessWerk 3D B-Spline-Flaechenrueckfuehrung'),'2;1');\nFILE_NAME('${name}.stp','${d}',(''),(''),'MessWerk 3D','MessWerk 3D','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n${L.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}
export function toJSON(f: NurbsFit) {
  const S = f.surface;
  return { format: 'MessWerk3D-BSpline/1', rational: false, degreeU: S.degU, degreeV: S.degV, countU: S.nu, countV: S.nv, knotsU: S.ku, knotsV: S.kv,
    controlPoints: Array.from({ length: S.nu }, (_, i) => Array.from({ length: S.nv }, (_, j) => S.ctrl.slice(3 * (i * S.nv + j), 3 * (i * S.nv + j) + 3))),
    kind: f.kind, trimUV: f.trimUV, boundaryCurves: f.boundary.map((c) => ({ degree: c.deg, knots: c.knots, controlPoints: Array.from({ length: c.n }, (_, i) => c.ctrl.slice(3 * i, 3 * i + 3)) })),
    stats: { n: f.n, rms: f.rms, std: f.std, maxPos: f.maxPos, maxNeg: f.maxNeg, form: f.form } };
}
