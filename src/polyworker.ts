// Eigener Worker für die Polygonbearbeitung: kann zum Abbrechen jederzeit beendet werden; meldet Fortschritt (Dreiecksanzahl live).
import { decimate, eraseAndFill, smooth, subdivide, RawMesh, DecimateResult } from './core/polyedit';
import { decimateParallel } from './core/decpar';

export type PolyReq =
  | { op: 'decimate'; mesh: RawMesh; tol: number; normalDeg?: number; featureDeg?: number; maxEdge?: number; minAngle?: number }
  | { op: 'subdivide'; mesh: RawMesh; tol: number; levels: number; maxEdge?: number }
  | { op: 'smooth'; mesh: RawMesh; iterations: number; lambda: number; tol: number }
  | { op: 'erase'; mesh: RawMesh; sel: Uint32Array }
  | { op: 'decChunk'; mesh: RawMesh; tol: number; normalDeg?: number; featureDeg?: number; maxEdge?: number; minAngle?: number };

/** ab dieser Größe parallel in Unter-Workern (Scheiben + Nahtdurchgang) */
const PAR_MIN = 150_000;
function parDecimate(req: Extract<PolyReq, { op: 'decimate' }>, onProgress: (t: number, d: number, i?: any) => void): Promise<DecimateResult> {
  const nt = req.mesh.indices.length / 3; const hc = (self.navigator as any)?.hardwareConcurrency ?? 4;
  const K = typeof Worker === 'undefined' || nt < PAR_MIN ? 1 : Math.max(2, Math.min(8, hc - 1, Math.ceil(nt / 40_000)));
  const o = { tol: req.tol, maxNormalDeg: req.normalDeg, featureDeg: req.featureDeg, maxEdge: req.maxEdge, minAngleDeg: req.minAngle };
  if (K === 1) return Promise.resolve(decimate(req.mesh, { ...o, onProgress, progressEvery: 5000 }));
  const fr = new Float64Array(K), tr = new Float64Array(K); const ws: Worker[] = [];
  return decimateParallel(req.mesh, o, K, (c, j) => new Promise<DecimateResult>((res, rej) => {
    const w = new Worker(new URL('./polyworker.ts', import.meta.url), { type: 'module' }); ws.push(w); tr[j] = c.indices.length / 3;
    w.onmessage = (ev) => { const d = ev.data; if (d.progress) { tr[j] = d.progress.tris;
        const t = tr.reduce((a, b) => a + b, 0); const f = Math.min(1, (nt - t) / (0.9 * nt)); onProgress(t, 0, { frac: 0.95 * f, step: 1, steps: 2, label: `Reduktion ×${K} Threads: ${Math.round(t).toLocaleString('de-DE')} △` }); return; }
      w.terminate(); if (d.error) rej(new Error(d.error)); else res(d.result); };
    w.postMessage({ id: j, req: { op: 'decChunk', mesh: c, tol: req.tol, normalDeg: req.normalDeg, featureDeg: req.featureDeg, maxEdge: req.maxEdge, minAngle: req.minAngle } }, [c.positions.buffer, c.indices.buffer]);
  })).then((r) => { onProgress(r.after, r.collapses, { frac: 1, step: 2, steps: 2, label: 'Nähte' }); return r; }).finally(() => ws.forEach((w) => w.terminate()));
}

self.onmessage = async (e: MessageEvent<{ id: number; req: PolyReq }>) => {
  const { id, req } = e.data; const t0 = performance.now();
  const onProgress = (tris: number, done: number, info?: any) => (self as any).postMessage({ id, progress: { tris, done, info } });
  try {
    let r: any;
    if (req.op === 'decimate') { r = await parDecimate(req, onProgress); delete r.vmap; }
    else if (req.op === 'decChunk') r = decimate(req.mesh, { tol: req.tol, maxNormalDeg: req.normalDeg, featureDeg: req.featureDeg, maxEdge: req.maxEdge, minAngleDeg: req.minAngle, onProgress, progressEvery: 5000 });
    else if (req.op === 'subdivide') r = subdivide(req.mesh, { tol: req.tol, levels: req.levels, maxEdge: req.maxEdge, onProgress });
    else if (req.op === 'smooth') r = smooth(req.mesh, { iterations: req.iterations, lambda: req.lambda, tol: req.tol, onProgress });
    else r = eraseAndFill(req.mesh, req.sel);
    r.ms = performance.now() - t0;
    (self as any).postMessage({ id, result: r }, [r.positions.buffer, r.indices.buffer, ...(r.vmap ? [r.vmap.buffer] : [])]);
  } catch (err: any) { (self as any).postMessage({ id, error: String(err?.message ?? err) }); }
};
