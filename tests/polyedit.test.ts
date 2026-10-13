// Polygonbearbeitung: Toleranz der Reduktion/Unterteilung/Glättung, geschlossene Füllung des magischen Radierers.
import { appendFileSync, readFileSync } from 'node:fs';
const log = (s: string) => { try { appendFileSync('/tmp/pe-numbers.txt', s + '\n'); } catch { /* */ } };
import { describe, expect, it } from 'vitest';
import { parseByName } from '../src/core/io';
import { boundaryEdges, compareToOriginal, decimate, eraseAndFill, signedDistances, smooth, subdivide } from '../src/core/polyedit';

function load(key: string) {
  const nom = JSON.parse(readFileSync(new URL(`../public/samples/${key}.json`, import.meta.url), 'utf8'));
  const buf = readFileSync(new URL(`../public/samples/${nom.file}`, import.meta.url));
  const m = parseByName(nom.file, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  return { positions: m.positions, indices: m.indices };
}
const maxAbs = (d: Float32Array) => d.reduce((a, x) => Math.max(a, Math.abs(x)), 0);

for (const key of ['pruefplatte', 'flansch', 'freiform']) {
  describe(`Polygonbearbeitung ${key}`, () => {
    const orig = load(key);
    for (const tol of [0.01, 0.05]) {
      it(`Reduktion tol=${tol} mm: max. Abweichung ≤ tol`, () => {
        const t0 = performance.now();
        const r = decimate(orig, { tol });
        const dev = maxAbs(signedDistances(orig.positions, r).d);
        log(`${key} tol=${tol}: ${r.before} -> ${r.after} Dreiecke (${(100 * r.after / r.before).toFixed(1)} %), max ${dev.toFixed(4)} mm, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
        // beidseitig: Schwerpunkte der reduzierten Dreiecke -> Original
        const cen = new Float32Array(r.indices.length); for (let t = 0; t < r.indices.length / 3; t++) for (let k = 0; k < 3; k++) cen[3 * t + k] = (r.positions[3 * r.indices[3 * t] + k] + r.positions[3 * r.indices[3 * t + 1] + k] + r.positions[3 * r.indices[3 * t + 2] + k]) / 3;
        const back = maxAbs(signedDistances(cen, orig).d);
        log(`  beidseitig (Schwerpunkte -> Original): max ${back.toFixed(4)} mm`);
        expect(back).toBeLessThanOrEqual(tol * 1.0001 + 1e-6);
        // krümmungsadaptiv: Normalenabweichung neue Dreiecke vs. Original, Flächen eben vs. Übergang
        { const near = signedDistances(cen, orig).tri; let worst = 0, aFlat = 0, nFlat = 0, aTr = 0, nTr = 0; const P = r.positions, T = r.indices, Q = orig.positions, G = orig.indices;
          const nrm = (X: Float32Array, I: Uint32Array, t: number) => { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2]; const u = [X[b] - X[a], X[b + 1] - X[a + 1], X[b + 2] - X[a + 2]], w = [X[c] - X[a], X[c + 1] - X[a + 1], X[c + 2] - X[a + 2]]; const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; const l = Math.hypot(n[0], n[1], n[2]) || 1; return { n: n.map((x) => x / l), A: l / 2 }; };
          for (let t = 0; t < T.length / 3; t++) { const a = nrm(P, T, t), b = nrm(Q, G, near[t]); const ang = Math.acos(Math.min(1, a.n[0] * b.n[0] + a.n[1] * b.n[1] + a.n[2] * b.n[2])) * 180 / Math.PI; worst = Math.max(worst, ang);
            const z = Math.abs(a.n[2]), x = Math.max(Math.abs(a.n[0]), Math.abs(a.n[1]), z); if (x > 0.999) { aFlat += a.A; nFlat++; } else if (x < 0.95) { aTr += a.A; nTr++; } }
          log(`  Normalenabw. max ${worst.toFixed(1)}° · mittl. Dreiecksfläche eben ${(aFlat / nFlat).toFixed(2)} mm² (${nFlat}) / gekrümmt ${(aTr / nTr).toFixed(3)} mm² (${nTr})`);
          expect(worst).toBeLessThan(25); }
        expect(r.after).toBeLessThan(r.before);
        expect(dev).toBeLessThanOrEqual(tol * 1.0001 + 1e-6);
        expect(boundaryEdges(r.indices, r.positions.length / 3).count).toBe(boundaryEdges(orig.indices, orig.positions.length / 3).count);
      });
    }
  });
}

describe('Unterteilung / Glättung / Radierer (Prüfplatte)', () => {
  const orig = load('pruefplatte');
  it('Unterteilung: 4× Dreiecke, Abweichung ≤ tol', () => {
    const small = decimate(orig, { tol: 0.05 }); // kleiner, schneller
    const r = subdivide(small, { tol: 0.01 });
    expect(r.indices.length).toBe(4 * small.indices.length);
    expect(maxAbs(signedDistances(r.positions, small).d)).toBeLessThanOrEqual(0.0101);
  });
  it('Glättung: Verschiebung ≤ tol', () => {
    const r = smooth(orig, { iterations: 5, tol: 0.02 });
    let mx = 0; for (let i = 0; i < r.positions.length; i += 3) mx = Math.max(mx, Math.hypot(r.positions[i] - orig.positions[i], r.positions[i + 1] - orig.positions[i + 1], r.positions[i + 2] - orig.positions[i + 2]));
    expect(mx).toBeLessThanOrEqual(0.02 + 2e-5); expect(mx).toBeGreaterThan(0);
  });
  it('Magischer Radierer: Loch geschlossen, Füllung nahe der Fläche', () => {
    // Treffer: Dreieck nahe dem Prüfpunkt der Oberseite (125, 60, 16)
    const P = orig.positions, F = orig.indices; let best = 0, bd = Infinity;
    for (let t = 0; t < F.length / 3; t++) { const a = 3 * F[3 * t]; const d = (P[a] - 125) ** 2 + (P[a + 1] - 60) ** 2 + (P[a + 2] - 16) ** 2; if (d < bd) { bd = d; best = t; } }
    const c = [P[3 * F[3 * best]], P[3 * F[3 * best] + 1], P[3 * F[3 * best] + 2]];
    const b0 = boundaryEdges(orig.indices, P.length / 3).count;
    const r = eraseAndFill(orig, c, 4, best, [0, 0, 1]);
    log('Radierer ' + JSON.stringify({ removed: r.removed, added: r.added, loops: r.loops, skipped: r.skipped, center: c }));
    expect(r.removed).toBeGreaterThan(20); expect(r.loops).toBe(1);
    expect(boundaryEdges(r.indices, r.positions.length / 3).count).toBe(b0);
    const cmp = compareToOriginal(r, orig);
    expect(Math.max(cmp.maxPos, -cmp.maxNeg)).toBeLessThan(0.5);
  });
});
