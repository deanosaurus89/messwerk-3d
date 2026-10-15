import { describe, expect, it } from 'vitest';
import { provenanceOf, parentsOf } from '../src/core/provenance';
import type { Feature } from '../src/core/features';
const base = (o: Partial<Feature>): Feature => ({ id: 1, name: 'x', type: 'Ebene', pointCount: 10, method: 'Klick', ...o });
describe('provenance', () => {
  it('mesh click with aux plane reference', () => {
    const p = provenanceOf(base({ type: 'Kreis', aux: { plane: {} as any, pointCount: 50, source: 'Plane 1', refId: 7 } }), { params: { maxAngleDeg: 20 } });
    expect(p.kind).toBe('mesh'); expect(parentsOf(base({ aux: { plane: {} as any, pointCount: 5, source: 's', refId: 7 } }))).toEqual([7]);
  });
  it('construction', () => { const f = base({ method: 'Konstruiert', cons: { key: 'ln-2pts', refs: [2, 3] } }); expect(provenanceOf(f).kind).toBe('construction'); expect(parentsOf(f)).toEqual([2, 3]); });
  it('anchor keeps its points', () => { const f = base({ method: 'Anker', anchor: { pts: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], nrm: [] } }); const p = provenanceOf(f); expect(p.kind === 'anchor' && p.pts.length).toBe(3); expect(parentsOf(f)).toEqual([]); });
  it('distance', () => { const f = base({ type: 'Abstand', method: 'Konstruiert', refs: [4, 5] }); expect(provenanceOf(f)).toEqual({ kind: 'distance', parents: [4, 5] }); });
});
