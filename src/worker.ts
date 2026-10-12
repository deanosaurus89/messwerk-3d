// Web Worker: Parsen, Topologie, Regionenwachstum, Pinsel und Fits laufen hier (UI bleibt flüssig).
import { parseByName } from './core/io';
import { MeshData, bounds } from './core/mesh';
import { MeshTopology, brushSelect, gather } from './core/region';
import { autoFit, fitType, FitResult, GeomType, normalFilter, NormalFilter } from './core/fit';
import type { Vec3 } from './core/linalg';
import { autoExtract, extractWithAuxPlane } from './core/aux';
import { computeNormals } from './core/mesh';

let mesh: MeshData | null = null;
let topo: MeshTopology | null = null;

export type Req =
  | { op: 'load'; name: string; buffer: ArrayBuffer }
  | { op: 'loadRaw'; name: string; positions: Float32Array; indices: Uint32Array }
  | { op: 'grow'; tri: number; point: Vec3; maxAngleDeg: number; radius: number; type: GeomType | 'auto' }
  | { op: 'brush'; center: Vec3; radius: number; facing: Vec3 }
  | { op: 'fit'; indices: Uint32Array; type: GeomType | 'auto'; params?: FitParams }
  | { op: 'aux'; tri: number; point: Vec3; maxAngleDeg: number; type: 'Kreis' | 'Langloch'; plane?: FitResult };

export interface FitParams { k: number; nf?: NormalFilter | null; }
function fitWithParams(idx: Uint32Array, type: GeomType, prm: FitParams) {
  let { p, n } = gather(mesh!, idx);
  if (p.length < 3) throw new Error('Zu wenige Punkte ausgewählt');
  let fit = fitType(type, p, n, prm.k), use = idx, removed = 0;
  if (prm.nf && n.length === p.length) {
    const keep = normalFilter(fit, p, n, prm.nf);
    removed = p.length - keep.length;
    if (removed && keep.length >= 6) {
      use = Uint32Array.from(keep, (i) => idx[i]); p = keep.map((i) => p[i]); n = keep.map((i) => n[i]);
      fit = fitType(type, p, n, prm.k);
    } else removed = 0;
  }
  delete fit.residuals; fit.n = use.length; fit.nfRemoved = removed;
  return { indices: use, fit, candidates: [] };
}
function doFit(idx: Uint32Array, type: GeomType | 'auto'): { fit: FitResult; candidates: { type: string; rms: number }[] } {
  const { p, n } = gather(mesh!, idx);
  if (p.length < 3) throw new Error('Zu wenige Punkte ausgewählt');
  let fit: FitResult, cands: FitResult[] = [];
  if (type === 'auto') { const r = autoFit(p, n); fit = r.best; cands = r.candidates; }
  else fit = fitType(type, p, n);
  delete fit.residuals;
  fit.n = idx.length;
  return { fit, candidates: cands.map((c) => ({ type: c.type, rms: c.rms })) };
}

self.onmessage = (e: MessageEvent<{ id: number; req: Req }>) => {
  const { id, req } = e.data;
  const t0 = performance.now();
  try {
    let result: any, transfer: Transferable[] = [];
    if (req.op === 'load' || req.op === 'loadRaw') {
      if (req.op === 'load') mesh = parseByName(req.name, req.buffer);
      else { mesh = { name: req.name, positions: req.positions, indices: req.indices }; if (mesh.indices.length) computeNormals(mesh); }
      topo = mesh.indices.length ? new MeshTopology(mesh) : null;
      const b = bounds(mesh);
      const positions = mesh.positions.slice(), indices = mesh.indices.slice();
      const normals = mesh.vertexNormals ? mesh.vertexNormals.slice() : null;
      result = { name: mesh.name, positions, indices, normals, bounds: b, vertexCount: positions.length / 3, triCount: indices.length / 3 };
      transfer = [positions.buffer, indices.buffer, ...(normals ? [normals.buffer] : [])];
    } else if (req.op === 'grow') {
      if (!topo) throw new Error('Regionenwachstum benötigt ein Polygonmodell (Dreiecke). Für Punktwolken den Pinsel verwenden.');
      if (req.type === 'auto') {
        const r = autoExtract(mesh!, topo, req.tri, req.point, { maxAngleDeg: req.maxAngleDeg, radius: req.radius }, bounds(mesh!).diag);
        delete r.fit.residuals; r.fit.n = r.indices.length; if (r.aux) delete r.aux.plane.residuals;
        result = r;
      } else {
        const tris = topo.growRegion(req.tri, req.point, { maxAngleDeg: req.maxAngleDeg, radius: req.radius });
        const v = topo.regionVertices(tris);
        const use = v.interior.length >= 20 ? v.interior : v.all;
        result = { indices: use, ...doFit(use, req.type) };
      }
    } else if (req.op === 'aux') {
      if (!topo) throw new Error('Hilfsebene benötigt ein Polygonmodell (Dreiecke).');
      const r = extractWithAuxPlane(mesh!, topo, req.tri, req.point, { maxAngleDeg: req.maxAngleDeg, radius: 0 }, req.type, req.plane);
      result = { indices: r.wallIdx, fit: r.fit, candidates: [], aux: { plane: r.plane, indices: r.planeIdx } };
    } else if (req.op === 'brush') {
      result = { indices: brushSelect(mesh!, req.center, req.radius, req.facing) };
    } else if (req.op === 'fit') {
      result = req.params && req.type !== 'auto' ? fitWithParams(req.indices, req.type, req.params) : { indices: req.indices, ...doFit(req.indices, req.type) };
    }
    result.ms = performance.now() - t0;
    (self as any).postMessage({ id, result }, transfer);
  } catch (err: any) {
    (self as any).postMessage({ id, error: String(err?.message ?? err) });
  }
};
