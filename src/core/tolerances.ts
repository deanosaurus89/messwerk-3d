// General tolerances and fits:
//   ISO 2768-1 (linear sizes, external radii/chamfers, angles; classes f m c v)
//   ISO 2768-2 (geometrical: straightness/flatness, perpendicularity, symmetry, run-out; classes H K L)
//   ISO 286-1/-2 fits (IT grades IT4–IT12, hole/shaft fundamental deviations, nominal sizes up to 500 mm)
export type Lin = 'f' | 'm' | 'c' | 'v';
export type Geo = 'H' | 'K' | 'L';
export interface GenTol { lin: Lin | null; geo: Geo | null }
export const GENTOL_DEFAULT: GenTol = { lin: 'm', geo: 'K' };
export interface TolOut { up: number; lo: number; src: string }

const bin = (edges: number[], x: number) => { for (let i = 0; i < edges.length; i++) if (x <= edges[i]) return i; return -1; };
// ---------------- ISO 2768-1
const LIN_EDGES = [3, 6, 30, 120, 400, 1000, 2000, 4000]; // from 0.5 mm
const LIN: Record<Lin, (number | null)[]> = {
  f: [0.05, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, null],
  m: [0.1, 0.1, 0.2, 0.3, 0.5, 0.8, 1.2, 2],
  c: [0.2, 0.3, 0.5, 0.8, 1.2, 2, 3, 4],
  v: [null, 0.5, 1, 1.5, 2.5, 4, 6, 8],
};
/** ± permissible deviation of a linear size (null = not defined, e.g. < 0.5 mm or class v ≤ 3 mm) */
export function iso2768Linear(cls: Lin, size: number): number | null {
  const s = Math.abs(size); if (s < 0.5) return null; const i = bin(LIN_EDGES, s); return i < 0 ? null : LIN[cls][i];
}
/** ± external radius / chamfer height */
export function iso2768Radius(cls: Lin, size: number): number | null {
  const s = Math.abs(size); if (s < 0.5) return null; const fine = cls === 'f' || cls === 'm';
  return s <= 3 ? (fine ? 0.2 : 0.4) : s <= 6 ? (fine ? 0.5 : 1) : (fine ? 1 : 2);
}
const ANG_EDGES = [10, 50, 120, 400, Infinity];
const ANG: Record<Lin, number[]> = { f: [60, 30, 20, 10, 5], m: [60, 30, 20, 10, 5], c: [90, 60, 30, 15, 10], v: [180, 120, 60, 30, 20] }; // arc minutes
/** ± angular deviation in degrees by the length of the shorter leg [mm] */
export function iso2768Angle(cls: Lin, shorterLeg: number): number { return ANG[cls][bin(ANG_EDGES, Math.max(0, shorterLeg))] / 60; }
// ---------------- ISO 2768-2
const STR_EDGES = [10, 30, 100, 300, 1000, 3000];
const STR: Record<Geo, number[]> = { H: [0.02, 0.05, 0.1, 0.2, 0.3, 0.4], K: [0.05, 0.1, 0.2, 0.4, 0.6, 0.8], L: [0.1, 0.2, 0.4, 0.8, 1.2, 1.6] };
const PERP_EDGES = [100, 300, 1000, 3000];
const PERP: Record<Geo, number[]> = { H: [0.2, 0.3, 0.4, 0.5], K: [0.4, 0.6, 0.8, 1], L: [0.6, 1, 1.5, 2] };
const SYM: Record<Geo, number[]> = { H: [0.5, 0.5, 0.5, 0.5], K: [0.6, 0.6, 0.8, 1], L: [0.6, 1, 1.5, 2] };
const RUN: Record<Geo, number> = { H: 0.1, K: 0.2, L: 0.5 };
const last = (a: number[], i: number) => a[i < 0 ? a.length - 1 : i];
export const iso2768Straight = (cls: Geo, L: number) => last(STR[cls], bin(STR_EDGES, L));
export const iso2768Perp = (cls: Geo, shorter: number) => last(PERP[cls], bin(PERP_EDGES, shorter));
export const iso2768Sym = (cls: Geo, L: number) => last(SYM[cls], bin(PERP_EDGES, L));
export const iso2768Runout = (cls: Geo) => RUN[cls];
// ---------------- ISO 286
const SZ = [3, 6, 10, 18, 30, 50, 80, 120, 180, 250, 315, 400, 500];
const IT: Record<number, number[]> = { // µm
  4: [3, 4, 4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20],
  5: [4, 5, 6, 8, 9, 11, 13, 15, 18, 20, 23, 25, 27],
  6: [6, 8, 9, 11, 13, 16, 19, 22, 25, 29, 32, 36, 40],
  7: [10, 12, 15, 18, 21, 25, 30, 35, 40, 46, 52, 57, 63],
  8: [14, 18, 22, 27, 33, 39, 46, 54, 63, 72, 81, 89, 97],
  9: [25, 30, 36, 43, 52, 62, 74, 87, 100, 115, 130, 140, 155],
  10: [40, 48, 58, 70, 84, 100, 120, 140, 160, 185, 210, 230, 250],
  11: [60, 75, 90, 110, 130, 160, 190, 220, 250, 290, 320, 360, 400],
  12: [100, 120, 150, 180, 210, 250, 300, 350, 400, 460, 520, 570, 630],
};
// shafts: upper deviation es (a…h, negative) / lower deviation ei (k…p, positive) in µm
const ES: Record<string, number[]> = {
  d: [-20, -30, -40, -50, -65, -80, -100, -120, -145, -170, -190, -210, -230],
  e: [-14, -20, -25, -32, -40, -50, -60, -72, -85, -100, -110, -125, -135],
  f: [-6, -10, -13, -16, -20, -25, -30, -36, -43, -50, -56, -62, -68],
  g: [-2, -4, -5, -6, -7, -9, -10, -12, -14, -15, -17, -18, -20],
  h: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};
