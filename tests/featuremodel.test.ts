// 0.28 feature-model refactoring: Feature node + Ist. Old (format 1, ≤ 0.27) project files migrate losslessly;
// format 2 roundtrips; the transitional accessors read/write Ist.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readProject } from '../src/project';
import { asNode, migrateFeatures, nodeToJSON, withActualFit, IST_FIELDS, IST_RUNTIME, FEATURE_MODEL } from '../src/core/featuremodel';

const buf = readFileSync(new URL('../e2e/baseline/model-lock-0.27.mw3d', import.meta.url));
const old = readProject(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)).json;
const flat: any[] = old.state.features;
const persisted = Object.keys(IST_FIELDS).filter((k) => !IST_RUNTIME.includes(k));

describe('feature node + Ist', () => {
  it('the 0.27 fixture is version 1 with flat features', () => {
    expect(old.version).toBe(1); expect(old.featureModel).toBeUndefined();
    expect(flat.length).toBe(12);
    expect(flat.every((f) => 'measured' in f && !('ist' in f))).toBe(true);
  });
  it('migrates format 1 → nodes without losing a value', () => {
    const nodes = migrateFeatures(flat, old.featureModel);
    nodes.forEach((n, i) => {
      const f = flat[i];
      expect(n.ist.source).toBe(f.method === 'Konstruiert' || f.method === 'Abgeleitet' ? 'constructed' : 'mesh');
      for (const k of persisted) expect(n[k]).toEqual(f[k]);                 // accessors give the old values
      for (const k of Object.keys(f)) if (!(k in IST_FIELDS)) expect(n[k]).toEqual(f[k]); // node fields unchanged
      expect(Object.keys(n).some((k) => k in IST_FIELDS)).toBe(false);       // nothing flat left
      expect(n.ist.fit).toEqual(f.measured);
    });
    expect(flat[0].ist).toBeUndefined(); // input not mutated
  });
  it('model 2 JSON roundtrip is lossless and idempotent', () => {
    const nodes = migrateFeatures(flat, 1);
    const j = JSON.parse(JSON.stringify(nodes.map(nodeToJSON)));
    expect(j.every((f: any) => f.ist && !('measured' in f) && !('indices' in f.ist))).toBe(true);
    const back = migrateFeatures(j, FEATURE_MODEL);
    back.forEach((n, i) => { for (const k of persisted) expect(n[k]).toEqual(nodes[i][k]); });
    expect(JSON.stringify(back.map(nodeToJSON))).toBe(JSON.stringify(j));
  });
  it('accessors write into Ist; asNode keeps identity; withActualFit copies', () => {
    const f: any = { id: 1, name: 'Plane 1', type: 'Ebene', measured: { type: 'Ebene', rms: 1 }, pointCount: 5, method: 'Klick', indices: new Uint32Array([1, 2]) };
    const n = asNode(f); expect(n).toBe(f); expect(asNode(n)).toBe(n);
    n.pointCount = 7; expect(n.ist.pointCount).toBe(7);
    n.reex = { maxDist: 1 }; expect(n.ist.reex).toEqual({ maxDist: 1 });
    const c: any = withActualFit(n, { type: 'Ebene', rms: 2 } as any);
    expect(c.measured.rms).toBe(2); expect(n.measured.rms).toBe(1); expect(c.pointCount).toBe(7); expect(c.indices).toBe(n.indices); expect(c.ist).not.toBe(n.ist);
    expect(nodeToJSON(n).ist).not.toHaveProperty('indices');
  });
});
