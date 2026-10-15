// Unified view on how a feature was created (provenance). The feature keeps its stored fields
// (method, cons, anchor, refs, aux, extraction params); provenanceOf() derives ONE tagged record from them,
// so dialogs, reports, recompute and future CAD references all read the same structure.
import type { Feature } from './features';
import type { Vec3 } from './linalg';

export interface ExtractParams { k?: number; maxAngleDeg?: number; radius?: number; aux?: 'auto' | 'ring' | 'none' | number; ring?: { gap: number; width: number }; nf?: { on: boolean; angleDeg: number; maxPct: number } }
export type Provenance =
  | { kind: 'mesh'; method: 'Klick' | 'Pinsel'; points: number; seed?: Vec3; params?: ExtractParams; aux?: { source: string; points: number; refId?: number } }
  | { kind: 'construction'; key: string; parents: number[]; params: Record<string, number>; error?: string }
  | { kind: 'anchor'; pts: Vec3[] }
  | { kind: 'distance'; parents: [number, number] }
  | { kind: 'cad'; ref: string };

/** Derive the provenance record; `extra` carries UI-side fields (seed hit, extraction parameters). */
export function provenanceOf(f: Feature, extra?: { seed?: Vec3; params?: ExtractParams }): Provenance {
  if (f.cons) return { kind: 'construction', key: f.cons.key, parents: [...f.cons.refs], params: { ...(f.cons.params ?? {}) }, error: f.cons.error };
  if (f.anchor || f.method === 'Anker') return { kind: 'anchor', pts: f.anchor?.pts ?? [] };
  if (f.type === 'Abstand' && f.refs?.length === 2) return { kind: 'distance', parents: [f.refs[0], f.refs[1]] };
  const method = f.method === 'Pinsel' ? 'Pinsel' : 'Klick';
  return { kind: 'mesh', method, points: f.pointCount, seed: extra?.seed, params: extra?.params,
    aux: f.aux ? { source: f.aux.source, points: f.aux.pointCount, refId: f.aux.refId } : undefined };
}
/** Parents a feature depends on (for recompute order, cascade delete and the 🔗 chain). */
export function parentsOf(f: Feature): number[] {
  const p = provenanceOf(f);
  if (p.kind === 'construction' || p.kind === 'distance') return [...p.parents];
  if (p.kind === 'mesh' && p.aux?.refId != null) return [p.aux.refId];
  return [];
}
