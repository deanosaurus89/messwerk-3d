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
import { medianLine, orientNominal, orientZone, resolveOrient } from './median';
import { SimCtx, simulateDatums, matingSize } from './datumsim';
import { PosMember, bonus as mmBonus, evalPositionGroup } from './position';

export type DatumKind = 'plane' | 'axis' | 'point';
export const datumKind = (t: GeomType): DatumKind | null =>
  t === 'Ebene' ? 'plane' : t === 'Zylinder' || t === 'Kegel' || t === 'Kreis' || t === 'Langloch' || t === 'Torus' ? 'axis'
    : t === 'Kugel' || t === 'Punkt' ? 'point' : null;
export const DATUM_LETTERS = 'ABCDEFGHJKLMNPRST'.split('');

export interface DRF { o: Vec3; x: Vec3; y: Vec3; z: Vec3; text: string; free: string[];
  /** DRF-local axes (0 = X, 1 = Y, 2 = Z) along which the origin is NOT fixed by the datums (free translations) */
  freeT: number[];
  /** rotation about Z not fixed by the datums */
  freeR: boolean; }

const orth = (v: Vec3, z: Vec3) => sub(v, scale(z, dot(v, z)));
const canonAxis = (a: Vec3): Vec3 => { const i = [0, 1, 2].reduce((m, k) => (Math.abs(a[k]) > Math.abs(a[m]) + 1e-9 ? k : m), 2); return a[i] < 0 ? scale(a, -1) : a; };

/**
 * Datum reference frame. Also reports which DOF stay free (ISO 5459): with A only, X/Y translation and rotation about Z
 * are free; A|B (plane) leaves the translation along B; A|B (hole) leaves the rotation; A|B|C fixes everything.
 * A bolt-circle pattern used as datum fixes origin AND rotation (its mean angular position).
 */
