// Eigener Worker für die Polygonbearbeitung: kann zum Abbrechen jederzeit beendet werden; meldet Fortschritt (Dreiecksanzahl live).
import { decimate, eraseAndFill, smooth, subdivide, RawMesh } from './core/polyedit';

export type PolyReq =
  | { op: 'decimate'; mesh: RawMesh; tol: number }
  | { op: 'subdivide'; mesh: RawMesh; tol: number; levels: number }
  | { op: 'smooth'; mesh: RawMesh; iterations: number; lambda: number; tol: number }
  | { op: 'erase'; mesh: RawMesh; sel: Uint32Array };

self.onmessage = (e: MessageEvent<{ id: number; req: PolyReq }>) => {
  const { id, req } = e.data; const t0 = performance.now();
  const onProgress = (tris: number, done: number) => (self as any).postMessage({ id, progress: { tris, done } });
  try {
    let r: any;
    if (req.op === 'decimate') r = decimate(req.mesh, { tol: req.tol, onProgress, progressEvery: 5000 });
    else if (req.op === 'subdivide') r = subdivide(req.mesh, { tol: req.tol, levels: req.levels, onProgress });
    else if (req.op === 'smooth') r = smooth(req.mesh, { iterations: req.iterations, lambda: req.lambda, tol: req.tol, onProgress });
    else r = eraseAndFill(req.mesh, req.sel);
    r.ms = performance.now() - t0;
    (self as any).postMessage({ id, result: r }, [r.positions.buffer, r.indices.buffer]);
  } catch (err: any) { (self as any).postMessage({ id, error: String(err?.message ?? err) }); }
};