const EI: Record<string, number[]> = {
  k: [0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 5], // IT4…IT7; 0 otherwise
  m: [2, 4, 6, 7, 8, 9, 11, 13, 15, 17, 20, 21, 23],
  n: [4, 8, 10, 12, 15, 17, 20, 23, 27, 31, 34, 37, 40],
  p: [6, 12, 15, 18, 22, 26, 32, 37, 43, 50, 56, 62, 68],
};
export const itValue = (grade: number, size: number) => { const i = bin(SZ, size), t = IT[grade]; return t && i >= 0 && size > 0 ? t[i] : null; };
/** ISO 286 limit deviations [mm] of a hole (upper-case letter) or shaft (lower-case), e.g. 'H7', 'g6', 'JS9', 'k6'. */
export function iso286(code: string, size: number): { up: number; lo: number } | null {
  const m = /^\s*(js|JS|[a-zA-Z])\s*(\d{1,2})\s*$/.exec(code); if (!m || !(size > 0) || size > 500) return null;
  const L = m[1], g = +m[2], it = itValue(g, size); if (it == null) return null; const i = bin(SZ, size);
  const hole = L === L.toUpperCase(), l = L.toLowerCase();
  let up: number, lo: number;
  if (l === 'js') { up = it / 2; lo = -it / 2; }
  else if (!hole) {
    if (ES[l]) { up = ES[l][i]; lo = up - it; }
    else if (EI[l]) { lo = l === 'k' && (g < 4 || g > 7) ? 0 : EI[l][i]; up = lo + it; }
    else return null;
  } else {
    if (ES[l]) { lo = -ES[l][i]; up = lo + it; } // D…H: EI = −es
    else if (EI[l]) { // K, M, N, P: ES = −ei (+ Δ for the fine grades)
      const delta = i === 0 ? 0 : (IT[g - 1] ? it - IT[g - 1][i] : 0);
      const fine = l === 'p' ? g <= 7 : g <= 8;
      const ei = l === 'k' ? (g >= 4 && g <= 7 ? EI.k[i] : 0) : EI[l][i];
      if (l === 'k' && !fine) up = 0; else up = -ei + (fine ? delta : 0);
      lo = up - it;
    } else return null;
  }
  return { up: up / 1000 + 0, lo: lo / 1000 + 0 }; // + 0: no −0
}
/** size / distance / angle / geometrical control → general tolerance; L = relevant length (plane extent, shorter leg) */
export type TolKind = 'size' | 'radius' | 'angle' | 'straight' | 'round' | 'perp' | 'sym' | 'runout' | 'parallel';
export function generalTol(k: TolKind, g: GenTol, value: number, L: number, sizeForRound?: number): TolOut | null {
  const lin = g.lin, geo = g.geo;
  switch (k) {
    case 'size': { if (!lin) return null; const t = iso2768Linear(lin, value); return t == null ? null : { up: t, lo: -t, src: `ISO 2768-${lin}` }; }
    case 'radius': { if (!lin) return null; const t = iso2768Radius(lin, value); return t == null ? null : { up: t, lo: -t, src: `ISO 2768-${lin} (radius)` }; }
    case 'angle': { if (!lin) return null; const t = iso2768Angle(lin, L); return { up: t, lo: -t, src: `ISO 2768-${lin} (angle)` }; }
    case 'straight': return geo ? { up: iso2768Straight(geo, L), lo: 0, src: `ISO 2768-${geo}` } : null;
    case 'perp': return geo ? { up: iso2768Perp(geo, L), lo: 0, src: `ISO 2768-${geo}` } : null;
    case 'sym': return geo ? { up: iso2768Sym(geo, L), lo: 0, src: `ISO 2768-${geo}` } : null;
    case 'runout': return geo ? { up: iso2768Runout(geo), lo: 0, src: `ISO 2768-${geo}` } : null;
    case 'parallel': return geo ? { up: iso2768Straight(geo, L), lo: 0, src: `ISO 2768-${geo}` } : null; // ≥ flatness/straightness (size tol. not known here)
    case 'round': { if (!geo || !lin) return null; const d = iso2768Linear(lin, sizeForRound ?? value); const r = iso2768Runout(geo); return { up: d == null ? r : Math.min(2 * d, r), lo: 0, src: `ISO 2768-${lin}${geo}` }; }
  }
}
