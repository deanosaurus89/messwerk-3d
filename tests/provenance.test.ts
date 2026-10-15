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

import { dependentsOf, hardParentsOf } from '../src/core/provenance';
describe('cascade via provenance', () => {
  const F = (id: number, x: any = {}) => ({ id, type: 'Ebene', name: 'f' + id, pointCount: 0, indices: new Uint32Array(0), ...x }) as any;
  const fs = [F(1), F(2), F(3, { type: 'Abstand', refs: [1, 2] }), F(4, { cons: { key: 'mid', refs: [3, 2] }, refs: [3, 2] }), F(5, { aux: { source: 'f1', pointCount: 9, refId: 1 } })];
  it('deleting 1 removes the distance and the chained construction, keeps the aux-referencing mesh feature', () => {
    expect([...dependentsOf(fs, [1])].sort()).toEqual([1, 3, 4]);
    expect(hardParentsOf(fs[4])).toEqual([]); expect(hardParentsOf(fs[3])).toEqual([3, 2]);
  });
});
