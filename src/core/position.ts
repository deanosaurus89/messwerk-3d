// Position of axes (single feature or bolt-circle pattern) with the degrees of freedom left free by the datum
// reference frame, material modifiers Ⓜ/Ⓛ (bonus tolerance) and datum shift (ISO 1101, ISO 2692, ISO 5458).
//
// Every member is a derived median line (or the axis end points) in DRF-local coordinates with its own nominal axis
// (point + direction). The nominal set may be moved as ONE rigid body (common zone CZ / simultaneous requirement)
// or each member separately, but only along the DOF the DRF leaves free:
//   - translations along free DRF axes (e.g. only datum A → X/Y free; A|B → the direction along B),
//   - rotation about Z if no datum fixes it (e.g. A|B with B a hole),
//   - datum shift: a bounded in-plane translation |δ| ≤ s/2 when a datum feature of size is referenced at Ⓜ/Ⓛ
//     (s = the datum's departure from its MMC/LMC size).
// The optimisation minimises the worst member excess max_i(Ø_i − t_i) (Nelder–Mead with restarts).
import { Vec3, add, dot, norm, scale, sub } from './linalg';
import { nelderMead } from './datumsim';

export interface PosMember { ML: Vec3[]; nomP: Vec3; g: Vec3; t: number; }
export interface PosFreedom { freeT: Vec3[]; freeR: boolean; shiftR: number; }
const orth = (v: Vec3, z: Vec3) => sub(v, scale(z, dot(v, z)));
const rotZ = (p: Vec3, w: number): Vec3 => [p[0] * Math.cos(w) - p[1] * Math.sin(w), p[0] * Math.sin(w) + p[1] * Math.cos(w), p[2]];

/** Ø of one member for a transformed nominal. */
export function memberDia(m: PosMember, w: number, tr: Vec3): number {
  const p = add(rotZ(m.nomP, w), tr), g = rotZ(m.g, w); let mx = 0;
  for (const q of m.ML) mx = Math.max(mx, norm(orth(sub(q, p), g)));
  return 2 * mx;
}
export interface PosResult { dia: number[]; excess: number; worst: number; w: number; tr: Vec3; }

function solve(members: PosMember[], fr: PosFreedom): PosResult {
  const nT = fr.freeT.length, nS = fr.shiftR > 0 ? 2 : 0, nR = fr.freeR ? 1 : 0, n = nT + nS + nR;
  const unpack = (x: number[]) => {
    let tr: Vec3 = [0, 0, 0]; for (let k = 0; k < nT; k++) tr = add(tr, scale(fr.freeT[k], x[k]));
    if (nS) { let dx = x[nT], dy = x[nT + 1]; const r = Math.hypot(dx, dy); if (r > fr.shiftR) { dx *= fr.shiftR / r; dy *= fr.shiftR / r; } tr = add(tr, [dx, dy, 0]); }
    return { w: nR ? x[n - 1] : 0, tr };
  };
  const ev = (x: number[]) => { const { w, tr } = unpack(x); const d = members.map((m) => memberDia(m, w, tr)); return { d, e: Math.max(...d.map((v, i) => v - members[i].t)) }; };
  let x = new Array(n).fill(0);
  if (n) {
    const d0 = ev(x).d, sc = Math.max(1e-4, ...d0) / 2, R = Math.max(1, ...members.map((m) => Math.hypot(m.nomP[0], m.nomP[1])));
    const step = [...new Array(nT + nS).fill(sc), ...(nR ? [sc / R] : [])];
    let best = nelderMead((y) => ev(y).e, x, step, 400, 1e-14);
    for (let k = 1; k <= 3; k++) { const s2 = step.map((s) => s / (4 * k)), r = nelderMead((y) => ev(y).e, best.x, s2, 300, 1e-14); if (r.v < best.v) best = r; }
    if (best.v < ev(x).e) x = best.x;
  }
  const r = ev(x), u = unpack(x), worst = r.d.reduce((bi, v, i) => (v - members[i].t > r.d[bi] - members[bi].t ? i : bi), 0);
  return { dia: r.d, excess: r.e, worst, w: u.w, tr: u.tr };
}
/** Evaluate members: `cz` (common zone / simultaneous) → one transform for all; otherwise each member separately. */
export function evalPositionGroup(members: PosMember[], fr: PosFreedom, cz = true): PosResult {
  if (cz || members.length === 1) return solve(members, fr);
  const rs = members.map((m) => solve([m], fr)), dia = rs.map((r) => r.dia[0]);
  const worst = dia.reduce((bi, v, i) => (v - members[i].t > dia[bi] - members[bi].t ? i : bi), 0);
  return { dia, excess: Math.max(...rs.map((r) => r.excess)), worst, w: rs[worst].w, tr: rs[worst].tr };
}
/** Bonus tolerance from the material modifier (ISO 2692). `d` = actual mating size (Ⓜ) or minimum-material size (Ⓛ). */
export function bonus(mod: 'M' | 'L', hole: boolean, d: number, nominal: number, tolUp: number, tolLo: number): { bonus: number; limit: number; beyond: boolean } {
  const mmc = hole ? nominal + tolLo : nominal + tolUp, lmc = hole ? nominal + tolUp : nominal + tolLo;
  const raw = mod === 'M' ? (hole ? d - mmc : mmc - d) : (hole ? lmc - d : d - lmc);
  return { bonus: Math.max(0, raw), limit: mod === 'M' ? mmc : lmc, beyond: raw < 0 };
}
