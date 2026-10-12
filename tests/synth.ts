import type { Vec3 } from '../src/core/linalg';
export function rng(seed = 1) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export function gauss(r: () => number) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export function frame(axis: Vec3): [Vec3, Vec3, Vec3] {
  const l = Math.hypot(...axis); const d: Vec3 = [axis[0] / l, axis[1] / l, axis[2] / l];
  const a: Vec3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u0: Vec3 = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]];
  const ul = Math.hypot(...u0); const u: Vec3 = [u0[0] / ul, u0[1] / ul, u0[2] / ul];
  const v: Vec3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  return [u, v, d];
}
const comb = (f: [Vec3, Vec3, Vec3], c: Vec3, x: number, y: number, z: number): Vec3 =>
  [c[0] + x * f[0][0] + y * f[1][0] + z * f[2][0], c[1] + x * f[0][1] + y * f[1][1] + z * f[2][1], c[2] + x * f[0][2] + y * f[1][2] + z * f[2][2]];
const dir = (f: [Vec3, Vec3, Vec3], x: number, y: number, z: number): Vec3 => comb(f, [0, 0, 0], x, y, z);

export function cylinder(c: Vec3, axis: Vec3, r: number, h: number, n: number, noise = 0, seed = 1, arc = 2 * Math.PI) {
  const R = rng(seed), f = frame(axis), P: Vec3[] = [], N: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const t = R() * arc, z = (R() - 0.5) * h, rr = r + noise * gauss(R);
    P.push(comb(f, c, rr * Math.cos(t), rr * Math.sin(t), z)); N.push(dir(f, Math.cos(t), Math.sin(t), 0));
  }
  return { P, N };
}
export function plane(c: Vec3, nrm: Vec3, size: number, n: number, noise = 0, seed = 2) {
  const R = rng(seed), f = frame(nrm), P: Vec3[] = [], N: Vec3[] = [];
  for (let i = 0; i < n; i++) { P.push(comb(f, c, (R() - 0.5) * size, (R() - 0.5) * size, noise * gauss(R))); N.push(f[2]); }
  return { P, N };
}
export function sphere(c: Vec3, r: number, n: number, noise = 0, seed = 3, capAngle = Math.PI) {
  const R = rng(seed), P: Vec3[] = [], N: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const z = 1 - R() * (1 - Math.cos(capAngle)), t = R() * 2 * Math.PI, s = Math.sqrt(1 - z * z);
    const d: Vec3 = [s * Math.cos(t), s * Math.sin(t), z], rr = r + noise * gauss(R);
    P.push([c[0] + rr * d[0], c[1] + rr * d[1], c[2] + rr * d[2]]); N.push(d);
  }
  return { P, N };
}
/** Kegelstumpf: Spitze apex, Achse axis, halber Winkel a, Höhe von h0..h1 ab Spitze. */
export function cone(apex: Vec3, axis: Vec3, a: number, h0: number, h1: number, n: number, noise = 0, seed = 4) {
  const R = rng(seed), f = frame(axis), P: Vec3[] = [], N: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const h = h0 + R() * (h1 - h0), t = R() * 2 * Math.PI, r = h * Math.tan(a);
    const nn = dir(f, Math.cos(a) * Math.cos(t), Math.cos(a) * Math.sin(t), -Math.sin(a));
    const e = noise * gauss(R);
    P.push(add(comb(f, apex, r * Math.cos(t), r * Math.sin(t), h), [nn[0] * e, nn[1] * e, nn[2] * e])); N.push(nn);
  }
  return { P, N };
}
/** Langloch-Wand: Mitte c, Achse axis, Längsrichtung u (⟂ axis), Gesamtlänge L, Breite W, Tiefe h. */
export function slot(c: Vec3, L: number, W: number, h: number, n: number, noise = 0, seed = 5) {
  const R = rng(seed), r = W / 2, hl = L / 2 - r, P: Vec3[] = [], N: Vec3[] = [];
  const per = 4 * hl + 2 * Math.PI * r;
  for (let i = 0; i < n; i++) {
    let s = R() * per, x: number, y: number, nx: number, ny: number;
    if (s < 2 * hl) { x = -hl + s; y = r; nx = 0; ny = 1; }
    else if ((s -= 2 * hl) < Math.PI * r) { const t = Math.PI / 2 - s / r; x = hl + r * Math.cos(t); y = r * Math.sin(t); nx = Math.cos(t); ny = Math.sin(t); }
    else if ((s -= Math.PI * r) < 2 * hl) { x = hl - s; y = -r; nx = 0; ny = -1; }
    else { s -= 2 * hl; const t = -Math.PI / 2 - s / r; x = -hl + r * Math.cos(t); y = r * Math.sin(t); nx = Math.cos(t); ny = Math.sin(t); }
    const e = noise * gauss(R);
    P.push([c[0] + x + nx * e, c[1] + y + ny * e, c[2] + (R() - 0.5) * h]); N.push([nx, ny, 0]);
  }
  return { P, N };
}
