// Magischer Radierer: Beule/Spritzer auf idealen Flächen entfernen → Füllung liegt auf der sauberen Fläche (≈ Rauschniveau),
// auch über Verrundungs-Übergang (Ebene → R5) und scharfe 90°-Kante.
import { describe, expect, it } from 'vitest';
import { boundaryEdges, eraseAndFill } from '../src/core/polyedit';
import { gauss, rng } from './synth';

type V = [number, number, number];
/** Gitter-Netz aus Parameterfunktion (u,v) ∈ [0,1]², Rauschen in Normalenrichtung, Beule (Gauß, Höhe h) um Weltpunkt b. */
function grid(fn: (u: number, v: number) => { p: V; n: V }, nu: number, nv: number, noise: number, bump?: { at: V; h: number; s: number }) {
  const R = rng(7); const pos: number[] = [], idx: number[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const { p, n } = fn(i / nu, j / nv);
    let d = noise * gauss(R);
    if (bump) { const r2 = (p[0] - bump.at[0]) ** 2 + (p[1] - bump.at[1]) ** 2 + (p[2] - bump.at[2]) ** 2; d += bump.h * Math.exp(-r2 / (2 * bump.s ** 2)); }
    pos.push(p[0] + d * n[0], p[1] + d * n[1], p[2] + d * n[2]);
  }
  const id = (i: number, j: number) => j * (nu + 1) + i;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) idx.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
const near = (m: { positions: Float32Array }, c: V, r: number) => { const o: number[] = []; for (let i = 0; i < m.positions.length / 3; i++) if (Math.hypot(m.positions[3 * i] - c[0], m.positions[3 * i + 1] - c[1], m.positions[3 * i + 2] - c[2]) < r) o.push(i); return Uint32Array.from(o); };
/** Profil (x,y) über Bogenlänge: Ebene (y=0, x<0) → Verrundung R um (0,R) → Wand x=R (bzw. scharfe Kante bei R=0). */
function profile(R: number) {
  const L1 = 12, L2 = (Math.PI / 2) * R, L3 = 12, L = L1 + L2 + L3;
  return { L, at: (s: number): { p: [number, number]; n: [number, number] } => {
    if (s <= L1) return { p: [s - L1, 0], n: [0, -1] };
    if (s <= L1 + L2) { const f = (s - L1) / R; return { p: [R * Math.sin(f), R - R * Math.cos(f)], n: [Math.sin(f), -Math.cos(f)] }; }
    return { p: [R, R + (s - L1 - L2)], n: [1, 0] };
  }, dist: (x: number, y: number) => {
    if (R === 0) return x <= 0 && y <= 0 ? Math.min(-x, -y) : Math.hypot(Math.max(0, x), Math.max(0, -y)) && (x <= 0 ? Math.abs(y) : y <= 0 ? Math.abs(x) : Math.min(x, -y) < 0 ? Math.min(Math.abs(x), Math.abs(y)) : Math.min(Math.abs(x), Math.abs(y)));
    if (x <= 0) return Math.abs(y);
    if (y >= R) return Math.abs(x - R);
    return Math.abs(Math.hypot(x, y - R) - R);
  } };
}
function check(name: string, m: any, sel: Uint32Array, ideal: (p: V) => number, maxDev: number) {
  const b0 = boundaryEdges(m.indices, m.positions.length / 3).count;
  const r = eraseAndFill(m, sel);
  const nv0 = m.positions.length / 3 - sel.length; // erste Knoten bleiben erhalten (compact behält Reihenfolge)
  let mx = 0; for (let i = 0; i < r.positions.length / 3; i++) { const p: V = [r.positions[3 * i], r.positions[3 * i + 1], r.positions[3 * i + 2]]; if (i >= nv0) mx = Math.max(mx, ideal(p)); }
  console.log(`${name}: ${sel.length} Knoten entfernt, ${r.added} neu, Flächen ${r.surfaces.join(',')}, max. Abw. zur Idealfläche ${mx.toFixed(4)} mm`);
  expect(r.loops).toBe(1);
  expect(boundaryEdges(r.indices, r.positions.length / 3).count).toBe(b0);
  expect(mx).toBeLessThan(maxDev);
  return { r, mx };
}

describe('Magischer Radierer – intelligente Füllung', () => {
  const noise = 0.005;
  it('Ebene mit Beule (0,5 mm)', () => {
    const m = grid((u, v) => ({ p: [u * 40, v * 40, 0], n: [0, 0, 1] }), 80, 80, noise, { at: [20, 20, 0], h: 0.5, s: 1 });
    check('Ebene', m, near(m, [20, 20, 0], 3.5), (p) => Math.abs(p[2]), 0.02);
  });
  it('Zylinder R20 mit Schweißspritzer', () => {
    const fn = (u: number, v: number) => { const a = u * Math.PI; return { p: [20 * Math.cos(a), 20 * Math.sin(a), v * 40] as V, n: [Math.cos(a), Math.sin(a), 0] as V }; };
    const m = grid(fn, 160, 80, noise, { at: [0, 20, 20], h: 0.8, s: 0.8 });
    check('Zylinder', m, near(m, [0, 20, 20], 3), (p) => Math.abs(Math.hypot(p[0], p[1]) - 20), 0.02);
  });
  it('Beule auf Übergang Ebene → Verrundung R5', () => {
    const pr = profile(5);
    const m = grid((u, v) => { const q = pr.at(u * pr.L); return { p: [q.p[0], q.p[1], v * 20], n: [q.n[0], q.n[1], 0] }; }, 90, 40, noise, { at: [0, 0, 10], h: 0.5, s: 0.8 });
    check('Ebene/R5-Übergang', m, near(m, [0, 0, 10], 3), (p) => pr.dist(p[0], p[1]), 0.03);
  });
  it('Spritzer auf scharfer 90°-Kante bleibt Kante', () => {
    const L = 24; const at = (s: number): { p: [number, number]; n: [number, number] } => (s <= 12 ? { p: [s - 12, 0], n: [0, -1] } : { p: [0, s - 12], n: [1, 0] });
    const m = grid((u, v) => { const q = at(u * L); return { p: [q.p[0], q.p[1], v * 20], n: [q.n[0], q.n[1], 0] }; }, 96, 40, noise, { at: [0, 0, 10], h: 0.5, s: 0.8 });
    const ideal = (p: V) => (p[0] <= 0 && p[1] >= 0 ? Math.min(-p[0], p[1]) : p[0] > 0 && p[1] < 0 ? Math.hypot(p[0], p[1]) : p[0] > 0 ? p[0] : -p[1]);
    check('90°-Kante', m, near(m, [0, 0, 10], 2.5), ideal, 0.05);
  });
});
