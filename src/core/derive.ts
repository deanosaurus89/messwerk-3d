// Derive feature from Analyze: dependent geometry computed from a parent feature's points and stored as its own
// feature in the tree (chain icon 🔗). It is recomputed whenever the parent changes (same pass as constructions).
//  - zone-upper / zone-lower (plane): the two planes of the minimum-zone flatness zone (ISO 1101/12781);
//  - median-line (cylinder/cone): the derived median line (ISO 12180-1) as a Polyline;
//  - mz-axis (cylinder/cone): axis of the minimum-zone straightness zone of the median line, as a Line.
import type { FitResult, GeomType } from './fit';
import type { Feature } from './features';
import { Vec3, add, dot, norm, scale, sub, unit } from './linalg';
import { floatZone, medianLine, straightnessMZ } from './median';
import { tangentPlane } from './datumsim';

export type DeriveKey = 'zone-upper' | 'zone-lower' | 'median-line' | 'mz-axis';
export const DERIVES: { key: DeriveKey; out: GeomType; label: string; from: GeomType[] }[] = [
  { key: 'zone-upper', out: 'Ebene', label: 'Flatness zone – upper plane', from: ['Ebene'] },
  { key: 'zone-lower', out: 'Ebene', label: 'Flatness zone – lower plane', from: ['Ebene'] },
  { key: 'median-line', out: 'Linienzug', label: 'Derived median line (Polyline)', from: ['Zylinder', 'Kegel'] },
  { key: 'mz-axis', out: 'Linie', label: 'Minimum-zone axis of the median line (Line)', from: ['Zylinder', 'Kegel'] },
];
export const derivesFor = (t: GeomType) => DERIVES.filter((d) => d.from.includes(t));
const stats = { rms: 0, form: 0, maxPos: 0, maxNeg: 0 };

export function runDerive(key: string, parent: Feature, P: Vec3[] | null): FitResult {
  const m = parent.measured; if (!m) throw new Error('Parent feature has no geometry');
  if (!P || P.length < 8) throw new Error('Parent feature has no points');
  if (key === 'zone-upper' || key === 'zone-lower') {
    const t = tangentPlane(P, m.normal), n = t.n, c0 = t.c - t.width, lev = key === 'zone-upper' ? t.c : c0;
    const center = add(m.center, scale(n, lev - dot(m.center, n)));
    return { ...stats, type: 'Ebene', center, normal: dot(n, m.normal) < 0 ? scale(n, -1) : n, n: P.length, form: 0, width: t.width } as FitResult;
  }
  const ML = medianLine(m, P); if (ML.length < 2) throw new Error('Too few sections for a median line');
  if (key === 'median-line') {
    let L = 0; for (let i = 1; i < ML.length; i++) L += norm(sub(ML[i], ML[i - 1]));
    const center = scale(ML.reduce((s, p) => add(s, p), [0, 0, 0] as Vec3), 1 / ML.length);
    return { ...stats, type: 'Linienzug', center, normal: unit(sub(ML[ML.length - 1], ML[0])), pts: ML, length: L, n: ML.length };
  }
  if (key === 'mz-axis') {
    const st = straightnessMZ(ML, m.normal), d = st.dir, fz = floatZone(ML, d);
    const ts = ML.map((p) => dot(p, d)), t0 = Math.min(...ts), t1 = Math.max(...ts);
    const center = add(fz.centre, scale(d, (t0 + t1) / 2));
    return { ...stats, type: 'Linie', center, normal: d, direction: d, length: t1 - t0, n: ML.length, form: st.dia };
  }
  throw new Error('Unknown derivation');
}
