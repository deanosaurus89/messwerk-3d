// Kleine lineare Algebra für 3D-Messtechnik (ohne Abhängigkeiten).
export type Vec3 = [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec3): Vec3 => { const l = norm(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const dist = (a: Vec3, b: Vec3) => norm(sub(a, b));

/** Orthonormalbasis (u, v) senkrecht zu n. */
export function basis(n: Vec3): [Vec3, Vec3] {
  const a: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(cross(n, a));
  return [u, cross(n, u)];
}

/** Eigenzerlegung einer symmetrischen 3x3-Matrix (Jacobi). Eigenwerte aufsteigend. */
export function eigSym3(m: number[][]): { values: number[]; vectors: Vec3[] } {
  const a = m.map((r) => r.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const idx = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return { values: idx.map((i) => a[i][i]), vectors: idx.map((i) => [v[0][i], v[1][i], v[2][i]] as Vec3) };
}

/** Gauß-Elimination mit Pivotsuche, löst A x = b (A wird überschrieben). */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    if (Math.abs(A[p][i]) < 1e-300) return null;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      if (f === 0) continue;
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}

/**
 * Levenberg-Marquardt für nichtlineare kleinste Quadrate.
 * residuals(x, out) füllt out (Länge m) mit Residuen. Jacobi-Matrix numerisch (Vorwärtsdifferenz).
 */
export function levenbergMarquardt(
  residuals: (x: number[], out: Float64Array) => void, x0: number[], m: number,
  opts: { maxIter?: number; tol?: number } = {},
): { x: number[]; cost: number; iterations: number } {
  const n = x0.length, maxIter = opts.maxIter ?? 100, tol = opts.tol ?? 1e-12;
  let x = x0.slice();
  const r = new Float64Array(m), r2 = new Float64Array(m);
  const J = Array.from({ length: n }, () => new Float64Array(m));
  residuals(x, r);
  let cost = 0; for (let i = 0; i < m; i++) cost += r[i] * r[i];
  let lambda = 1e-3, it = 0;
  for (; it < maxIter; it++) {
    for (let j = 0; j < n; j++) {
      const h = 1e-7 * Math.max(1, Math.abs(x[j]));
      const xp = x.slice(); xp[j] += h;
      residuals(xp, r2);
      const Jj = J[j];
      for (let i = 0; i < m; i++) Jj[i] = (r2[i] - r[i]) / h;
    }
    const JtJ = Array.from({ length: n }, () => new Array(n).fill(0));
    const Jtr = new Array(n).fill(0);
    for (let a = 0; a < n; a++) {
      const Ja = J[a];
      let s = 0; for (let i = 0; i < m; i++) s += Ja[i] * r[i];
      Jtr[a] = -s;
      for (let b = a; b < n; b++) {
        const Jb = J[b]; let t = 0;
        for (let i = 0; i < m; i++) t += Ja[i] * Jb[i];
        JtJ[a][b] = JtJ[b][a] = t;
      }
    }
    let improved = false;
    for (let tries = 0; tries < 12; tries++) {
      const A = JtJ.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-15 : v)));
      const dx = solve(A, Jtr.slice());
      if (!dx) { lambda *= 10; continue; }
      const xn = x.map((v, i) => v + dx[i]);
      residuals(xn, r2);
      let cn = 0; for (let i = 0; i < m; i++) cn += r2[i] * r2[i];
      if (cn < cost) {
        const rel = (cost - cn) / Math.max(cost, 1e-300);
        x = xn; r.set(r2); cost = cn; lambda = Math.max(lambda / 10, 1e-12); improved = true;
        if (rel < tol) return { x, cost, iterations: it + 1 };
        break;
      }
      lambda *= 10;
    }
    if (!improved) break;
  }
  return { x, cost, iterations: it };
}
