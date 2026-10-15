// Hilfsebene (Projektionsebene) für 2D-Merkmale Kreis und Langloch.
// Vorgehen wie in gängiger Messsoftware: Ebene aus der angrenzenden Planfläche, Wandpunkte (z. B. Bohrungswand)
// senkrecht in diese Ebene projizieren, Kreis bzw. Stadion-Kontur in der Ebene fitten; Mittelpunkt liegt in der Ebene,
// Orientierung = Ebenennormale.
import { FitResult, autoFit, axisFromNormals, fitCircle3D, fitLine, fitPlane, fitSlot, fitType } from './fit';
import { Vec3, dot, scale, sub } from './linalg';
import { MeshData } from './mesh';
import { GrowOptions, MeshTopology, gather } from './region';

const projOnPlane = (pl: FitResult, q: Vec3): Vec3 => sub(q, scale(pl.normal, dot(sub(q, pl.center), pl.normal)));

/** Kreis/Langloch in einer gegebenen Ebene fitten (robust, 3σ-Ausreißer iterativ). */
export function fitInPlane(type: 'Kreis' | 'Langloch', p: Vec3[], plane: FitResult): FitResult {
  const n = plane.normal;
  const run = (pp: Vec3[]): FitResult => {
    const f = type === 'Kreis' ? fitCircle3D(pp, n) : fitSlot(pp, n);
    return { ...f, center: projOnPlane(plane, f.center), normal: n };
  };
  let r = run(p), P = p;
  for (let it = 0; it < 3; it++) {
    const res = r.residuals!, abs = Array.from(res, Math.abs).sort((a, b) => a - b);
    const thr = Math.max(3 * 1.4826 * abs[abs.length >> 1], 1e-9);
    const keep = P.filter((_, i) => Math.abs(res[i]) <= thr);
    if (keep.length === P.length || keep.length < 10) break;
    P = keep; r = run(P);
  }
  r.outliers = p.length - P.length;
  return r;
}

export interface AuxResult {
  fit: FitResult;              // Kreis/Langloch in der Hilfsebene
  plane: FitResult;            // Hilfsebene
  wallIdx: Uint32Array;        // Knoten der Wand (Merkmalspunkte)
  planeIdx: Uint32Array;       // Knoten der Hilfsebene (leer bei vorhandener Ebene)
}

interface Region { tris: Uint32Array; verts: Uint32Array; p: Vec3[]; n: Vec3[] }

/** Planar, wenn die Ausgleichsebene die Punkte eng beschreibt (RMS klein im Verhältnis zur Ausdehnung). */
let H = 0; // mittlere Kantenlänge des Netzes (Rausch-/Auflösungsmaßstab)
function isPlanar(r: Region): { ok: boolean; normal: Vec3 } {
  let x = 0, y = 0, z = 0; for (const q of r.n) { x += q[0]; y += q[1]; z += q[2]; }
  const l = Math.hypot(x, y, z) || 1; const m: Vec3 = [x / l, y / l, z / l];
  if (r.p.length < 3) return { ok: false, normal: m };
  const f = fitPlane(r.p);
  let ext = 0; for (const q of r.p) ext = Math.max(ext, Math.hypot(q[0] - f.center[0], q[1] - f.center[1], q[2] - f.center[2]));
  const nn = dot(f.normal, m) < 0 ? scale(f.normal, -1) : f.normal;
  return { ok: f.rms < Math.max(0.03, 0.002 * ext, 0.12 * H) && l / r.n.length > 0.9, normal: nn };
}

export function extractWithAuxPlane(mesh: MeshData, topo: MeshTopology, seedTri: number, seedPoint: Vec3, o: GrowOptions,
  type: 'Kreis' | 'Langloch' | 'auto', givenPlane?: FitResult, maxDist = Infinity): AuxResult {
  const r = tryExtractWithAuxPlane(mesh, topo, seedTri, seedPoint, o, type, givenPlane, maxDist);
  if (!r) throw new Error('No plane/hole transition near the click point');
  return r;
}

