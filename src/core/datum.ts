// Bezüge (ISO 5459) und Toleranzen mit Bezug (ISO 1101) auf Basis der gemessenen Geometrie.
//
// Bezugssystem (DRF) aus bis zu drei Bezügen in Reihenfolge primär | sekundär | tertiär:
//  - Primär A: Ebene -> z = Ebenennormale (aus dem Material), Ursprung auf A. Achse -> z = Achse, Ursprung auf der Achse.
//    Punkt (Kugel) -> nur Ursprung.
//  - Sekundär B: Ebene -> eine Achsrichtung in A = Normale von B (senkrecht zu z gemacht), Ursprung auf B verschoben.
//    Achse/Punkt -> Ursprung = Durchstoßpunkt bzw. Projektion von B in A (Drehlage noch frei).
//  - Tertiär C: legt die verbleibende Drehlage bzw. den Ursprung entlang der letzten freien Richtung fest.
//  - Danach werden die beiden Achsen in der Ebene so als X/Y bezeichnet, dass X der Welt-X-Richtung am nächsten liegt.
import type { Control, Feature } from './features';
import type { GeomType } from './fit';
import { Vec3, add, basis, cross, dot, norm, scale, sub, unit } from './linalg';
import { medianLine } from './median';

export type DatumKind = 'plane' | 'axis' | 'point';
export const datumKind = (t: GeomType): DatumKind | null =>
  t === 'Ebene' ? 'plane' : t === 'Zylinder' || t === 'Kegel' || t === 'Kreis' || t === 'Langloch' || t === 'Torus' ? 'axis'
    : t === 'Kugel' || t === 'Punkt' ? 'point' : null;
export const DATUM_LETTERS = 'ABCDEFGHJKLMNPRST'.split('');

export interface DRF { o: Vec3; x: Vec3; y: Vec3; z: Vec3; text: string; free: string[]; }

const orth = (v: Vec3, z: Vec3) => sub(v, scale(z, dot(v, z)));
const canonAxis = (a: Vec3): Vec3 => { const i = [0, 1, 2].reduce((m, k) => (Math.abs(a[k]) > Math.abs(a[m]) + 1e-9 ? k : m), 2); return a[i] < 0 ? scale(a, -1) : a; };

export function buildDRF(ds: Feature[]): DRF {
  const W: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let o: Vec3 = [0, 0, 0], z: Vec3 | null = null, u: Vec3 | null = null;
  const free: string[] = [];
  const A = ds[0];
  if (A) {
    const m = A.measured!, k = datumKind(A.type);
    o = m.center;
    if (k === 'plane') z = unit(m.normal); else if (k === 'axis') z = canonAxis(unit(m.normal));
  }
  if (!z) { z = [0, 0, 1]; free.push('Orientierung'); }
  let originFixedInPlane = false;
  for (const D of ds.slice(1)) {
    const m = D.measured!, k = datumKind(D.type);
    if (!u) {
      if (k === 'plane') {
        const w = orth(unit(m.normal), z!);
        if (norm(w) > 1e-6) { u = unit(w); o = add(o, scale(u, dot(sub(m.center, o), unit(m.normal)) / dot(u, unit(m.normal)))); }
      } else if (!originFixedInPlane) {
        // Achse/Punkt: Ursprung in der Ebene auf B legen
        const d = orth(sub(m.center, o), z!); o = add(o, d); originFixedInPlane = true;
      } else {
        const d = orth(sub(m.center, o), z!); if (norm(d) > 1e-6) u = unit(d);
      }
    } else {
      const v = cross(z!, u);
      if (k === 'plane') { const n = unit(m.normal), den = dot(v, n); if (Math.abs(den) > 1e-6) o = add(o, scale(v, dot(sub(m.center, o), n) / den)); }
      else o = add(o, scale(v, dot(sub(m.center, o), v)));
    }
  }
  if (!u) {
    let w = orth(W[0], z!); if (norm(w) < 0.3) w = orth(W[1], z!); u = unit(w);
    if (ds.length) free.push('Drehung um z');
  }
  const cand: Vec3[] = [u, cross(z!, u), scale(u, -1), scale(cross(z!, u), -1)];
  const x = cand.reduce((b, c) => (dot(c, W[0]) > dot(b, W[0]) ? c : b));
  const y = cross(z!, x);
  return { o, x, y, z: z!, text: ds.map((d) => d.datum ?? '?').join('|'), free };
}
export const toLocal = (f: DRF, p: Vec3): Vec3 => { const d = sub(p, f.o); return [dot(d, f.x), dot(d, f.y), dot(d, f.z)]; };
export const dirLocal = (f: DRF, a: Vec3): Vec3 => [dot(a, f.x), dot(a, f.y), dot(a, f.z)];

