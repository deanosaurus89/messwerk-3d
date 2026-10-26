// Add region on the Multi-Feature plate: every further click is unioned in.
// A later zone refit that returns only the newest region must not drop points already chosen.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseSTL } from '../src/core/io';
import { MeshTopology, unionIndices } from '../src/core/region';
import type { Vec3 } from '../src/core/linalg';

const raw = gunzipSync(readFileSync('public/samples/multifeature.stl.gz'));
const mesh = parseSTL(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer, 'multifeature');
const topo = new MeshTopology(mesh);
const F = mesh.indices, P = mesh.positions, nt = F.length / 3;

function centroid(t: number): Vec3 {
  let x = 0, y = 0, z = 0;
  for (let k = 0; k < 3; k++) { const v = F[3 * t + k]; x += P[3 * v]; y += P[3 * v + 1]; z += P[3 * v + 2]; }
  return [x / 3, y / 3, z / 3];
}

describe('Add region on the Multi-Feature plate', () => {
  it('many clicks only add points; a refit of the newest region cannot drop the points already chosen', () => {
    let keep = new Uint32Array(0);
    let grew = 0;
    const step = Math.max(1, Math.floor(nt / 18));
    for (let s = 0, tri = Math.floor(nt / 7); s < 12; s++, tri = (tri + step) % nt) {
      const tris = topo.growRegion(tri, centroid(tri), { maxAngleDeg: 20, radius: 4, type: 'Ebene', seedR: 1.5 });
      if (tris.length < 6) continue;
      const v = topo.regionVertices(tris);
      const use = v.interior.length >= 12 ? v.interior : v.all;
      if (use.length < 12) continue;
      // zone / contour refit that kept only the new click
      const next = unionIndices(use, keep);
      const have = new Set<number>();
      for (let i = 0; i < next.length; i++) have.add(next[i]);
      for (let i = 0; i < keep.length; i++) expect(have.has(keep[i]), `click ${s} dropped vertex ${keep[i]}`).toBe(true);
      expect(next.length).toBeGreaterThanOrEqual(keep.length);
      if (next.length > keep.length) grew++;
      keep = new Uint32Array(next);
    }
    expect(grew).toBeGreaterThan(3);
    expect(keep.length).toBeGreaterThan(40);
  }, 180000);
});
