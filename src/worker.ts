// Web Worker: Parsen, Topologie, Regionenwachstum, Pinsel und Fits laufen hier (UI bleibt flüssig).
import { fillOuterBoundary, FillParams, insetPlane } from './core/fillplane';
import { reextract, ReexParams } from './core/reextract';
import { parseByName } from './core/io';
import { MeshData, bounds } from './core/mesh';
import { MeshTopology, brushSelect, gather } from './core/region';
import { autoFit, fitType, FitResult, GeomType, modelNormal, normalFilter, NormalFilter, signedDistance } from './core/fit';
import type { Vec3 } from './core/linalg';
import { autoExtract, extractLine, extractWithAuxPlane } from './core/aux';
import { computeNormals } from './core/mesh';
import { NurbsParams, boundaryLoop, evalSurface, fitFreeform } from './core/nurbs';
import { buildBVH, compareToOriginal } from './core/polyedit';
import * as THREE from 'three';
import { EdgeGraph, detectCurves, layout as curveLayout, makeCurve, pathThrough, curveFromCtrl, splitCurve, joinCurves, CurveKind, DetectOptions, LayoutOptions, CleanOptions } from './core/curves';

/** Freiformfläche aus Auswahl (Indizes) oder Klick (Regionenwachstum; Krümmungsband/Knickprüfung stoppen an Verrundungen). */
function doNurbs(req: { indices?: Uint32Array; seed?: { tri: number; point: Vec3; maxAngleDeg: number; radius: number }; params: NurbsParams }) {
  let idx = req.indices;
  if (req.seed) {
    if (!topo) throw new Error('Region growing needs a polygon model. Use the brush for point clouds.');
    idx = topo.regionVertices(topo.growRegion(req.seed.tri, req.seed.point, { maxAngleDeg: req.seed.maxAngleDeg, radius: req.seed.radius, type: 'Freiformfläche' })).all;
  }
  if (!idx || idx.length < 16) throw new Error('Too few points for a freeform surface');
  const { p, n } = gather(mesh!, idx, Infinity);
  const P = mesh!.positions;
  const loop: Vec3[] | null = mesh!.indices.length ? boundaryLoop(mesh!.indices, idx, P.length / 3).map((v) => [P[3 * v], P[3 * v + 1], P[3 * v + 2]] as Vec3) : null;
  const f = fitFreeform(p, n, loop, req.params);
  const center = evalSurface(f.surface, 0.5, 0.5, 0)[0];
  const fit: FitResult = { type: 'Freiformfläche', center, normal: f.frame.n, rms: f.rms, form: f.form, maxPos: f.maxPos, maxNeg: f.maxNeg, n: f.n,
    nurbs: { surface: f.surface, boundary: f.boundary, kind: f.kind, trimUV: f.trimUV, corners: f.corners, params: req.params, std: f.std, mean: f.mean } };
  return { indices: idx, fit, candidates: [], dev: f.dev, loopCount: loop?.length ?? 0 };
}

let mesh: MeshData | null = null;
let topo: MeshTopology | null = null;
/** Unverändertes Original (für Farbvergleich und „Original wiederherstellen“). */
let orig: { positions: Float32Array; indices: Uint32Array } | null = null;
let origBVH: ReturnType<typeof buildBVH> | null = null;
let eg: EdgeGraph | null = null, ebvh: ReturnType<typeof buildBVH> | null = null;
const curveCtx = () => { if (!eg) { eg = new EdgeGraph(mesh!); ebvh = buildBVH({ positions: mesh!.positions, indices: mesh!.indices }); } return { g: eg, bvh: ebvh! }; };
const slim = (c: any) => ({ kind: c.kind, chain: c.chain, closed: c.closed, ctrl: c.ctrl, pts: c.pts, length: c.length });
function layoutOut(chains: number[][], opts: LayoutOptions = {}) {
  const { g, bvh } = curveCtx(); const L = curveLayout(g, chains.map((chain) => ({ chain })), opts);
  const suggestions = L.suggestions.map((s) => ({ reason: s.reason, region: s.region, ...slim(makeCurve(g, bvh, s.chain, 'Vorschlag')) }));
  return { nodes: L.nodes, corners: L.corners, suggestions, regions: L.regions, regionOf: L.regionOf, tJunctions: L.tJunctions, foursided: L.foursided };
}