/** Element-Klasse für Richtungstoleranzen. */
const elemClass = (t: GeomType): 'surface' | 'axis' | 'disc' | null =>
  t === 'Ebene' ? 'surface' : t === 'Zylinder' || t === 'Kegel' ? 'axis' : t === 'Kreis' || t === 'Langloch' || t === 'Torus' ? 'disc' : null;

export type DatumKindCtl = 'Parallelität' | 'Rechtwinkligkeit' | 'Neigung' | 'Position' | 'Koaxialität' | 'Konzentrizität'
  | 'Symmetrie' | 'Rundlauf' | 'Gesamtrundlauf' | 'Profil (Bezug)';
export const DATUM_CONTROLS: DatumKindCtl[] = ['Parallelität', 'Rechtwinkligkeit', 'Neigung', 'Position', 'Koaxialität', 'Konzentrizität', 'Symmetrie', 'Rundlauf', 'Gesamtrundlauf', 'Profil (Bezug)'];
export const isDatumControl = (k: string): k is DatumKindCtl => (DATUM_CONTROLS as string[]).includes(k);
/** Anzahl benötigter/erlaubter Bezüge [min, max]. */
export const DATUM_COUNT: Record<DatumKindCtl, [number, number]> = {
  Parallelität: [1, 1], Rechtwinkligkeit: [1, 1], Neigung: [1, 1], Position: [1, 3], Koaxialität: [1, 1], Konzentrizität: [1, 1],
  Symmetrie: [1, 1], Rundlauf: [1, 1], Gesamtrundlauf: [1, 1], 'Profil (Bezug)': [1, 3],
};

export interface EvalCtx { points?: (featureId: number) => Vec3[] | null; /** active coordinate system (outputs X/Y/Z, angles, distance components) */ frame?: { o: Vec3; R: [Vec3, Vec3, Vec3] } | null; }
export interface DatumEval { value: number | null; flag?: string; detail?: string; }

function range(p: Vec3[], n: Vec3) { let mn = Infinity, mx = -Infinity; for (const q of p) { const t = dot(q, n); if (t < mn) mn = t; if (t > mx) mx = t; } return mx - mn; }
const dirOf = (f: Feature) => unit(f.measured!.normal);
const elemSize = (f: Feature) => { const m = f.measured!; return f.type === 'Langloch' ? m.length! : f.type === 'Torus' ? 2 * (m.radius! + m.minorRadius!) : (m.length || m.diameter || 1); };