/** Wie extractWithAuxPlane; mit maxDist: nur wenn der Klick näher als maxDist am Übergang Ebene/Wand liegt, sonst null.
 *  type 'auto': Kreis oder Langloch anhand der Konturfits in der Ebene. */
export function tryExtractWithAuxPlane(mesh: MeshData, topo: MeshTopology, seedTri: number, seedPoint: Vec3, o: GrowOptions,
  type: 'Kreis' | 'Langloch' | 'auto', givenPlane?: FitResult, maxDist = Infinity): AuxResult | null {
  H = topo.localEdge(seedTri) * 0.4; const nt = mesh.indices.length / 3;
  const visited = new Uint8Array(nt);
  const mk = (tris: Uint32Array): Region => {
    for (const t of tris) visited[t] = 1;
    const v = topo.regionVertices(tris);
    const verts = v.interior.length >= 20 ? v.interior : v.all;
    const g = gather(mesh, verts, 20000);
    return { tris, verts, p: g.p, n: g.n };
  };
  // Klick auf Splitterdreieck (häufig an Kanten): auf benachbartes reguläres Dreieck mit ähnlicher Normale ausweichen
  if (topo.sliver[seedTri]) {
    const fn = mesh.faceNormals!, n0 = [fn[3 * seedTri], fn[3 * seedTri + 1], fn[3 * seedTri + 2]];
    let best = -1, bd = -2; const ring = new Set<number>([seedTri]);
    for (let k = 0; k < 3; k++) for (const t of [...ring]) for (const u of topo.neighbors(t)) ring.add(u);
    for (const u of ring) if (!topo.sliver[u]) { const d = fn[3 * u] * n0[0] + fn[3 * u + 1] * n0[1] + fn[3 * u + 2] * n0[2]; if (d > bd) { bd = d; best = u; } }
    if (best >= 0) seedTri = best;
  }
  let r1 = mk(topo.growRegion(seedTri, seedPoint, { ...o, radius: 0 }));
  const P = mesh.positions, F = mesh.indices;
  const triDist = (t: number) => { let d = Infinity; for (let k = 0; k < 3; k++) { const v = F[3 * t + k];
    d = Math.min(d, Math.hypot(P[3 * v] - seedPoint[0], P[3 * v + 1] - seedPoint[1], P[3 * v + 2] - seedPoint[2])); } return d; };
  /** Erste Nachbarregion (über die Regionsgrenze, nach Abstand zum Klickpunkt sortiert), die das Kriterium erfüllt. */
  const findAround = (r: Region, ok: (g: Region) => boolean, maxD = Infinity, go: Partial<GrowOptions> = {}): Region | undefined => {
    const cand = new Map<number, number>();
    for (const t of r.tris) for (const u of topo.neighbors(t)) if (!visited[u] && !topo.sliver[u] && !cand.has(u)) cand.set(u, triDist(u));
    const order = [...cand.entries()].sort((a, b) => a[1] - b[1]);
    let tried = 0; let budget = 0.6; let backup: Region | undefined; let work = 0; const NT = mesh.indices.length / 3;
    for (const [u, du] of order) {
      if (du > maxD) break;
      if (visited[u]) continue;
      let gt = topo.growRegion(u, seedPoint, { ...o, radius: 0, legacy: true, legacyCap: budget, ...go });
      // ausgelaufen (Scan mit Verrundungen): lokales fit-geführtes Wachstum statt des Kantenwachstums
      let viaFit = false; if (!gt.length) { budget = Math.max(0.02, budget / 3); gt = topo.growFit(u, seedPoint, { ...o, radius: 0, ...go }); viaFit = true; }
      work += gt.length + 0.01 * NT; if (work > 3 * NT) break; // Rechenbudget (deterministisch, nach Dreiecken)
      if (!gt.length) { visited[u] = 1; if (++tried > 400) break; continue; }
      const g = mk(gt);
      // fit-geführte Ersatzregion nur nehmen, wenn kein sauberes Kantenwachstum passt
      if (g.verts.length >= 8 && ok(g)) { if (!viaFit) return g; backup ??= g; }
      if (++tried > 400) break;
    }
    return backup;
  };
  /** Von der Klickstelle über die Fläche zur nächsten Wand (Normale ⟂ Ebenennormale) laufen und dort prismatisch wachsen. */
  const wallByWalk = (N: Vec3): Region | undefined => {
    const sn = topo.smoothN, seen = new Set<number>([seedTri]); let q = [seedTri]; const lim = Math.min(maxDist, 60 * topo.localEdge(seedTri));
    for (let it = 0; it < 4000 && q.length; it++) { const nq: number[] = [];
      for (const t of q) for (const u of topo.neighbors(t)) { if (seen.has(u)) continue; seen.add(u); if (triDist(u) > lim) continue;
        if (Math.abs(sn[3 * u] * N[0] + sn[3 * u + 1] * N[1] + sn[3 * u + 2] * N[2]) < 0.15) {
          let gt = topo.growRegion(u, seedPoint, { ...o, radius: 0, legacy: true, legacyCap: 0.1 });
          if (!gt.length) gt = topo.growFit(u, seedPoint, { ...o, radius: 0, prismAxis: N });
          if (!gt.length) return undefined; const g = mk(gt); return g.verts.length >= 8 && !isPlanar(g).ok && prismatic(g, N) ? g : undefined; }
        nq.push(u); }
      q = nq; }
    return undefined;
  };
  const prismatic = (r: Region, axis: Vec3) => { const a = axisFromNormals(r.n); return a.ratio < 0.05 && Math.abs(dot(a.axis, axis)) > 0.95; };

  let p1 = isPlanar(r1);
  // Kleines ebenes Fragment am Kantenübergang getroffen: zur großen, parallelen Nachbarfläche wechseln
  if (p1.ok && r1.verts.length < 200) {
    const n1 = p1.normal;
    const big = findAround(r1, (r) => { const q = isPlanar(r); return q.ok && r.verts.length >= 200 && dot(q.normal, n1) > 0.98; });
    if (big) { visited.fill(0); for (const t of big.tris) visited[t] = 1; r1 = big; p1 = isPlanar(big); }
    else { visited.fill(0); for (const t of r1.tris) visited[t] = 1; }
  }
  let wall: Region | undefined, planeReg: Region | undefined;
  if (p1.ok && !givenPlane) {
    planeReg = r1;
    wall = wallByWalk(p1.normal) ?? findAround(r1, (r) => !isPlanar(r).ok && prismatic(r, p1.normal), maxDist, { prismAxis: p1.normal });
    if (!wall) { if (isFinite(maxDist)) return null; throw new Error('No wall (hole/slot) found next to the clicked plane'); }
  } else if (p1.ok && givenPlane) {
    wall = findAround(r1, (r) => !isPlanar(r).ok && prismatic(r, givenPlane.normal), maxDist, { prismAxis: givenPlane.normal });
    if (!wall) { if (isFinite(maxDist)) return null; } if (!wall) throw new Error('No matching wall found next to the clicked face');
  } else {
    wall = r1;
    if (!givenPlane) {
      const ax = axisFromNormals(r1.n).axis;
      // ausreichend große Planfläche verlangen (kleine Splitter-Fragmente am Kantenübergang überspringen)
      const minV = Math.max(60, Math.min(2000, 0.1 * r1.verts.length));
      if (!(axisFromNormals(r1.n).ratio < 0.05)) { if (isFinite(maxDist)) return null; throw new Error('Clicked face is neither a plane nor a prismatic wall'); }
      planeReg = findAround(r1, (r) => { const q = isPlanar(r); return q.ok && r.verts.length >= minV && Math.abs(dot(q.normal, ax)) > 0.95; }, maxDist);
      if (!planeReg && isFinite(maxDist)) return null;
      if (!planeReg) throw new Error('No adjacent plane found for the auxiliary plane – choose an existing plane');
    }
  }
  let plane = givenPlane ?? fitType('Ebene', planeReg!.p, planeReg!.n);
  // Normale aus dem Material heraus (Richtung der Flächennormalen der Ebenenpunkte)
  if (planeReg) { const pn = isPlanar(planeReg).normal; if (dot(pn, plane.normal) < 0) plane = { ...plane, normal: scale(plane.normal, -1) }; }
  let fit: FitResult;
  if (type === 'auto') {
    const fc = fitInPlane('Kreis', wall.p, plane);
    let fs: FitResult | null = null; try { fs = fitInPlane('Langloch', wall.p, plane); } catch { /* */ }
    fit = fs && fs.rms < 0.6 * fc.rms && fs.length! - fs.width! > 0.2 * fs.width! ? fs : fc;
  } else fit = fitInPlane(type, wall.p, plane);
  fit.n = wall.verts.length;
  // Plausibilität (relativ zur Netzauflösung): Wand passt nicht zu Kreis/Langloch -> keine Hilfsebenen-Lösung
  if (!(fit.rms < Math.max(0.05, 0.5 * topo.localEdge(seedTri)))) { if (isFinite(maxDist)) return null; throw new Error(`Wall does not match ${type === 'auto' ? 'circle/slot' : type === 'Kreis' ? 'circle' : 'slot'} (RMS ${fit.rms.toFixed(2)} mm)`); }
  delete fit.residuals; delete plane.residuals;
  return { fit, plane, wallIdx: wall.verts, planeIdx: planeReg ? planeReg.verts : new Uint32Array(0) };
}

