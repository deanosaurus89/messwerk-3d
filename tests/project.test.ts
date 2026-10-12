import { describe, expect, it } from 'vitest';
import { packIndices, readProject, unpackIndex, writeProject } from '../src/project';
describe('Projektdatei', () => {
  it('Round-Trip', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0.5, 0.5, 1]);
    const indices = new Uint32Array([0, 1, 2, 0, 1, 3]);
    const idx = packIndices({ 'f1': new Uint32Array([0, 1, 2]), 'f1aux': new Uint32Array([3]), 'f2': undefined });
    const json = { state: { features: [{ id: 1, name: 'Ebene 1', datum: 'A' }], controls: [{ id: 1, kind: 'Position', datumIds: [1], basic: [20, 20, 0] }] } };
    const bin = writeProject(json, { positions, indices }, idx);
    const r = readProject(bin);
    expect(Array.from(r.mesh.positions)).toEqual(Array.from(positions));
    expect(Array.from(r.mesh.indices)).toEqual(Array.from(indices));
    expect(Array.from(unpackIndex(r.idx, 'f1')!)).toEqual([0, 1, 2]);
    expect(Array.from(unpackIndex(r.idx, 'f1aux')!)).toEqual([3]);
    expect(unpackIndex(r.idx, 'f2')).toBeUndefined();
    expect(r.json.state.features[0].datum).toBe('A'); expect(r.json.state.controls[0].basic).toEqual([20, 20, 0]);
    expect(() => readProject(new Uint8Array([1, 2, 3]))).toThrow();
  });
});