export function buildDRF(ds: Feature[]): DRF {
  const W: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let o: Vec3 = [0, 0, 0], z: Vec3 | null = null, u: Vec3 | null = null;
  const free: string[] = [], fixed: Vec3[] = [];
  const A = ds[0]; let primaryAxis = false;
  if (A) {
    const m = A.measured!, k = datumKind(A.type);
    o = m.center;
    if (k === 'plane') { z = unit(m.normal); fixed.push(z); }
    else if (k === 'axis') { z = canonAxis(unit(m.normal)); fixed.push(...basis(z)); primaryAxis = true; if (m.pattern && m.direction) { const w = orth(unit(m.direction), z); if (norm(w) > 1e-6) u = unit(w); } }
    else if (k === 'point') fixed.push(...W);
  }
  if (!z) { z = [0, 0, 1]; free.push('Orientierung'); }
  let originFixedInPlane = primaryAxis;
  for (const D of ds.slice(1)) {
    const m = D.measured!, k = datumKind(D.type);
    if (k === 'plane' && Math.abs(dot(unit(m.normal), z!)) > 0.98) { // plane ⟂ primary axis: fixes the origin along Z
      const n = unit(m.normal); o = add(o, scale(z!, dot(sub(m.center, o), n) / dot(z!, n))); fixed.push(z!); continue; }
    if (!u) {
      if (k === 'plane') {
        const w = orth(unit(m.normal), z!);
        if (norm(w) > 1e-6) { u = unit(w); o = add(o, scale(u, dot(sub(m.center, o), unit(m.normal)) / dot(u, unit(m.normal)))); fixed.push(u); }
      } else if (!originFixedInPlane) {
        // axis/point (or pattern): origin in the plane on B
        const d = orth(sub(m.center, o), z!); o = add(o, d); originFixedInPlane = true; fixed.push(...basis(z!));
        if (m.pattern && m.direction) { const w = orth(unit(m.direction), z!); if (norm(w) > 1e-6) u = unit(w); }
      } else {
        const d = orth(sub(m.center, o), z!); if (norm(d) > 1e-6) u = unit(d);
      }
    } else {
      const v = cross(z!, u);
      if (k === 'plane') { const n = unit(m.normal), den = dot(v, n); if (Math.abs(den) > 1e-6) { o = add(o, scale(v, dot(sub(m.center, o), n) / den)); fixed.push(v); } }
      else { o = add(o, scale(v, dot(sub(m.center, o), v))); fixed.push(v); }
    }
  }
  const freeR = !u;
  if (!u) {
    let w = orth(W[0], z!); if (norm(w) < 0.3) w = orth(W[1], z!); u = unit(w);
    if (ds.length) free.push('Drehung um z');
  }
  const cand: Vec3[] = [u, cross(z!, u), scale(u, -1), scale(cross(z!, u), -1)];
  const x = cand.reduce((b, c) => (dot(c, W[0]) > dot(b, W[0]) ? c : b));
  const y = cross(z!, x);
  // free translations: DRF axes not in the span of the fixed directions
  const S: Vec3[] = []; for (const f of fixed) { let r = f; for (const b of S) r = sub(r, scale(b, dot(r, b))); if (norm(r) > 1e-6) S.push(unit(r)); }
  const freeT = [x, y, z!].map((e, i) => { let r = e; for (const b of S) r = sub(r, scale(b, dot(r, b))); return norm(r) > 0.9 ? i : -1; }).filter((i) => i >= 0);
  return { o, x, y, z: z!, text: ds.map((d) => d.datum ?? '?').join('|'), free, freeT, freeR: !!ds.length && freeR };
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

export interface EvalCtx extends SimCtx { /** all controls (size nominal/tolerances for Ⓜ/Ⓛ) */ controls?: Control[]; points?: (featureId: number) => Vec3[] | null; /** active coordinate system (outputs X/Y/Z, angles, distance components) */ frame?: { o: Vec3; R: [Vec3, Vec3, Vec3] } | null; }
/** TED components the user must enter for a control (indices into basic): Neigung → angle; Position/Profile →
 *  the DRF components that matter (plane: along its normal; axis: the two ⟂ to the nominal axis; point/sphere: all). */
export function requiredBasic(c: { kind: string }, f: Feature | undefined, ds: Feature[]): number[] {
  if (c.kind === 'Neigung') return [0];
  if (c.kind !== 'Position' && c.kind !== 'Profil (Bezug)') return [];
  if (!f?.measured || !ds.length || ds.some((d) => !d?.measured)) return [0, 1, 2];
  const F = buildDRF(ds), k = datumKind(f.type);
  const ax = nominalDirLocal(F, f.measured.normal, (c as { basic?: (number | null)[] }).basic).ax;
  const fr = (i: number) => !F.freeT.includes(i); // components along free DRF translations are not needed
  if (k === 'plane') return [ax].filter(fr);
  if (k === 'axis' && f.type !== 'Torus') {
    const r = [0, 1, 2].filter((i) => i !== ax && fr(i));
    return isPattern(f) && c.kind === 'Position' ? [...r, 5, ...(F.freeR ? [] : [6])] : r;
  }
  return [0, 1, 2].filter(fr);
}
/** Bolt-circle pattern feature (constructed from member holes). */
export const isPattern = (f: Feature) => !!f.measured?.pattern && f.cons?.key === 'bc-pattern' && !!f.cons.refs.length;
const E3 = (i: number): Vec3 => { const e: Vec3 = [0, 0, 0]; e[i] = 1; return e; };
/** Size limits of a feature from its Diameter control (nominal + tolerances), for Ⓜ/Ⓛ. */
function sizeSpec(fid: number, ctx: EvalCtx) { return ctx.controls?.find((k) => k.kind === 'Durchmesser' && k.featureIds[0] === fid && k.nominal != null) ?? null; }
/** Bonus of one feature of size for the control's modifier; flag if the size spec or points are missing. */
function featBonus(mod: 'M' | 'L', f: Feature, ctx: EvalCtx): { b: number; txt: string } | { flag: string } {
  const sp = sizeSpec(f.id, ctx); if (!sp) return { flag: `size nominal missing for ${mod === 'M' ? 'Ⓜ' : 'Ⓛ'} – add a Diameter control with nominal and tolerances to ${f.name}` };
  const ms = matingSize(f, ctx, mod); if (!ms) return { flag: `${f.name}: no points/normals for the ${mod === 'M' ? 'mating' : 'minimum-material'} size` };
  const r = mmBonus(mod, ms.hole, ms.d, sp.nominal!, sp.tolUp, sp.tolLo);
  return { b: r.bonus, txt: `${f.name}: ${mod === 'M' ? 'mating' : 'min.-material'} size Ø ${ms.d.toFixed(4)}, ${mod === 'M' ? 'MMC' : 'LMC'} ${r.limit.toFixed(4)} → bonus ${r.bonus.toFixed(4)}${r.beyond ? ' (size beyond the limit – no bonus)' : ''}` };
}
export const NOMINAL_MISSING = 'Nominal missing';
const DEG = Math.PI / 180;
/** TED angles of the nominal direction (Position): basic[3] = θ from DRF Z, basic[4] = φ about Z from DRF X (degrees). */
export const hasTedAngle = (basic?: (number | null)[]) => basic?.[3] != null || basic?.[4] != null;
/**
 * Nominal direction (axis direction or plane normal) in DRF-local coordinates. With TED angles θ/φ it is
 * (sinθ cosφ, sinθ sinφ, cosθ) – any oblique direction; without them it is the DRF axis nearest to the actual direction.
 * `ax` = dominant component (the coordinate along which the TED point is not needed).
 */
export function nominalDirLocal(F: DRF, actual: Vec3, basic?: (number | null)[]): { g: Vec3; ax: number; angled: boolean } {
  const a = unit(dirLocal(F, unit(actual))), big = (v: Vec3) => [0, 1, 2].reduce((q, k) => (Math.abs(v[k]) > Math.abs(v[q]) ? k : q), 0);
  if (hasTedAngle(basic)) { const t = (basic![3] ?? 0) * DEG, p = (basic![4] ?? 0) * DEG; let g: Vec3 = [Math.sin(t) * Math.cos(p), Math.sin(t) * Math.sin(p), Math.cos(t)]; if (dot(g, a) < 0) g = scale(g, -1); return { g, ax: big(g), angled: true }; }
  const ax = big(a), g: Vec3 = [0, 0, 0]; g[ax] = 1; return { g, ax, angled: false };
}
/** Nominal of a Position control in the DRF: direction (local + world) and TED point (local). Non-required components:
 *  parallel nominal → actual value (does not matter), oblique nominal → 0 (the TED point lies on that DRF plane). */
export function positionNominal(F: DRF, f: Feature, basic?: (number | null)[]): { g: Vec3; ax: number; angled: boolean; b: Vec3; dirW: Vec3; pointW: Vec3 } {
  const n = nominalDirLocal(F, f.measured!.normal, basic), loc = toLocal(F, f.measured!.center);
  const b = [0, 1, 2].map((i) => (basic?.[i] ?? (n.angled ? 0 : loc[i])) as number) as Vec3;
  const W = (v: Vec3): Vec3 => add(scale(F.x, v[0]), add(scale(F.y, v[1]), scale(F.z, v[2])));
  return { ...n, b, dirW: W(n.g), pointW: add(F.o, W(b)) };
}
export function missingBasic(c: { kind: string; basic?: (number | null)[] }, f: Feature | undefined, ds: Feature[]): boolean {
  return requiredBasic(c, f, ds).some((i) => c.basic?.[i] == null || !isFinite(c.basic[i]!));
}
export interface DatumEval { value: number | null; flag?: string; detail?: string; /** bonus tolerance from Ⓜ/Ⓛ (added to t) */ bonus?: number; }

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
  const D = simulateDatums(ds as Feature[], ctx).feats; // ISO 5459 contact datums (or Gauss in least-squares mode)
  const m = f.measured, D0 = D[0], k0 = datumKind(D0.type);
  const pts = () => ctx.points?.(f.id) ?? null;
  if (missingBasic(c, f, D)) return { value: null, flag: NOMINAL_MISSING, detail: 'Enter the theoretically exact dimensions (TED) from the drawing' };
  const B = (i: number, dflt = 0) => (c.basic?.[i] ?? dflt) as number;
  switch (kind) {
    case 'Parallelität': case 'Rechtwinkligkeit': case 'Neigung': {
      if (k0 === 'point') return { value: null, flag: 'Datum must be a plane or axis' };
      const cls = elemClass(f.type); if (!cls) return { value: null, flag: 'not applicable' };
      const e = dirOf(f), g = dirOf(D0);
      // gewünschter Winkel β zwischen Element-Richtung e (Normale bzw. Achse) und Bezugsrichtung g
      const eIsNormal = cls !== 'axis', gIsNormal = k0 === 'plane';
      const same = eIsNormal === gIsNormal; // beide Normalen bzw. beide Achsen
      let beta: number;
      if (kind === 'Neigung') { const a = B(0) * Math.PI / 180; beta = same ? a : Math.PI / 2 - a; }
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
      // cylinder/cone with points: derived median line (ISO 12180-1) in the orientation zone (same as the axis view)
      if (f.type === 'Zylinder' || f.type === 'Kegel') { const P = pts(); const ML = P && P.length >= 64 ? medianLine(m, P) : [];
        if (ML.length >= 2) { const nom = resolveOrient(ML, orientNominal(kind, gIsNormal, g, e, kind === 'Neigung' ? B(0) : 0, c.dia));
          return { value: orientZone(ML, nom), detail: `derived median line (${ML.length} sections) in ${nom.planeN ? 'zone between two planes' : 'floating Ø zone'}` }; } }
      return { value: elemSize(f) * Math.sin(err), detail: `angle error ${(err * 180 / Math.PI).toFixed(4)}° over ${elemSize(f).toFixed(2)} mm` };
    }
    case 'Position': {
      const F = buildDRF(D), N = positionNominal(F, f, c.basic), { g, b } = N, tag = N.angled ? `oblique nominal θ ${B(3)}° φ ${B(4)}°` : `nominal ∥ ${'XYZ'[N.ax]}`;
      const loc = toLocal(F, m.center);
      if (f.type === 'Ebene') {
        const P = pts(); if (!P) return { value: 2 * Math.abs(dot(sub(loc, b), g)) + m.form };
        if (F.freeT.includes(N.ax)) { const t = P.map((q) => dot(toLocal(F, q), g)); return { value: Math.max(...t) - Math.min(...t), detail: `plane, location free along ${'XYZ'[N.ax]} → orientation/form only (DRF ${F.text})` }; }
        let mx = 0; for (const q of P) mx = Math.max(mx, Math.abs(dot(sub(toLocal(F, q), b), g)));
        return { value: 2 * mx, detail: `plane, ${tag} (DRF ${F.text})` };
      }
      if (datumKind(f.type) === 'axis' && f.type !== 'Torus') {
        // members: the feature itself or the holes of a bolt-circle pattern; each member = derived median line
        // (or axis end points) in DRF-local coordinates around its nominal axis (TED point + nominal direction)
        const mlOf = (h: Feature): Vec3[] => { const hm = h.measured!, P = (h.type === 'Zylinder' || h.type === 'Kegel') ? ctx.points?.(h.id) ?? null : null;
          const ML = P && P.length >= 64 ? medianLine(hm, P) : []; if (ML.length >= 2) return ML.map((q) => toLocal(F, q));
          const L = h.type === 'Zylinder' || h.type === 'Kegel' ? hm.length || 0 : 0, a = unit(hm.normal);
          return [-0.5, 0.5].map((t) => toLocal(F, add(hm.center, scale(a, t * L)))); };
        const notes: string[] = []; let flag: string | undefined;
        const tFor = (h: Feature) => { if (!c.mod) return c.tolUp; const r = featBonus(c.mod, h, ctx); if ('flag' in r) { flag = r.flag; return c.tolUp; } notes.push(r.txt); return c.tolUp + r.b; };
        let members: PosMember[];
        if (isPattern(f)) {
          const hs = f.cons!.refs.map((id) => feats.get(id)).filter((h): h is Feature => !!h?.measured);
          if (hs.length !== f.cons!.refs.length) return { value: null, flag: 'pattern member deleted' };
          const n = hs.length, pitch = (2 * Math.PI) / n, R = B(5) / 2, al = B(6) * Math.PI / 180, i1 = (N.ax + 1) % 3, i2 = (N.ax + 2) % 3;
          const used = new Set<number>();
          members = hs.map((h) => { const l = toLocal(F, h.measured!.center), ang = Math.atan2(l[i2] - b[i2], l[i1] - b[i1]);
            const k = ((Math.round((ang - al) / pitch) % n) + n) % n; used.add(k);
            const nomP = add(b, add(scale(E3(i1), R * Math.cos(al + k * pitch)), scale(E3(i2), R * Math.sin(al + k * pitch))));
            return { ML: mlOf(h), nomP, g, t: tFor(h) }; });
          if (used.size !== n) return { value: null, flag: 'pattern members do not match the equal division – check Ø and start angle' };
        } else members = [{ ML: mlOf(f), nomP: b, g, t: tFor(f) }];
        if (flag) return { value: null, flag };
        // datum shift: datum features of size referenced at Ⓜ/Ⓛ may shift the DRF by half their departure from MMC/LMC
        let shiftR = 0;
        (c.datumMods ?? []).forEach((md, i) => { const dsf = ds[i]; if (!md || !dsf) return;
          const parts = isPattern(dsf) ? dsf.cons!.refs.map((id) => feats.get(id)).filter((h): h is Feature => !!h) : [dsf];
          let s = Infinity; for (const h of parts) { const r = featBonus(md, h, ctx); if ('flag' in r) { flag = r.flag; return; } s = Math.min(s, (r as any).b); notes.push('datum ' + (dsf.datum ?? '') + ' ' + r.txt.replace('bonus', 'shift')); }
          if (isFinite(s)) shiftR = Math.max(shiftR, s / 2); });
        if (flag) return { value: null, flag };
        const fr = { freeT: F.freeT.filter((i) => i !== N.ax).map(E3), freeR: F.freeR && (members.length > 1 || norm([b[0], b[1], 0]) > 1e-9), shiftR };
        const cz = c.cz !== false, res = evalPositionGroup(members, fr, cz), wi = res.worst;
        const dof = [...fr.freeT.map((e) => 'XYZ'[e.indexOf(1)]), ...(fr.freeR ? ['rot Z'] : []), ...(shiftR > 0 ? [`datum shift ≤ ${(2 * shiftR).toFixed(4)}`] : [])];
        const head = members.length > 1 ? `pattern of ${members.length} (${cz ? 'common zone CZ' : 'separate zones'}): Ø ${res.dia.map((d) => d.toFixed(4)).join(' / ')}, worst member ${wi + 1}` : `${members[0].ML.length > 2 ? `derived median line (${members[0].ML.length} sections)` : 'axis end points – no points'} in Ø zone around the ${tag}`;
        return { value: res.dia[wi], bonus: members[wi].t - c.tolUp || undefined, detail: `${head} (DRF ${F.text}${dof.length ? `, free: ${dof.join(', ')}` : ''})${notes.length ? ' · ' + notes.join(' · ') : ''}` };
      }
      return { value: 2 * norm(sub(loc, b)), detail: `spherical zone SØ (DRF ${F.text})` };
    }
    case 'Koaxialität': case 'Konzentrizität': case 'Rundlauf': case 'Gesamtrundlauf': {
      if (k0 !== 'axis' && !(kind === 'Konzentrizität' && k0 === 'point')) return { value: null, flag: 'datum must be an axis' };
      const g = dirOf(D0), pD = D0.measured!.center;
      const distLine = (q: Vec3) => norm(orth(sub(q, pD), g));
      if (kind === 'Konzentrizität') return { value: 2 * (k0 === 'point' ? norm(sub(m.center, pD)) : distLine(m.center)) };
      if (kind === 'Koaxialität') {
        const a = dirOf(f), L = m.length || 0;
        const P = f.type === 'Zylinder' || f.type === 'Kegel' ? pts() : null, ML = P && P.length >= 64 ? medianLine(m, P) : [];
        if (ML.length >= 2) return { value: 2 * Math.max(...ML.map(distLine)), detail: `derived median line (${ML.length} sections) in Ø zone around the datum axis` };
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
      const loc = toLocal(F, m.center), b: Vec3 = [B(0, loc[0]), B(1, loc[1]), B(2, loc[2])];
      const r = Math.max(Math.abs(m.maxPos), Math.abs(m.maxNeg));
      let dd = norm(sub(loc, b));
      if (f.type === 'Ebene') dd = Math.abs(dot(sub(loc, b), unit(dirLocal(F, dirOf(f)))));
      return { value: 2 * (r + dd), detail: 'obere Schranke: 2·(max. Formabw. + Lageabw. des Mittelpunkts)' };
    }
  }
}