/** Automatik-Modus: Region wachsen + Typ erkennen; liegt der Klick nahe am Übergang Ebene/Bohrung bzw. auf einer
 *  Langlochwand, wird Kreis/Langloch in der Hilfsebene bestimmt. Reine Ebenen bleiben Ebenen (ohne Hilfsebene). */
export function autoExtract(mesh: MeshData, topo: MeshTopology, seedTri: number, seedPoint: Vec3, o: GrowOptions, diag: number) {
  const tris = topo.growRegion(seedTri, seedPoint, o);
  const v = topo.regionVertices(tris);
  const use = v.interior.length >= 20 ? v.interior : v.all;
  const g = gather(mesh, use);
  if (g.p.length < 3) throw new Error('Too few points selected');
  const r = autoFit(g.p, g.n);
  const base = { indices: use, fit: r.best, candidates: r.candidates.map((c) => ({ type: c.type, rms: c.rms })) };
  // Kugel/Torus/Kegel direkt neben einer Ebene sind meist Bohrungsränder: Kreis in Hilfsebene bevorzugen
  if (['Ebene', 'Zylinder', 'Kreis', 'Langloch', 'Kugel', 'Torus', 'Kegel'].includes(r.best.type)) {
    const T = Math.min(3, Math.max(0.5, 0.015 * diag));
    const maxD = r.best.type === 'Langloch' ? diag : T;
    try {
      const a = tryExtractWithAuxPlane(mesh, topo, seedTri, seedPoint, { ...o, radius: 0 }, 'auto', undefined, maxD);
      if (a) return { ...base, indices: a.wallIdx, fit: a.fit, aux: { plane: a.plane, indices: a.planeIdx } };
    } catch { /* keine Hilfsebene */ }
  }
  return { ...base, aux: undefined as undefined | { plane: FitResult; indices: Uint32Array } };
}