/** Wert einer Toleranz mit Bezug (Toleranzzonenbreite bzw. -durchmesser in mm). */
export function evalDatumControl(c: Control, feats: Map<number, Feature>, ctx: EvalCtx = {}): DatumEval {
  const f = feats.get(c.featureIds[0]); if (!f?.measured) return { value: null };
  const kind = c.kind as DatumKindCtl;
  const ds = (c.datumIds ?? []).map((id) => feats.get(id));
  if (ds.some((d) => !d)) return { value: null, flag: 'datum feature deleted' };
  if (ds.some((d) => !d!.datum)) return { value: null, flag: 'Bezug entfernt' };
  const [mn] = DATUM_COUNT[kind];
  if (ds.length < mn) return { value: null, flag: 'Bezug fehlt' };
  if (ds.some((d) => d!.id === f.id)) return { value: null, flag: 'feature is its own datum' };
  const D = ds as Feature[];
  const m = f.measured, D0 = D[0], k0 = datumKind(D0.type);
  const pts = () => ctx.points?.(f.id) ?? null;
  switch (kind) {
    case 'Parallelität': case 'Rechtwinkligkeit': case 'Neigung': {
      if (k0 === 'point') return { value: null, flag: 'Datum must be a plane or axis' };
      const cls = elemClass(f.type); if (!cls) return { value: null, flag: 'not applicable' };
      const e = dirOf(f), g = dirOf(D0);
      // gewünschter Winkel β zwischen Element-Richtung e (Normale bzw. Achse) und Bezugsrichtung g
      const eIsNormal = cls !== 'axis', gIsNormal = k0 === 'plane';
      const same = eIsNormal === gIsNormal; // beide Normalen bzw. beide Achsen
      let beta: number;
      if (kind === 'Neigung') { const a = (c.basic?.[0] ?? 45) * Math.PI / 180; beta = same ? a : Math.PI / 2 - a; }
      else beta = (kind === 'Parallelität') === same ? 0 : Math.PI / 2;
      const phi = Math.acos(Math.min(1, Math.abs(dot(e, g))));
      const err = Math.abs(phi - beta);
      if (cls === 'surface') {
        const P = pts();
        let w = orth(e, g); w = norm(w) > 1e-9 ? unit(w) : basis(g)[0];
        const sg = dot(e, g) < 0 ? -1 : 1;
        const nz = unit(add(scale(g, sg * Math.cos(beta)), scale(w, Math.sin(beta))));
        if (P && P.length) return { value: range(P, nz), detail: `Zone ⟂ ${nz.map((v) => v.toFixed(3)).join(' ')}` };
        return { value: elemSize(f) * Math.sin(err) + m.form, detail: 'aus Ausgleichsebene (ohne Punkte)' };
      }
      return { value: elemSize(f) * Math.sin(err), detail: `angle error ${(err * 180 / Math.PI).toFixed(4)}° over ${elemSize(f).toFixed(2)} mm` };
    }
    case 'Position': {
      const F = buildDRF(D);
      const loc = toLocal(F, m.center), b = (c.basic ?? [0, 0, 0]) as Vec3, d = sub(loc, b);
      if (f.type === 'Ebene') {
        const nl = dirLocal(F, dirOf(f)), ax = [0, 1, 2].reduce((a, k) => (Math.abs(nl[k]) > Math.abs(nl[a]) ? k : a), 0);
        const nn: Vec3 = [0, 0, 0]; nn[ax] = 1;
        const P = pts(); if (!P) return { value: 2 * Math.abs(d[ax]) + m.form };
        let mx = 0; for (const q of P) mx = Math.max(mx, Math.abs(toLocal(F, q)[ax] - b[ax]));
        return { value: 2 * mx, detail: `Ebene ⟂ ${'XYZ'[ax]} (DRF ${F.text})` };
      }
      if (datumKind(f.type) === 'axis' && f.type !== 'Torus') {
        // Soll-Achse: durch das theoretisch genaue Maß, Richtung = nächstliegende DRF-Achse; ganze Ist-Achse (Endpunkte) muss in Ø-Zone
        const a = unit(dirLocal(F, dirOf(f))), ax = [0, 1, 2].reduce((q, k) => (Math.abs(a[k]) > Math.abs(a[q]) ? k : q), 0);
        const g: Vec3 = [0, 0, 0]; g[ax] = 1;
        // cylinder/cone with points: derived median line (section centres, ISO 12180-1) must lie in the Ø zone
        const P = f.type === 'Zylinder' || f.type === 'Kegel' ? pts() : null;
        const ML = P && P.length >= 64 ? medianLine(m, P) : [];
        if (ML.length >= 2) { let mx = 0; for (const q of ML) mx = Math.max(mx, norm(orth(sub(toLocal(F, q), b), g)));
          return { value: 2 * mx, detail: `derived median line (${ML.length} sections) in Ø zone around nominal axis ∥ ${'XYZ'[ax]} (DRF ${F.text})` }; }
        const L = f.type === 'Zylinder' || f.type === 'Kegel' ? m.length || 0 : 0;
        let mx = 0;
        for (const s of [-0.5, 0.5]) { const e = add(loc, scale(a, s * L)); mx = Math.max(mx, norm(orth(sub(e, b), g))); }
        return { value: 2 * mx, detail: `zylindrische Zone um Soll-Achse ∥ ${'XYZ'[ax]} (DRF ${F.text}, axis end points – no points)` };
      }
      return { value: 2 * norm(d), detail: `spherical zone SØ (DRF ${F.text})` };
    }
    case 'Koaxialität': case 'Konzentrizität': case 'Rundlauf': case 'Gesamtrundlauf': {
      if (k0 !== 'axis' && !(kind === 'Konzentrizität' && k0 === 'point')) return { value: null, flag: 'datum must be an axis' };
      const g = dirOf(D0), pD = D0.measured!.center;
      const distLine = (q: Vec3) => norm(orth(sub(q, pD), g));
      if (kind === 'Konzentrizität') return { value: 2 * (k0 === 'point' ? norm(sub(m.center, pD)) : distLine(m.center)) };
      if (kind === 'Koaxialität') {
        const a = dirOf(f), L = m.length || 0;
        return { value: 2 * Math.max(distLine(add(m.center, scale(a, L / 2))), distLine(add(m.center, scale(a, -L / 2)))) };
      }
      const P = pts(); if (!P || P.length < 10) return { value: null, flag: 'no points' };
      const rho = P.map((q) => distLine(q)), t = P.map((q) => dot(sub(q, pD), g));
      if (kind === 'Gesamtrundlauf') return { value: Math.max(...rho) - Math.min(...rho), detail: 'radial over the whole surface' };
      const tmin = Math.min(...t), tmax = Math.max(...t), bw = Math.max(0.5, (tmax - tmin) / 10);
      const bins = new Map<number, [number, number]>();
      t.forEach((tt, i) => { const k = Math.floor((tt - tmin) / bw); const b = bins.get(k) ?? [Infinity, -Infinity]; b[0] = Math.min(b[0], rho[i]); b[1] = Math.max(b[1], rho[i]); bins.set(k, b); });
      let mx = 0; for (const [, [lo, hi]] of bins) mx = Math.max(mx, hi - lo);
      return { value: mx, detail: `radial, ${bins.size} Messkreise à ${bw.toFixed(2)} mm` };
    }
    case 'Symmetrie': {
      if (k0 === 'plane') return { value: 2 * Math.abs(dot(sub(m.center, D0.measured!.center), dirOf(D0))) };
      if (k0 === 'axis') {
        const w = f.type === 'Langloch' ? unit(cross(dirOf(f), m.direction!)) : basis(dirOf(D0))[0];
        return { value: 2 * Math.abs(dot(orth(sub(m.center, D0.measured!.center), dirOf(D0)), w)) };
      }
      return { value: null, flag: 'Datum must be a plane or axis' };
    }
    case 'Profil (Bezug)': {
      const F = buildDRF(D);
      const loc = toLocal(F, m.center), b = (c.basic ?? loc) as Vec3;
      const r = Math.max(Math.abs(m.maxPos), Math.abs(m.maxNeg));
      let dd = norm(sub(loc, b));
      if (f.type === 'Ebene') dd = Math.abs(dot(sub(loc, b), unit(dirLocal(F, dirOf(f)))));
      return { value: 2 * (r + dd), detail: 'obere Schranke: 2·(max. Formabw. + Lageabw. des Mittelpunkts)' };
    }
  }
}