/** Bearbeitetes Netz übernehmen; Merkmals-Indexlisten auf die nächsten Knoten des neuen Netzes umrechnen (sortiert, eindeutig). */
function setMesh(positions: Float32Array, indices: Uint32Array, remap: (Uint32Array | null)[]) {
  const old = mesh!;
  const nm: MeshData = { name: old.name, positions, indices }; computeNormals(nm);
  const bvh = buildBVH(nm); const p = new THREE.Vector3(); const tgt: any = {};
  const cache = new Map<number, number>();
  const nearest = (v: number) => {
    let r = cache.get(v); if (r !== undefined) return r;
    p.set(old.positions[3 * v], old.positions[3 * v + 1], old.positions[3 * v + 2]);
    const h = bvh.closestPointToPoint(p, tgt); r = 0;
    if (h) { let bd = Infinity; for (let k = 0; k < 3; k++) { const w = indices[3 * h.faceIndex + k]; const d = (positions[3 * w] - p.x) ** 2 + (positions[3 * w + 1] - p.y) ** 2 + (positions[3 * w + 2] - p.z) ** 2; if (d < bd) { bd = d; r = w; } } }
    cache.set(v, r); return r;
  };
  const out = remap.map((L) => (L ? Uint32Array.from(new Set(Array.from(L, nearest))).sort() : null));
  mesh = nm; topo = new MeshTopology(nm); eg = null; ebvh = null;
  return out;
}

export type Req =
  | { op: 'load'; name: string; buffer: ArrayBuffer }
  | { op: 'loadRaw'; name: string; positions: Float32Array; indices: Uint32Array }
  | { op: 'setMesh'; positions: Float32Array; indices: Uint32Array; remap: (Uint32Array | null)[]; chains?: number[][]; kinds?: string[] }
  | { op: 'curvesDetect'; opts?: DetectOptions & CleanOptions; layout?: LayoutOptions }
  | { op: 'curvePath'; verts: number[]; closed?: boolean }
  | { op: 'curveLayout'; chains: number[][]; opts?: LayoutOptions }
  | { op: 'curveFromCtrl'; ctrl: [number, number, number][]; kind: CurveKind; closed?: boolean }
  | { op: 'curveSplit'; curve: { chain: number[]; kind: CurveKind }; p: [number, number, number] }
  | { op: 'curveJoin'; a: { chain: number[]; kind: CurveKind }; b: { chain: number[] } }
  | { op: 'compare' }
  | { op: 'getOriginal' }
  | { op: 'grow'; tri: number; point: Vec3; maxAngleDeg: number; radius: number; type: GeomType | 'auto'; seedR?: number }
  | { op: 'brush'; center: Vec3; radius: number; facing: Vec3 }
  | { op: 'nurbs'; indices?: Uint32Array; seed?: { tri: number; point: Vec3; maxAngleDeg: number; radius: number }; params: NurbsParams }
  | { op: 'fit'; indices: Uint32Array; type: GeomType | 'auto'; params?: FitParams }
  | { op: 'aux'; tri: number; point: Vec3; maxAngleDeg: number; type: 'Kreis' | 'Langloch'; plane?: FitResult; ring?: { gap: number; width: number }; fill?: FillParams | null; seedR?: number }
  | { op: 'dev'; indices: Uint32Array; fit: FitResult }
  | { op: 'reex'; fit: FitResult; indices: Uint32Array; params: ReexParams; seedPts?: Vec3[] }
  | { op: 'auxLine'; tri: number; point: Vec3; maxAngleDeg: number; side: 0 | 1; plane?: FitResult; ring?: { gap: number; width: number }; fill?: FillParams | null };

