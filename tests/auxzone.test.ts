// Phase 1 step 6 (0.32): aux-plane zone – annulus (circle) / stadium band (slot) with offset + width. The selection
// (aux.ts) and the live display (zoneLoops) use the same distance function; on the demo part the ring/band keeps the size.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { samplePath } from './samplePath';
import { parseSTL } from '../src/core/io';
import { MeshTopology } from '../src/core/region';
import { extractWithAuxPlane } from '../src/core/aux';
import { contourOffset, inZone, zoneLoops } from '../src/core/auxzone';
import type { FitResult } from '../src/core/fit';
import type { Vec3 } from '../src/core/linalg';

const plane = { type: 'Ebene', center: [0, 0, 20], normal: [0, 0, 1] } as unknown as FitResult;
describe('zone geometry', () => {
  const circ = { type: 'Kreis', center: [5, 5, 20], normal: [0, 0, 1], radius: 3 } as unknown as FitResult;
  const slot = { type: 'Langloch', center: [20, 45, 20], normal: [0, 0, 1], direction: [1, 0, 0], length: 30, width: 10, radius: 5 } as unknown as FitResult;
  for (const [name, f] of [['circle', circ], ['slot', slot]] as const) it(`${name}: loops lie exactly at offset and offset + width`, () => {
    const [a, b] = zoneLoops(f, plane, 0.5, 2);
    for (const p of a) expect(contourOffset(f, plane, p)).toBeCloseTo(0.5, 9);
    for (const p of b) expect(contourOffset(f, plane, p)).toBeCloseTo(2.5, 9);
    for (const p of a) expect(p[2]).toBeCloseTo(20, 9);
  });
  it('slot: band follows the straight sides and the arcs', () => {
    expect(contourOffset(slot, plane, [20, 51, 20])).toBeCloseTo(1, 9);     // beside the straight side
    expect(contourOffset(slot, plane, [37, 45, 20])).toBeCloseTo(2, 9);     // beyond the arc end (10 + 5 + 2)
    expect(inZone(slot, plane, [20, 51, 20], 0.5, 2)).toBe(true); expect(inZone(slot, plane, [20, 49, 20], 0.5, 2)).toBe(false);
  });
});

describe('ring / band zone on the demo part', () => {
  const buf = readFileSync(samplePath('beispielteil.stl'));
  const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'beispielteil'), topo = new MeshTopology(mesh);
  const seed = (pt: Vec3) => { let best = -1, bd = Infinity; const P = mesh.positions, F = mesh.indices;
    for (let t = 0; t < F.length / 3; t++) { if (mesh.faceNormals![3 * t + 2] < 0.9) continue; const v = F[3 * t], d = Math.hypot(P[3 * v] - pt[0], P[3 * v + 1] - pt[1], P[3 * v + 2] - pt[2]); if (d < bd) { bd = d; best = t; } } return best; };
  for (const [type, pt, size] of [['Kreis', [20, 26.84, 20], 12.08], ['Langloch', [20, 39.2, 20], 10]] as const) it(`${type}: zone keeps only plane points inside the band, size unchanged`, () => {
    const o = { maxAngleDeg: 20, radius: 0 };
    const full = extractWithAuxPlane(mesh, topo, seed(pt as Vec3), pt as Vec3, o, type);
    const ring = extractWithAuxPlane(mesh, topo, seed(pt as Vec3), pt as Vec3, o, type, undefined, Infinity, { gap: 0.5, width: 3 });
    expect(ring.planeIdx.length).toBeGreaterThan(100); expect(ring.planeIdx.length).toBeLessThan(full.planeIdx.length);
    const P = mesh.positions;
    for (const v of ring.planeIdx) { const x = contourOffset(full.fit, full.plane, [P[3 * v], P[3 * v + 1], P[3 * v + 2]]); expect(x).toBeGreaterThanOrEqual(0.5 - 1e-6); expect(x).toBeLessThanOrEqual(3.5 + 1e-6); }
    const s = type === 'Kreis' ? ring.fit.diameter ?? 2 * ring.fit.radius! : ring.fit.width!;
    expect(Math.abs(s - size)).toBeLessThan(0.01);
  });
});
