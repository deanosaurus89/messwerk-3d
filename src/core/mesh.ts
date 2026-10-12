// Polygonmodell (Ist-Daten): verschweißte Knoten, Dreiecke, Normalen, Nachbarschaften.
export interface MeshData {
  name: string;
  positions: Float32Array;   // 3*nv
  indices: Uint32Array;      // 3*nt (leer bei Punktwolke)
  vertexNormals?: Float32Array;
  faceNormals?: Float32Array; // 3*nt, Einheitsvektoren
  faceAreas?: Float32Array;
}

export const vertexCount = (m: MeshData) => m.positions.length / 3;
export const triCount = (m: MeshData) => m.indices.length / 3;

/** Doppelte Knoten (z. B. aus STL) über ein Raster zusammenführen. */
export function weld(tri: Float32Array, tol = 1e-5): { positions: Float32Array; indices: Uint32Array } {
  const n = tri.length / 3;
  const map = new Map<string, number>();
  const idx = new Uint32Array(n);
  const pos: number[] = [];
  const inv = 1 / tol;
  for (let i = 0; i < n; i++) {
    const x = tri[3 * i], y = tri[3 * i + 1], z = tri[3 * i + 2];
    const k = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
    let id = map.get(k);
    if (id === undefined) { id = pos.length / 3; map.set(k, id); pos.push(x, y, z); }
    idx[i] = id;
  }
  return { positions: new Float32Array(pos), indices: idx };
}

export function computeNormals(m: MeshData): void {
  const p = m.positions, f = m.indices, nt = f.length / 3, nv = p.length / 3;
  const fn = new Float32Array(3 * nt), fa = new Float32Array(nt), vn = new Float32Array(3 * nv);
  for (let t = 0; t < nt; t++) {
    const a = 3 * f[3 * t], b = 3 * f[3 * t + 1], c = 3 * f[3 * t + 2];
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    fa[t] = 0.5 * l;
    if (l > 0) { fn[3 * t] = nx / l; fn[3 * t + 1] = ny / l; fn[3 * t + 2] = nz / l; }
    for (const v of [a, b, c]) { vn[v] += nx; vn[v + 1] += ny; vn[v + 2] += nz; }
  }
  for (let v = 0; v < nv; v++) {
    const l = Math.hypot(vn[3 * v], vn[3 * v + 1], vn[3 * v + 2]) || 1;
    vn[3 * v] /= l; vn[3 * v + 1] /= l; vn[3 * v + 2] /= l;
  }
  m.faceNormals = fn; m.faceAreas = fa; m.vertexNormals = vn;
}

/** CSR: Knoten -> anliegende Dreiecke. */
export function vertexTriangles(m: MeshData): { offsets: Uint32Array; tris: Uint32Array } {
  const nv = m.positions.length / 3, f = m.indices;
  const cnt = new Uint32Array(nv + 1);
  for (let i = 0; i < f.length; i++) cnt[f[i] + 1]++;
  for (let i = 0; i < nv; i++) cnt[i + 1] += cnt[i];
  const fill = cnt.slice(0, nv);
  const tris = new Uint32Array(f.length);
  for (let i = 0; i < f.length; i++) tris[fill[f[i]]++] = (i / 3) | 0;
  return { offsets: cnt, tris };
}

export function bounds(m: MeshData) {
  const p = m.positions;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
    if (p[i + k] < mn[k]) mn[k] = p[i + k]; if (p[i + k] > mx[k]) mx[k] = p[i + k];
  }
  return { min: mn, max: mx, diag: Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) };
}
