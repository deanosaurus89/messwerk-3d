import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { it } from 'vitest';
import { parseSTL } from '../src/core/io';
import { MeshTopology, setNormalMode, setRobustS } from '../src/core/region';
type V3 = [number, number, number];
const R = (x: number, y: number, cx: number, cy: number) => Math.hypot(x - cx, y - cy);
const topE = (x: number, y: number) => Math.min(x, 100 - x, y, 60 - y, Math.abs(R(x, y, 20, 20) - 6.04), Math.abs(R(x, y, 85, 10) - 3), Math.abs(R(x, y, 55.05, 30) - 8), Math.abs(R(x, y, 82, 38) - 10), Math.abs(R(x, y, 60, 8) - Math.sqrt(40)), Math.abs(R(x, y, 40, 10) - 4.167), Math.abs(R(x, y, 40, 10) - 7.833), Math.abs(Math.hypot(x - Math.min(30, Math.max(10, x)), y - 45) - 5));
const topOn = (x: number, y: number) => x > 0 && x < 100 && y > 0 && y < 60 && R(x, y, 20, 20) > 6.04 && R(x, y, 85, 10) > 3 && R(x, y, 55.05, 30) > 8 && R(x, y, 82, 38) > 10 && R(x, y, 60, 8) > Math.sqrt(40) && R(x, y, 40, 10) > 7.833 && Math.hypot(x - Math.min(30, Math.max(10, x)), y - 45) > 5;
// feature: seed, normal, surface distance d(p), edge distance e(p) (for points on the face)
const ca = Math.atan(0.6);
const F: { name: string; seed: V3; n: V3; d: (p: V3) => number; e: (p: V3) => number }[] = [
  { name: 'Ebene oben', seed: [70, 52, 20], n: [0, 0, 1], d: (p) => (topOn(p[0], p[1]) ? Math.abs(p[2] - 20) : 9), e: (p) => topE(p[0], p[1]) },
  { name: 'Bohrung Ø12 Wand', seed: [20, 26.04, 10], n: [0, -1, 0], d: (p) => (p[2] > 0 && p[2] < 20 ? Math.abs(R(p[0], p[1], 20, 20) - 6.04) : 9), e: (p) => Math.min(p[2], 20 - p[2]) },
  { name: 'Bolzen Ø16 Mantel', seed: [55.05, 38, 26], n: [0, 1, 0], d: (p) => (p[2] > 20 && p[2] < 32 ? Math.abs(R(p[0], p[1], 55.05, 30) - 8) : 9), e: (p) => Math.min(p[2] - 20, 32 - p[2]) },
  { name: 'Kegel', seed: [82, 31, 25], n: [0, -Math.cos(ca), Math.sin(ca)], d: (p) => (p[2] > 20 && p[2] < 30 ? Math.abs(R(p[0], p[1], 82, 38) - (10 - 0.6 * (p[2] - 20))) * Math.cos(ca) : 9), e: (p) => Math.min(p[2] - 20, 30 - p[2]) / Math.cos(ca) },
  { name: 'Kugel', seed: [60, 8, 24], n: [0, 0, 1], d: (p) => (p[2] > 20 ? Math.abs(Math.hypot(p[0] - 60, p[1] - 8, p[2] - 17) - 7) : 9), e: (p) => 7 * (Math.asin(Math.max(-1, Math.min(1, (p[2] - 17) / 7))) - Math.asin(3 / 7)) },
  { name: 'Torus', seed: [46, 10, 22.8], n: [0, 0, 1], d: (p) => { const r = R(p[0], p[1], 40, 10); return p[2] > 20 ? Math.abs(Math.hypot(r - 6, p[2] - 20.8) - 2) : 9; },
    e: (p) => { const r = R(p[0], p[1], 40, 10); const ph = Math.atan2(p[2] - 20.8, r - 6); const p0 = Math.asin(-0.4), p1 = Math.PI - p0; let a = ph < -Math.PI / 2 ? ph + 2 * Math.PI : ph; return 2 * Math.min(Math.abs(a - p0), Math.abs(p1 - a)); } },
];
const BINS = [0, 0.25, 0.5, 1, 2, 1e9];
const out: any = {};
const FILES = (process.env.FILES ?? 'public/samples/beispielteil.stl,/tmp/beispielteil-old.stl').split(','), MODES = (process.env.MODES ?? 'needle036,plain,robust').split(',') as any[], SS = (process.env.SS ?? '0.1').split(',').map(Number);
const OUT = process.env.OUT ?? '/workspace/research/edge037/edge.json';
for (const file of FILES) for (const mode of MODES) for (const S of SS) it.skipIf(!existsSync(file) || !existsSync(dirname(OUT)))(`${file} ${mode} ${S}`, () => {
  setNormalMode(mode); setRobustS(S); const b = readFileSync(file); const m = parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), 'x');
  const t0 = performance.now(); const topo = new MeshTopology(m); const ms = performance.now() - t0; const p = m.positions, f = m.indices, fn = m.faceNormals!, nv = p.length / 3;
  const res: any = { ms: Math.round(ms) };
  for (const ft of F) {
    let best = -1, bd = Infinity; for (let t = 0; t < f.length / 3; t++) { if (fn[3 * t] * ft.n[0] + fn[3 * t + 1] * ft.n[1] + fn[3 * t + 2] * ft.n[2] < 0.7) continue; let d = 0; for (let k = 0; k < 3; k++) { const c = (p[3 * f[3 * t] + k] + p[3 * f[3 * t + 1] + k] + p[3 * f[3 * t + 2] + k]) / 3; d += (c - ft.seed[k]) ** 2; } if (d < bd) { bd = d; best = t; } }
    const tr = topo.growRegion(best, ft.seed, { maxAngleDeg: 20, radius: 0, noCurv: !!process.env.NOCURV }); const sel = new Uint8Array(nv); for (const v of topo.regionVertices(tr).all) sel[v] = 1;
    const tot = BINS.slice(1).map(() => 0), got = BINS.slice(1).map(() => 0); let wrong = 0, nsel = 0, minE = Infinity;
    for (let v = 0; v < nv; v++) { const q: V3 = [p[3 * v], p[3 * v + 1], p[3 * v + 2]]; const on = ft.d(q) < 0.05; if (sel[v]) { nsel++; if (!on) wrong++; } if (!on) continue; const e = ft.e(q); const k = BINS.findIndex((x, i) => e >= x && e < BINS[i + 1]); tot[k]++; if (sel[v]) { got[k]++; minE = Math.min(minE, e); } }
    // edge "stop distance": smallest e such that ≥ 50 % of the face points beyond it are selected (per 0.05 mm step)
    if (process.env.KPROF) { const ks: number[][] = BINS.slice(1).map(() => []); for (let t = 0; t < f.length / 3; t++) { const q: V3 = [0, 1, 2].map((k) => (p[3 * f[3 * t] + k] + p[3 * f[3 * t + 1] + k] + p[3 * f[3 * t + 2] + k]) / 3) as V3; if (ft.d(q) > 0.05) continue; const e = ft.e(q); const k = BINS.findIndex((x, i) => e >= x && e < BINS[i + 1]); if (k >= 0 && k < ks.length) ks[k].push(topo.K(t)); }
      console.log('KPROF', mode, ft.name, ks.map((a) => { a.sort((x, y) => x - y); return a.length ? `${a[a.length >> 1].toFixed(3)}/${a[Math.floor(a.length * 0.9)].toFixed(3)}` : '-'; }).join(' ')); }
    res[ft.name] = { sel: nsel, wrong, frac: got.map((g, i) => (tot[i] ? +(g / tot[i]).toFixed(3) : null)), tot, minE: +minE.toFixed(3), info: topo.lastGrow?.legacy ? 'kante' : topo.lastGrow?.model };
  }
  out[`${file.includes('old') ? 'ALT-Nadelnetz' : 'neu'} ${mode} s=${S}`] = res; writeFileSync(OUT, JSON.stringify(out, null, 1));
}, 300000);