/** automatic search distance of All inside boundary: 3 × RMS of the region-grown fit, at least 0.1 mm */
const autoBand = (rms: number) => Math.max(0.1, Math.round(3 * (rms || 0) * 100) / 100);
/** Aux plane 'full adjacent face' + All inside boundary: fill the aux plane points inside its outer contour, refit it. */
function auxFill(r: { plane: FitResult; planeIdx: Uint32Array }, req: { plane?: FitResult; ring?: unknown; fill?: FillParams | null }) {
  if (!req.fill || req.plane || req.ring || !r.planeIdx || r.planeIdx.length < 3) return null;
  const band = req.fill.band > 0 ? req.fill.band : autoBand(r.plane.rms);
  const f = fillOuterBoundary(mesh!.positions, mesh!.vertexNormals ?? null, r.planeIdx, r.plane, { ...req.fill, band }, mesh!.indices);
  const { p, n } = gather(mesh!, f.indices); const plane = fitType('Ebene', p, n, 0); delete plane.residuals; plane.n = f.indices.length;
  return { plane, indices: f.indices, raised: f.raised, contour: f.contour, added: f.added, band };
}
export interface FitParams { k: number; nf?: NormalFilter | null; /** planes: capture all points inside the outer boundary of the region (band ± mm) */ fill?: FillParams | null;
  /** planes without fill: boundary exclusion distance [mm] from the edge of the region */ inset?: number; }
