// Feature data model (Martin, 19.10.2026 – research/architecture.md):
//   Feature = placeholder node in the tree {id, name, type, deps (refs/cons/derived), datum, display}
//     ├─ ist  (actual)  – source 'mesh' | 'extracted' (later: from the nominal) | 'constructed' (from other features):
//     │                   selection + points, fit, aux plane, extraction params, re-extraction, stats
//     └─ soll (nominal) – reserved: geometry only from CAD (no numeric entry), NOT implemented yet
// Controls, datums, coordinate systems, constructions, report and annotations reference the feature NODE (id) and use
// its chosen state (today always Ist).
//
// Transitional accessors: the former flat fields (measured, pointCount, method, aux, …) are non-enumerable get/set
// properties on the node that read/write node.ist, so existing call sites keep working unchanged while the data lives in
// Ist. New code should use node.ist (or actualOf) directly.
import type { FitResult } from './fit';

export type IstSource = 'mesh' | 'extracted' | 'constructed';
export interface IstState {
  source: IstSource;
  /** fitted actual geometry (formerly Feature.measured) */
  fit?: FitResult;
  pointCount: number;
  /** how the actual points were selected: Klick | Pinsel | Anker | Konstruiert | Abgeleitet */
  method: string;
  [k: string]: unknown; // aux, reex, anchor, fp, hit + runtime point sets (indices, src, auxIndices, dev, candidates)
}
/** reserved for the CAD phase (P6): nominal geometry from CAD only */
export interface SollState { source: 'cad'; fit?: FitResult }

/** flat (pre-0.28) field name → Ist field name */
export const IST_FIELDS: Record<string, string> = {
  measured: 'fit', pointCount: 'pointCount', method: 'method', aux: 'aux', reex: 'reex', anchor: 'anchor', fp: 'fp', hit: 'hit', frozen: 'frozen',
  indices: 'indices', src: 'src', auxIndices: 'auxIndices', dev: 'dev', candidates: 'candidates',
};
/** Ist fields that are runtime point sets (stored in the binary index blob, not in the project JSON) */
export const IST_RUNTIME = ['indices', 'src', 'auxIndices', 'dev', 'candidates'];
/** feature model of the project JSON (also in autosaves): 1 = flat features (≤ 0.27), 2 = feature node + ist (0.28).
 *  The project file version (project.ts VERSION) was bumped to 2 with it. */
export const FEATURE_MODEL = 2;

const sourceOf = (method: unknown): IstSource => (method === 'Konstruiert' || method === 'Abgeleitet' ? 'constructed' : 'mesh');

function defineAccessors(n: any) {
  for (const [k, ik] of Object.entries(IST_FIELDS))
    Object.defineProperty(n, k, { get() { return this.ist[ik]; }, set(v) { this.ist[ik] = v; }, enumerable: false, configurable: false });
}

/** Converts a feature IN PLACE into a node with an Ist child (flat ≤ 0.27 object, or a node whose accessors were lost by
 *  a spread/copy). Identity is kept (maps keyed by the feature object stay valid). Idempotent. */
export function asNode<T extends object>(f: T): T {
  const n = f as any;
  const d = Object.getOwnPropertyDescriptor(n, 'measured');
  if (n.ist && d && d.get) return f; // already a node
  const ist: IstState = n.ist && typeof n.ist === 'object' ? { ...n.ist } : ({} as IstState);
  for (const [k, ik] of Object.entries(IST_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(n, k)) { const v = n[k]; delete n[k]; if (!(ik in ist) || ist[ik] === undefined) ist[ik] = v; }
  }
  if (!ist.source) ist.source = sourceOf(ist.method);
  if (ist.pointCount === undefined) ist.pointCount = 0;
  n.ist = ist;
  defineAccessors(n);
  return f;
}

/** Copy of a node with another actual fit (e.g. ISO 5459 datum simulation) – a proper node again. */
export function withActualFit<T extends object>(f: T, fit: FitResult): T {
  const n = f as any;
  if (!n.ist) return { ...n, measured: fit };
  const c: any = {}; for (const k of Object.keys(n)) c[k] = n[k];
  c.ist = { ...n.ist, fit };
  return asNode(c);
}

/** Project JSON of a node: node fields + ist without the runtime point sets. */
export function nodeToJSON(f: object): Record<string, unknown> {
  const n = f as any, o: Record<string, unknown> = {};
  for (const k of Object.keys(n)) if (k !== 'ist') o[k] = n[k];
  const ist: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n.ist ?? {})) if (!IST_RUNTIME.includes(k) && v !== undefined) ist[k] = v;
  o.ist = ist;
  if (n.soll) o.soll = n.soll;
  return o;
}

/** Project migration: model 1 (flat features) → nodes; model 2 passes through (per feature: an existing ist is kept). Returns new objects. */
export function migrateFeatures(list: any[], model: number | undefined): any[] {
  return list.map((f) => {
    const c: any = {}; for (const k of Object.keys(f)) c[k] = f[k];
    if ((model ?? 1) >= 2 && c.ist) c.ist = { ...c.ist };
    return asNode(c);
  });
}
