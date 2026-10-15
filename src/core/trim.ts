// Trimmed feature geometry: the fitted surface restricted to the triangles of the selected points
// (all 3 vertices in the feature), each vertex projected onto the fitted element; plus the boundary contour.
import type { FitResult } from './fit';
import { Vec3, add, dot, norm, scale, sub, unit } from './linalg';

export const TRIM_TYPES = ['Ebene', 'Zylinder', 'Kugel', 'Kegel'];
export function projectOnto(f: FitResult, p: Vec3): Vec3 {
  const n = unit(f.normal), c = f.center;
  switch (f.type) {
    case 'Ebene': return sub(p, scale(n, dot(sub(p, c), n)));
    case 'Kugel': { const d = sub(p, c), l = norm(d) || 1; return add(c, scale(d, f.radius! / l)); }
    case 'Zylinder': case 'Kegel': {
      const q = sub(p, c), t = dot(q, n), r = sub(q, scale(n, t)), l = norm(r) || 1;
      const R = f.type === 'Kegel' ? Math.max(0, f.radius! + t * Math.tan(f.halfAngle ?? 0)) : f.radius!;
      return add(c, add(scale(n, t), scale(r, R / l)));
    }
    default: return p;
  }
}
/** sorted vertex indices of the feature → projected triangle soup + boundary edge segments */
export function trimmedSurface(f: FitResult, pos: ArrayLike<number>, tris: ArrayLike<number>, verts: Uint32Array, maxTris = 60000): { tri: Float32Array; edges: Float32Array } {
  const inSet = new Uint8Array(pos.length / 3); for (const v of verts) inSet[v] = 1;
  const sel: number[] = [];
  for (let t = 0; t < tris.length / 3; t++) if (inSet[tris[3 * t]] && inSet[tris[3 * t + 1]] && inSet[tris[3 * t + 2]]) sel.push(t);
  const step = Math.max(1, Math.ceil(sel.length / maxTris));
  const P = (v: number) => projectOnto(f, [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]]);
  const out: number[] = []; for (let i = 0; i < sel.length; i += step) { const t = sel[i]; for (let k = 0; k < 3; k++) out.push(...P(tris[3 * t + k])); }
  // boundary: edges used by exactly one selected triangle
  const cnt = new Map<string, [number, number, number]>();
  for (const t of sel) for (let k = 0; k < 3; k++) { const a = tris[3 * t + k], b = tris[3 * t + ((k + 1) % 3)], key = a < b ? a + ',' + b : b + ',' + a; const e = cnt.get(key); if (e) e[2]++; else cnt.set(key, [a, b, 1]); }
  const ed: number[] = []; for (const [a, b, c] of cnt.values()) if (c === 1) ed.push(...P(a), ...P(b));
  return { tri: new Float32Array(out), edges: new Float32Array(ed) };
}