function fitWithParams(idx: Uint32Array, type: GeomType, prm: FitParams) {
  let { p, n } = gather(mesh!, idx);
  if (p.length < 3) throw new Error('Too few points selected');
  let band: number | undefined; let fit = fitType(type, p, n, prm.k), use = idx, removed = 0, filled = 0, raised: Uint32Array | undefined, contour: number[][][] | undefined;
  if (prm.fill && type === 'Ebene') {
    band = prm.fill.band > 0 ? prm.fill.band : autoBand(fit.rms);
    const r = fillOuterBoundary(mesh!.positions, mesh!.vertexNormals ?? null, idx, fit, { ...prm.fill, band }, mesh!.indices);
    use = idx = r.indices; filled = r.added; raised = r.raised; contour = r.contour; ({ p, n } = gather(mesh!, idx)); fit = fitType(type, p, n, prm.k);
  } else if (type === 'Ebene' && (prm.inset ?? 0) > 0) {
    use = idx = insetPlane(mesh!.positions, idx, fit, prm.inset!, mesh!.indices); ({ p, n } = gather(mesh!, idx)); if (p.length < 3) throw new Error('Boundary exclusion distance removes all points'); fit = fitType(type, p, n, prm.k);
  }
  if (prm.nf && n.length === p.length) {
    const keep = normalFilter(fit, p, n, prm.nf);
    removed = p.length - keep.length;
    if (removed && keep.length >= 6) {
      use = Uint32Array.from(keep, (i) => idx[i]); p = keep.map((i) => p[i]); n = keep.map((i) => n[i]);
      fit = fitType(type, p, n, prm.k);
    } else removed = 0;
  }
  delete fit.residuals; fit.n = use.length; fit.nfRemoved = removed;
  return { indices: use, fit, candidates: [], filled, raised, contour, band };
}
function doFit(idx: Uint32Array, type: GeomType | 'auto'): { fit: FitResult; candidates: { type: string; rms: number }[] } {
  const { p, n } = gather(mesh!, idx);
  if (p.length < 3) throw new Error('Too few points selected');
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
      if (req.op === 'load') { mesh = parseByName(req.name, req.buffer); const sc = (req as any).scale ?? 1; if (sc !== 1) { for (let i = 0; i < mesh.positions.length; i++) mesh.positions[i] *= sc; if (mesh.indices.length) computeNormals(mesh); } }
      else { mesh = { name: req.name, positions: req.positions, indices: req.indices }; if (mesh.indices.length) computeNormals(mesh); }
      topo = mesh.indices.length ? new MeshTopology(mesh) : null;
      orig = { positions: mesh.positions.slice(), indices: mesh.indices.slice() }; origBVH = null; eg = null; ebvh = null;
      const b = bounds(mesh);
      const positions = mesh.positions.slice(), indices = mesh.indices.slice();
      const normals = mesh.vertexNormals ? mesh.vertexNormals.slice() : null;
      result = { name: mesh.name, positions, indices, normals, bounds: b, vertexCount: positions.length / 3, triCount: indices.length / 3 };
      transfer = [positions.buffer, indices.buffer, ...(normals ? [normals.buffer] : [])];
    } else if (req.op === 'curvesDetect') {
      const { g, bvh } = curveCtx(); const cs = detectCurves(mesh!, req.opts ?? {}, g, bvh).map(slim);
      result = { curves: cs, layout: layoutOut(cs.map((c) => c.chain), req.layout) };
    } else if (req.op === 'curvePath') {
      const { g, bvh } = curveCtx(); const chain = pathThrough(g, req.verts);
      if (chain.length < 2) throw new Error('No path found between the points');
      result = { curve: slim(makeCurve(g, bvh, chain, 'Benutzer', req.closed ?? false)) };
    } else if (req.op === 'curveFromCtrl') {
      const { g, bvh } = curveCtx(); result = { curve: slim(curveFromCtrl(g, bvh, req.ctrl as any, req.kind, req.closed ?? false)) };
    } else if (req.op === 'curveSplit') {
      const { g, bvh } = curveCtx(); const P = mesh!.positions; let at = -1, bd = Infinity;
      for (const v of req.curve.chain) { const d = (P[3 * v] - req.p[0]) ** 2 + (P[3 * v + 1] - req.p[1]) ** 2 + (P[3 * v + 2] - req.p[2]) ** 2; if (d < bd) { bd = d; at = v; } }
      const r = splitCurve(g, bvh, req.curve, at); result = { curves: r ? r.map(slim) : null };
    } else if (req.op === 'curveJoin') {
      const { g, bvh } = curveCtx(); result = { curve: slim(joinCurves(g, bvh, req.a, req.b)) };
    } else if (req.op === 'curveLayout') {
      result = layoutOut(req.chains, req.opts);
    } else if (req.op === 'setMesh') {
      // Kurvenketten (geordnet) vor dem Netzwechsel auf Punkte abbilden
      const oldP = mesh!.positions; const chainPts = (req.chains ?? []).map((c) => c.map((v) => [oldP[3 * v], oldP[3 * v + 1], oldP[3 * v + 2]]));
      const remap = setMesh(req.positions, req.indices, req.remap);
      let curves: any[] | undefined;
      if (req.chains) {
        const { g, bvh } = curveCtx(); const q = new THREE.Vector3(), tg: any = {};
        const nearestV = (p: number[]) => { q.set(p[0], p[1], p[2]); const h = bvh.closestPointToPoint(q, tg)!; let b = mesh!.indices[3 * h.faceIndex], bd = Infinity; for (let k = 0; k < 3; k++) { const w = mesh!.indices[3 * h.faceIndex + k]; const d = (mesh!.positions[3 * w] - p[0]) ** 2 + (mesh!.positions[3 * w + 1] - p[1]) ** 2 + (mesh!.positions[3 * w + 2] - p[2]) ** 2; if (d < bd) { bd = d; b = w; } } return b; };
        curves = chainPts.map((pts, i) => { const step = Math.max(1, Math.floor(pts.length / 40)); const vs: number[] = []; for (let k = 0; k < pts.length; k += step) vs.push(nearestV(pts[k])); vs.push(nearestV(pts[pts.length - 1]));
          const dedup = vs.filter((v, k) => k === 0 || v !== vs[k - 1]); return slim(makeCurve(g, bvh, pathThrough(g, dedup), (req.kinds?.[i] ?? 'Benutzer') as CurveKind)); });
      }
      const normals = mesh!.vertexNormals!.slice();
      result = { remap, curves, normals, bounds: bounds(mesh!), vertexCount: mesh!.positions.length / 3, triCount: mesh!.indices.length / 3 };
      transfer = [normals.buffer];
    } else if (req.op === 'compare') {
      if (!orig || !mesh) throw new Error('No mesh');
      origBVH ??= buildBVH(orig);
      const c = compareToOriginal({ positions: mesh.positions, indices: mesh.indices }, orig, origBVH);
      result = c; transfer = [c.dev.buffer];
    } else if (req.op === 'getOriginal') {
      if (!orig) throw new Error('No original');
      result = { positions: orig.positions.slice(), indices: orig.indices.slice() };
    } else if (req.op === 'grow') {
      if (!topo) throw new Error('Region growing needs a polygon model (triangles). Use the brush for point clouds.');
      if (req.type === 'auto') {
        const r = autoExtract(mesh!, topo, req.tri, req.point, { maxAngleDeg: req.maxAngleDeg, radius: req.radius, seedR: req.seedR }, bounds(mesh!).diag);
        delete r.fit.residuals; r.fit.n = r.indices.length; if (r.aux) delete r.aux.plane.residuals;
        result = r;
      } else {
        const tris = topo.growRegion(req.tri, req.point, { maxAngleDeg: req.maxAngleDeg, radius: req.radius, seedR: req.seedR });
        const v = topo.regionVertices(tris);
        const use = v.interior.length >= 20 ? v.interior : v.all;
        result = { indices: use, ...doFit(use, req.type) };
      }
    } else if (req.op === 'aux') {
      if (!topo) throw new Error('The auxiliary plane needs a polygon model (triangles).');
      let r = extractWithAuxPlane(mesh!, topo, req.tri, req.point, { maxAngleDeg: req.maxAngleDeg, radius: 0, seedR: req.seedR }, req.type, req.plane, Infinity, req.ring);
      const af = auxFill(r, req);
      if (af) r = { ...extractWithAuxPlane(mesh!, topo, req.tri, req.point, { maxAngleDeg: req.maxAngleDeg, radius: 0 }, req.type, af.plane, Infinity), plane: af.plane, planeIdx: af.indices };
      result = { indices: r.wallIdx, fit: r.fit, candidates: [], aux: { plane: r.plane, indices: r.planeIdx, raised: af?.raised, contour: af?.contour, filled: af?.added } };
    } else if (req.op === 'dev') {
      // Abweichungen der Merkmalspunkte zum Ausgleichselement (Farbkarte/Whisker der Analyse)
      const idx = req.indices, P = mesh!.positions, n = idx.length, dev = new Float32Array(n), dir = new Float32Array(3 * n), pos = new Float32Array(3 * n);
      for (let i = 0; i < n; i++) { const v = idx[i], q: Vec3 = [P[3 * v], P[3 * v + 1], P[3 * v + 2]];
        dev[i] = signedDistance(req.fit, q); const nn = modelNormal(req.fit, q);
        pos.set(q, 3 * i); dir.set(nn, 3 * i); }
      result = { dev, dir, pos }; transfer.push(dev.buffer, dir.buffer, pos.buffer);
    } else if (req.op === 'auxLine') {
      if (!topo) throw new Error('Line with auxiliary plane needs a polygon model (triangles).');
      let r = extractLine(mesh!, topo, req.tri, req.point, { maxAngleDeg: req.maxAngleDeg, radius: 0 }, req.side, req.plane, req.ring);
      const af = auxFill(r, req);
      if (af) r = { ...extractLine(mesh!, topo, req.tri, req.point, { maxAngleDeg: req.maxAngleDeg, radius: 0 }, req.side, af.plane), plane: af.plane, planeIdx: af.indices };
      result = { indices: r.wallIdx, fit: r.fit, candidates: [], aux: { plane: r.plane, indices: r.planeIdx, raised: af?.raised, contour: af?.contour, filled: af?.added }, faces: r.faces };
    } else if (req.op === 'brush') {
      result = { indices: brushSelect(mesh!, req.center, req.radius, req.facing) };
    } else if (req.op === 'nurbs') {
      result = doNurbs(req);
    } else if (req.op === 'reex') {
      const r = reextract(req.fit, mesh!.positions, mesh!.vertexNormals ?? null, req.indices, req.params, req.seedPts ?? [], mesh!.indices);
      result = { ...r, fit: { ...r.fit, residuals: undefined } };
    } else if (req.op === 'fit') {
      result = req.params && req.type !== 'auto' ? fitWithParams(req.indices, req.type, req.params) : { indices: req.indices, ...doFit(req.indices, req.type) };
    }
    result.ms = performance.now() - t0;
    (self as any).postMessage({ id, result }, transfer);
  } catch (err: any) {
    (self as any).postMessage({ id, error: String(err?.message ?? err) });
  }
};