export interface LineResult {
  fit: FitResult; plane: FitResult;
  wallIdx: Uint32Array; planeIdx: Uint32Array;
  /** beide angrenzenden Flächen (0 = angeklickte, 1 = Nachbar) für die Vorschau/Auswahl der Hilfsebene */
  faces: [Uint32Array, Uint32Array];
}

/** Linie mit Hilfsebene an einer Kante: angeklickte Fläche + nächstgelegene Nachbarfläche. auxSide wählt, welche der beiden
 *  die Hilfsebene ist; die Punkte der anderen Fläche werden in die Hilfsebene projiziert und eine Gerade gefittet. */
export function extractLine(mesh: MeshData, topo: MeshTopology, seedTri: number, seedPoint: Vec3, o: GrowOptions,
  auxSide: 0 | 1, givenPlane?: FitResult): LineResult {
  H = topo.localEdge(seedTri) * 0.4;
  const visited = new Uint8Array(mesh.indices.length / 3);
  const mk = (tris: Uint32Array): Region => {
    for (const t of tris) visited[t] = 1;
    const v = topo.regionVertices(tris); const verts = v.interior.length >= 20 ? v.interior : v.all;
    const g = gather(mesh, verts, 20000); return { tris, verts, p: g.p, n: g.n };
  };
  const P = mesh.positions, F = mesh.indices;
  const triDist = (t: number) => { let d = Infinity; for (let k = 0; k < 3; k++) { const v = F[3 * t + k];
    d = Math.min(d, Math.hypot(P[3 * v] - seedPoint[0], P[3 * v + 1] - seedPoint[1], P[3 * v + 2] - seedPoint[2])); } return d; };
  const r1 = mk(topo.growRegion(seedTri, seedPoint, { ...o, radius: 0 }));
  if (r1.verts.length < 3) throw new Error('Too few points on the clicked face');
  const n1 = isPlanar(r1).normal;
  // Nachbarfläche: über die Regionsgrenze, nach Abstand zum Klickpunkt; Normale deutlich verschieden (echte Kante)
  const cand = new Map<number, number>();
  for (const t of r1.tris) for (const u of topo.neighbors(t)) if (!visited[u] && !cand.has(u)) cand.set(u, triDist(u));
  let r2: Region | undefined; let tried = 0;
  for (const [u] of [...cand.entries()].sort((a, b) => a[1] - b[1])) {
    if (visited[u] || topo.sliver[u]) continue;
    let gt = topo.growRegion(u, seedPoint, { ...o, radius: 0, legacy: true, legacyCap: 0.3 });
    if (!gt.length) gt = topo.growFit(u, seedPoint, { ...o, radius: 0 });
    if (!gt.length) { visited[u] = 1; if (++tried > 300) break; continue; }
    const g = mk(gt);
    if (g.verts.length >= 8 && Math.abs(dot(isPlanar(g).normal, n1)) < 0.985) { r2 = g; break; }
    if (++tried > 300) break;
  }
  if (!r2 && !givenPlane) throw new Error('No adjacent face found – click closer to an edge');
  const [auxR, wallR] = givenPlane ? [undefined, r1] : auxSide === 0 ? [r1, r2!] : [r2!, r1];
  let plane = givenPlane ?? fitType('Ebene', auxR!.p, auxR!.n);
  if (auxR) { const pn = isPlanar(auxR).normal; if (dot(pn, plane.normal) < 0) plane = { ...plane, normal: scale(plane.normal, -1) }; }
  // robuster Geradenfit in der Ebene
  let pts = wallR.p, fit = fitLine(pts, plane);
  for (let it = 0; it < 3; it++) {
    const res = fit.residuals!, abs = Array.from(res, Math.abs).sort((a, b) => a - b);
    const thr = Math.max(3 * 1.4826 * abs[abs.length >> 1], 1e-9);
    const keep = pts.filter((_, i) => Math.abs(res[i]) <= thr);
    if (keep.length === pts.length || keep.length < 10) break;
    pts = keep; fit = fitLine(pts, plane);
  }
  fit.outliers = wallR.p.length - pts.length; fit.n = wallR.verts.length;
  delete fit.residuals; delete plane.residuals;
  return { fit, plane, wallIdx: wallR.verts, planeIdx: auxR ? auxR.verts : new Uint32Array(0), faces: [r1.verts, r2 ? r2.verts : new Uint32Array(0)] };
}
