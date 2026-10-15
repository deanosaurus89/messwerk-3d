// Punktauswahl am Polygonmodell: Regionenwachstum ab Klickpunkt und Pinsel-Auswahl.
import { MeshData, vertexTriangles } from './mesh';
import type { Vec3 } from './linalg';
import { FitResult, GeomType, autoFit, axisFromNormals, fitType, modelNormal } from './fit';

export interface GrowOptions {
  maxAngleDeg: number;   // max. Normalenwinkel zwischen benachbarten Dreiecken (Glattheit)
  radius: number;        // Suchradius um den Klickpunkt (mm), 0 = unbegrenzt
  maxCurvatureDeg?: number; // optional: max. Abweichung zur Saat-Normalen (0 = aus)
  /** Erwarteter Elementtyp für das fit-geführte Wachsen ('auto' = aus der Saat-Umgebung bestimmen). */
  type?: GeomType | 'auto';
  /** Prismatische Wand (Bohrung/Langloch): Normalen ⟂ dieser Achse statt Modellfit. */
  prismAxis?: Vec3;
  /** Altes Verfahren (nur Nachbarwinkel/Krümmung) – für Vergleichstests. */
  legacy?: boolean; /** nur saubere Kantenwachstums-Regionen (Gütekontrolle), sonst leer */ strict?: boolean; legacyCap?: number;
}
/** Vorzeichenbehafteter Abstand eines Punkts zum Regelgeometrie-Modell. */
export function modelDist(f: FitResult, q: Vec3): number {
  const c = f.center, a = f.normal; const w: Vec3 = [q[0] - c[0], q[1] - c[1], q[2] - c[2]]; const t = w[0] * a[0] + w[1] * a[1] + w[2] * a[2];
  switch (f.type) {
    case 'Ebene': return t;
    case 'Kugel': return Math.hypot(w[0], w[1], w[2]) - (f.radius ?? 0);
    case 'Zylinder': case 'Kreis': return Math.hypot(w[0] - t * a[0], w[1] - t * a[1], w[2] - t * a[2]) - (f.radius ?? 0);
    case 'Kegel': {
      const ap = f.apex ?? c, wa: Vec3 = [q[0] - ap[0], q[1] - ap[1], q[2] - ap[2]]; const ta = wa[0] * a[0] + wa[1] * a[1] + wa[2] * a[2];
      const rr = Math.hypot(wa[0] - ta * a[0], wa[1] - ta * a[1], wa[2] - ta * a[2]); const ha = f.halfAngle ?? 0.5;
      return rr * Math.cos(ha) - Math.abs(ta) * Math.sin(ha);
    }
    case 'Torus': { const rx = w[0] - t * a[0], ry = w[1] - t * a[1], rz = w[2] - t * a[2]; const rl = Math.hypot(rx, ry, rz) || 1; const R = f.radius ?? 0;
      return Math.hypot(rl - R, t) - (f.minorRadius ?? 0); }
    default: return 0;
  }
}
/** Diagnose des letzten fit-geführten Wachsens (für Tests/Bericht). */
export interface GrowInfo { model: GeomType | 'Prisma' | 'keins'; h: number; sigma: number; tol: number; angDeg: number; seedTris: number; refits: number; capped: boolean; legacy?: boolean; }

export class MeshTopology {
  vt: { offsets: Uint32Array; tris: Uint32Array };
  smooth: Float32Array; // geglättete Dreiecksnormalen (flächengewichtet über 1-Ring)
  constructor(public mesh: MeshData) {
    this.vt = vertexTriangles(mesh);
    this.smooth = mesh.faceNormals!;
    this.sliver = this.findSlivers();
    this.anchorDist = Math.max(1.0, 1.2 * this.medianEdge());
    this.isotropic = this.checkIsotropic();
    this.kappa = this.isotropic ? this.computeKappa() : new Float32Array(0);
  }
  /** Gleichmäßiges Scan-/CT-Netz (gute Dreiecksform)? Nur dann gelten Krümmungs-/Ankerkriterium beim Wachsen;
   *  bei tessellierten CAD-Netzen (lange Splitter, sehr unterschiedliche Größen) wären sie bedeutungslos. */
  isotropic: boolean;
  private checkIsotropic(): boolean {
    const p = this.mesh.positions, f = this.mesh.indices, fa = this.mesh.faceAreas!, nt = f.length / 3;
    const step = Math.max(1, Math.floor(nt / 20000)); let n = 0, good = 0;
    const d2 = (a: number, b: number) => (p[a] - p[b]) ** 2 + (p[a + 1] - p[b + 1]) ** 2 + (p[a + 2] - p[b + 2]) ** 2;
    for (let t = 0; t < nt; t += step) {
      const a = 3 * f[3 * t], b = 3 * f[3 * t + 1], c = 3 * f[3 * t + 2]; const s = d2(a, b) + d2(b, c) + d2(c, a);
      n++; if (s > 0 && (4 * Math.sqrt(3) * fa[t]) / s > 0.6) good++;
    }
    return n > 0 && good / n > 0.9;
  }
  /** Lokale Krümmung je Dreieck [rad/mm] (Normalenwinkel zu Nachbarn / Abstand, über 1-Ring geglättet).
   *  Damit stoppt das Wachsen auch an tangentialen Verrundungen (Scan-/CT-Daten), wo der Winkel von Dreieck zu Dreieck klein ist. */
  kappa: Float32Array;
  private computeKappa(): Float32Array {
    const p = this.mesh.positions, f = this.mesh.indices, fn = this.smooth, nt = f.length / 3;
    const c = new Float32Array(3 * nt);
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) c[3 * t + k] = (p[3 * f[3 * t] + k] + p[3 * f[3 * t + 1] + k] + p[3 * f[3 * t + 2] + k]) / 3;
    const raw = new Float32Array(nt);
    for (let t = 0; t < nt; t++) {
      let s = 0, n = 0;
      for (const u of this.neighbors(t)) {
        const d = Math.hypot(c[3 * u] - c[3 * t], c[3 * u + 1] - c[3 * t + 1], c[3 * u + 2] - c[3 * t + 2]); if (d < 1e-9) continue;
        const dot = fn[3 * t] * fn[3 * u] + fn[3 * t + 1] * fn[3 * u + 1] + fn[3 * t + 2] * fn[3 * u + 2];
        s += Math.acos(Math.max(-1, Math.min(1, dot))) / d; n++;
      }
      raw[t] = n ? s / n : 0;
    }
    const out = new Float32Array(nt);
    for (let t = 0; t < nt; t++) { let s = raw[t], n = 1; for (const u of this.neighbors(t)) { s += raw[u]; n++; } out[t] = s / n; }
    return out;
  }
  /** Bezugsabstand für die Krümmungsprüfung beim Wachsen (≈ 1 mm bzw. 1,2 × mittlere Kantenlänge). */
  anchorDist: number;
  private medianEdge(): number {
    const p = this.mesh.positions, f = this.mesh.indices, nt = f.length / 3, L: number[] = [];
    const step = Math.max(1, Math.floor(nt / 5000));
    for (let t = 0; t < nt; t += step) { const a = 3 * f[3 * t], b = 3 * f[3 * t + 1]; L.push(Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2])); }
    L.sort((x, y) => x - y); return L[L.length >> 1] || 1;
  }
  /** Splitterdreiecke (Formqualität q = 4√3·A / Σl² < 0.05) haben bei Rauschen beliebige
   *  Normalen und würden über Kanten hinweg "lecken": sie werden beim Wachsen übersprungen. */
  sliver: Uint8Array;
  private findSlivers(): Uint8Array {
    const p = this.mesh.positions, f = this.mesh.indices, fa = this.mesh.faceAreas!, nt = f.length / 3;
    const out = new Uint8Array(nt);
    const d2 = (a: number, b: number) => (p[a] - p[b]) ** 2 + (p[a + 1] - p[b + 1]) ** 2 + (p[a + 2] - p[b + 2]) ** 2;
    for (let t = 0; t < nt; t++) {
      const a = 3 * f[3 * t], b = 3 * f[3 * t + 1], c = 3 * f[3 * t + 2];
      const s = d2(a, b) + d2(b, c) + d2(c, a);
      out[t] = s > 0 && (4 * Math.sqrt(3) * fa[t]) / s < 0.05 ? 1 : 0;
    }
    return out;
  }

  /** Rauschrobuste Dreiecksnormale: Mittel der (flächengewichteten) Knotennormalen.
   *  Splitterdreiecke mit verrauschter eigener Normale werden so stabilisiert. */
  private smoothNormals(): Float32Array {
    const vn = this.mesh.vertexNormals!, f = this.mesh.indices, nt = f.length / 3;
    const out = new Float32Array(3 * nt);
    for (let t = 0; t < nt; t++) {
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < 3; k++) { const v = 3 * f[3 * t + k]; x += vn[v]; y += vn[v + 1]; z += vn[v + 2]; }
      const l = Math.hypot(x, y, z) || 1;
      out[3 * t] = x / l; out[3 * t + 1] = y / l; out[3 * t + 2] = z / l;
    }
    return out;
  }

  /** Dreiecke, die über Knoten benachbart sind. */
  *neighbors(t: number) {
    const f = this.mesh.indices, { offsets, tris } = this.vt;
    for (let k = 0; k < 3; k++) {
      const v = f[3 * t + k];
      for (let j = offsets[v]; j < offsets[v + 1]; j++) if (tris[j] !== t) yield tris[j];
    }
  }

  /** Glatte Dreiecksnormalen (Knotennormalen gemittelt) – einmalig berechnet. */
  private _sn: Float32Array | null = null;
  get smoothN(): Float32Array { return (this._sn ??= this.smoothNormals()); }
  private _area = -1;
  get totalArea(): number { if (this._area < 0) { let s = 0; for (const a of this.mesh.faceAreas!) s += a; this._area = s; } return this._area; }
  lastGrow: GrowInfo | null = null;
  private cen(t: number): Vec3 { const p = this.mesh.positions, f = this.mesh.indices; return [0, 1, 2].map((k) => (p[3 * f[3 * t] + k] + p[3 * f[3 * t + 1] + k] + p[3 * f[3 * t + 2] + k]) / 3) as Vec3; }
  /**
   * Regionenwachstum ab Klickpunkt. Standard: fit-geführt und lokal skaliert (rotations-/translationsinvariant):
   *  1. lokale Kantenlänge h aus der Saat-Umgebung, Saat-Fleck mit Radius ≈ 8·h (nur glatte Nachbarn),
   *  2. Modell (Ebene/Zylinder/Kugel/Kegel/Torus bzw. vorgegebener Typ) an den Fleck, Rauschen σ aus dem robusten RMS,
   *  3. Wachsen nur, solange Abstand zum Modell < max(4σ, 0,05·h) und Normale ≈ Modellnormale (Winkel aus dem Rauschen),
   *     Modell wird bei jedem Wachstum um 60 % neu gefittet; Obergrenze 60 % der Gesamtfläche.
   */
  growRegion(seedTri: number, seedPoint: Vec3, o: GrowOptions): Uint32Array {
    // Freiform: kein Regelgeometrie-Modell -> reines Kanten-/Krümmungswachstum (mit Flächendeckel)
    if (o.legacy || o.type === 'Freiformfläche') return this.growLegacy(seedTri, seedPoint, o, Math.floor((o.legacyCap ?? 0.6) * this.mesh.indices.length / 3)) ?? new Uint32Array(0);
    // 1) Kanten-/Krümmungswachstum (exakt wie bisher, rotationsinvariant), mit Flächenobergrenze;
    // 2) Gütekontrolle: Region muss sich mit RMS < 0,3·h (h = lokale Kantenlänge) durch eine Regelgeometrie
    //    beschreiben lassen – sonst ist sie über Verrundungen/Kanten ausgelaufen -> fit-geführtes Wachstum.
    const nt = this.mesh.indices.length / 3;
    const F = this.growFit(seedTri, seedPoint, o); const fitInfo = this.lastGrow;
    const L = this.growLegacy(seedTri, seedPoint, o, Math.floor(Math.min(0.6 * nt, Math.max(50 * F.length, 0.15 * nt))));
    if (L && L.length >= 3) {
      const h = this.localEdge(seedTri);
      let a = 0; const fa = this.mesh.faceAreas!; for (const t of L) a += fa[t];
      const r = a < 0.01 * this.totalArea ? 0 : this.regionRms(L, 0.3 * h, fitInfo?.model === 'Ebene');
      if (r !== null && r < 0.3 * h) { this.lastGrow = { model: 'keins', h, sigma: r, tol: 0.3 * h, angDeg: o.maxAngleDeg, seedTris: 0, refits: 0, capped: false, legacy: true }; return L; }
    }
    this.lastGrow = fitInfo; return o.strict ? new Uint32Array(0) : F;
  }
  localEdge(seedTri: number): number {
    const f = this.mesh.indices, p = this.mesh.positions; const near: number[] = []; const seen = new Set([seedTri]), q = [seedTri];
    while (q.length && near.length < 150) { const t = q.shift()!; near.push(t); for (const u of this.neighbors(t)) if (!seen.has(u)) { seen.add(u); q.push(u); } }
    const el = near.map((t) => { const a = f[3 * t], b = f[3 * t + 1]; return Math.hypot(p[3 * a] - p[3 * b], p[3 * a + 1] - p[3 * b + 1], p[3 * a + 2] - p[3 * b + 2]); }).sort((x, y) => x - y);
    return el[el.length >> 1] || 1;
  }
  /** RMS der besten Regelgeometrie (autoFit) an eine Dreiecksmenge, null wenn nicht bestimmbar. */
  regionRms(tris: ArrayLike<number>, lim = 0, planeOnly = false): number | null {
    const f = this.mesh.indices, p = this.mesh.positions, sn = this.smoothN; const seen = new Set<number>(); const P: Vec3[] = [], N: Vec3[] = [];
    const step = Math.max(1, Math.floor(tris.length / 400));
    for (let i = 0; i < tris.length; i += step) { const t = tris[i]; for (let k = 0; k < 3; k++) { const v = f[3 * t + k]; if (seen.has(v)) continue; seen.add(v); P.push([p[3 * v], p[3 * v + 1], p[3 * v + 2]]); N.push([sn[3 * t], sn[3 * t + 1], sn[3 * t + 2]]); } }
    if (P.length < 6) return 0;
    try { const pl = fitType('Ebene', P, N); if (pl.rms < lim) return pl.rms;
      // prismatisch (Zylinder, Langloch, beliebige Wand): alle Normalen ⟂ einer Achse
      const ax = axisFromNormals(N).axis; const d = N.map((q) => Math.abs(q[0] * ax[0] + q[1] * ax[1] + q[2] * ax[2])).sort((x, y) => x - y);
      if (d[Math.floor(d.length * 0.95)] < 0.05) return 0;
      if (planeOnly && tris.length > 0.1 * this.mesh.indices.length / 3) return null; // ebene Saat, sehr große Region: Region muss Ebene oder prismatische Wand sein (keine teuren Fits)
      for (const ty of ['Zylinder', 'Kugel', 'Kegel'] as GeomType[]) { try { const c = fitType(ty, P, N); if (c.rms < lim) return c.rms; } catch { /* weiter */ } }
      const r = autoFit(P, N); const c = [r.best, ...r.candidates].filter((x) => x && x.type !== 'Freiformfläche' && isFinite(x.rms)).map((x) => x.rms); return c.length ? Math.min(...c) : null; } catch { return null; }
  }
  growFit(seedTri: number, seedPoint: Vec3, o: GrowOptions): Uint32Array {
    const m = this.mesh, f = m.indices, p = m.positions, nt = f.length / 3, fa = m.faceAreas!, sn = this.smoothN, fn = m.faceNormals!;
    const cosA = Math.cos((Math.max(1, o.maxAngleDeg) * Math.PI) / 180);
    const r2 = o.radius > 0 ? o.radius * o.radius : Infinity;
    const vpos = (v: number): Vec3 => [p[3 * v], p[3 * v + 1], p[3 * v + 2]];
    const inRad = (t: number) => { if (r2 === Infinity) return true; const a = 3 * f[3 * t]; return (p[a] - seedPoint[0]) ** 2 + (p[a + 1] - seedPoint[1]) ** 2 + (p[a + 2] - seedPoint[2]) ** 2 <= r2; };
    const dotN = (N: Float32Array, a: number, b: number) => N[3 * a] * N[3 * b] + N[3 * a + 1] * N[3 * b + 1] + N[3 * a + 2] * N[3 * b + 2];
    // 1) lokale Kantenlänge
    const near: number[] = []; { const seen = new Set([seedTri]), q = [seedTri]; while (q.length && near.length < 150) { const t = q.shift()!; near.push(t); for (const u of this.neighbors(t)) if (!seen.has(u)) { seen.add(u); q.push(u); } } }
    const el: number[] = []; for (const t of near) { const a = f[3 * t], b = f[3 * t + 1]; el.push(Math.hypot(p[3 * a] - p[3 * b], p[3 * a + 1] - p[3 * b + 1], p[3 * a + 2] - p[3 * b + 2])); }
    el.sort((x, y) => x - y); const h = el[el.length >> 1] || 1;
    // 2) Saat-Fleck: glatte Nachbarn (Winkel zur Saat < 25°) im Radius 8h um den Klickpunkt
    const R0 = 6 * h, cos0 = Math.cos((15 * Math.PI) / 180); const seed: number[] = []; const sMark = new Uint8Array(nt);
    { const q = [seedTri]; sMark[seedTri] = 1; while (q.length) { const t = q.shift()!; seed.push(t); for (const u of this.neighbors(t)) { if (sMark[u]) continue; const c = this.cen(u);
      if ((c[0] - seedPoint[0]) ** 2 + (c[1] - seedPoint[1]) ** 2 + (c[2] - seedPoint[2]) ** 2 > R0 * R0) continue; if (dotN(sn, seedTri, u) < cos0) continue; sMark[u] = 1; q.push(u); } } }
    const ptsOf = (tris: ArrayLike<number>, max = 3000) => { const seenV = new Set<number>(); const P: Vec3[] = [], N: Vec3[] = []; const step = Math.max(1, Math.floor(tris.length / max));
      for (let i = 0; i < tris.length; i += step) { const t = tris[i]; for (let k = 0; k < 3; k++) { const v = f[3 * t + k]; if (seenV.has(v)) continue; seenV.add(v); P.push(vpos(v)); } N.push([sn[3 * t], sn[3 * t + 1], sn[3 * t + 2]]); }
      // Normalen je Punkt: Dreiecksnormale genügt für Achs-/Typbestimmung (Länge kann von P abweichen)
      return { P, N }; };
    const fitOf = (tris: ArrayLike<number>, type: GeomType | 'auto'): FitResult | null => {
      const { P, N } = ptsOf(tris); if (P.length < 12) return null;
      try {
        if (type === 'auto') {
          const r = autoFit(P, N);
          if (['Ebene', 'Zylinder', 'Kugel', 'Kegel', 'Torus'].includes(r.best.type)) return r.best;
          // sonst (Langloch/Kreis/Freiform): beste Regelfläche unter den Kandidaten bzw. Ebene/Zylinder/Kugel
          const c = r.candidates.filter((x) => ['Ebene', 'Zylinder', 'Kugel'].includes(x.type) && isFinite(x.rms)).sort((a, b) => a.rms - b.rms)[0];
          return c ?? fitType('Ebene', P, N);
        }
        return fitType(type, P, N);
      } catch { try { return fitType('Ebene', P, N); } catch { return null; } }
    };
    let type: GeomType | 'auto' = o.type ?? 'auto'; let prism = false;
    if (type === 'Kreis') type = 'Zylinder';
    if (type === 'Langloch' || type === 'Punkt' || type === 'Freiformfläche' || type === 'Abstand') { prism = type === 'Langloch'; type = 'auto'; }
    const autoType = type === 'auto';
    if (o.prismAxis) prism = true;
    let model = prism ? null : fitOf(seed, type);
    // Sinnprüfung des Saatmodells: Krümmungsradius nicht viel kleiner als der Fleck (sonst Rauschen/Kante)
    if (model && (model.type === 'Zylinder' || model.type === 'Kugel') && (model.radius ?? 0) > 400 * R0) model = fitOf(seed, 'Ebene');
    const resid = (mdl: FitResult, tris: ArrayLike<number>) => { const { P } = ptsOf(tris, 1500); const a = P.map((q) => Math.abs(modelDist(mdl, q))).sort((x, y) => x - y); return 1.4826 * (a[a.length >> 1] ?? 0); };
    const angOf = (mdl: FitResult, tris: ArrayLike<number>) => { const a: number[] = []; for (let i = 0; i < tris.length; i += Math.max(1, Math.floor(tris.length / 800))) { const t = tris[i]; const c = this.cen(t); const mn = modelNormal(mdl, c);
      a.push(Math.acos(Math.min(1, Math.abs(mn[0] * sn[3 * t] + mn[1] * sn[3 * t + 1] + mn[2] * sn[3 * t + 2])))); } a.sort((x, y) => x - y); return a[Math.floor(a.length * 0.9)] ?? 0; };
    let pax: Vec3 | null = o.prismAxis ?? null;
    if (prism && !pax) { const N = ptsOf(seed).N; const a = axisFromNormals(N); // ebener Saat-Fleck: Achse unbestimmt -> Ebene wachsen
      let spread = 0; for (const q of N) spread = Math.max(spread, 1 - Math.abs(q[0] * N[0][0] + q[1] * N[0][1] + q[2] * N[0][2]));
      if (spread > 0.004) pax = a.axis; else { prism = false; model = fitOf(seed, 'Ebene'); } }
    let sigma = model ? resid(model, seed) : 0; let tol0 = Math.min(Math.max(4 * sigma, 0.05 * h), 0.5 * h); let tol = tol0;
    let angTol = model ? Math.min(Math.max(2.5 * angOf(model, seed), (10 * Math.PI) / 180), (30 * Math.PI) / 180) : (25 * Math.PI) / 180;
    if (prism) angTol = (12 * Math.PI) / 180;
    const info: GrowInfo = { model: prism ? 'Prisma' : model ? model.type : 'keins', h, sigma, tol, angDeg: (angTol * 180) / Math.PI, seedTris: seed.length, refits: 0, capped: false };
    const accept = (u: number): boolean => {
      if (prism && pax) { const d = Math.abs(sn[3 * u] * pax[0] + sn[3 * u + 1] * pax[1] + sn[3 * u + 2] * pax[2]); return d < Math.sin(angTol); }
      if (!model) return true;
      for (let k = 0; k < 3; k++) if (Math.abs(modelDist(model, vpos(f[3 * u + k]))) > tol) return false;
      const mn = modelNormal(model, this.cen(u)); return Math.abs(mn[0] * sn[3 * u] + mn[1] * sn[3 * u + 1] + mn[2] * sn[3 * u + 2]) > Math.cos(angTol);
    };
    const inR = new Uint8Array(nt); const out: number[] = [seedTri]; inR[seedTri] = 1; let area = fa[seedTri];
    const cap = 0.6 * this.totalArea; let next = Math.max(40, seed.length * 1.6);
    // Breitensuche (Reihenfolge unabhängig von der Lage im Raum)
    let head = 0; const rej: number[] = [];
    while (head < out.length) {
      const t = out[head++];
      for (const u of this.neighbors(t)) {
        if (inR[u]) continue;
        if (dotN(fn, t, u) < cosA && dotN(sn, t, u) < cosA) continue;
        if (!inRad(u)) continue;
        if (!accept(u)) { inR[u] = 2; rej.push(u); continue; }
        inR[u] = 1; out.push(u); area += fa[u];
        if (area > cap) { info.capped = true; head = out.length; break; }
        if (out.length >= next && model && !prism) {
          // Neu-Fit auf der gewachsenen Region (folgt leichter Formabweichung), Toleranz bleibt am Saat-Rauschen verankert
          const nm = fitOf(out, autoType && info.refits < 2 ? 'auto' : model.type); if (nm) { model = nm; info.refits++; const s2 = resid(nm, out); tol = Math.min(2 * tol0, Math.max(tol0, 3 * s2)); }
          next = out.length * 1.6;
          // abgelehnte Nachbarn mit neuem Modell erneut prüfen
          for (const i of rej) inR[i] = 0; rej.length = 0;
          head = 0;
        }
      }
    }
    info.tol = tol; info.model = prism ? 'Prisma' : model ? model.type : 'keins'; this.lastGrow = info;
    const res: number[] = []; for (let t = 0; t < nt; t++) if (inR[t] === 1) res.push(t);
    return new Uint32Array(res);
  }
  growLegacy(seedTri: number, seedPoint: Vec3, o: GrowOptions, maxTris = Infinity): Uint32Array | null {
    let cnt = 0;
    const m = this.mesh, fn = this.smooth, f = m.indices, p = m.positions;
    const nt = f.length / 3;
    const inR = new Uint8Array(nt);
    const cosA = Math.cos((o.maxAngleDeg * Math.PI) / 180);
    const cosC = o.maxCurvatureDeg ? Math.cos((o.maxCurvatureDeg * Math.PI) / 180) : -2;
    const r2 = o.radius > 0 ? o.radius * o.radius : Infinity;
    const sn = [fn[3 * seedTri], fn[3 * seedTri + 1], fn[3 * seedTri + 2]];
    // Bezugskrümmung: Median der Krümmung in der Saat-Umgebung (kleines Vorwachsen nur mit Winkelkriterium)
    const kap = this.kappa, iso = this.isotropic; let kLo = -1, kHi = Infinity;
    if (iso) {
      const seen = new Set<number>([seedTri]), q = [seedTri], ks: number[] = [];
      while (q.length && ks.length < 80) {
        const t = q.shift()!; ks.push(kap[t]);
        for (const u of this.neighbors(t)) {
          if (seen.has(u)) continue;
          if (fn[3 * t] * fn[3 * u] + fn[3 * t + 1] * fn[3 * u + 1] + fn[3 * t + 2] * fn[3 * u + 2] < cosA) continue;
          seen.add(u); q.push(u);
        }
      }
      ks.sort((a, b) => a - b); const k0 = ks[ks.length >> 1];
      kHi = k0 * 1.8 + 0.2; kLo = k0 / 1.8 - 0.2;
    }
    const stack = [seedTri]; inR[seedTri] = 1;
    const out: number[] = [];
    // Krümmungsprüfung gegen ein "Anker"-Dreieck ~anchorDist zurück auf dem Wachstumspfad:
    // verrundete Kanten (Scan-/CT-Daten) haben kleine Winkel von Dreieck zu Dreieck, aber über ~1 mm einen großen Knick.
    const anchor = new Int32Array(nt).fill(-1), anchor2 = new Int32Array(nt).fill(-1); anchor[seedTri] = anchor2[seedTri] = seedTri;
    const cosK = Math.cos((60 * Math.PI) / 180), D2 = this.anchorDist ** 2;
    const cen = (t: number, k: number) => (p[3 * f[3 * t] + k] + p[3 * f[3 * t + 1] + k] + p[3 * f[3 * t + 2] + k]) / 3;
    const dist2 = (a: number, b: number) => (cen(a, 0) - cen(b, 0)) ** 2 + (cen(a, 1) - cen(b, 1)) ** 2 + (cen(a, 2) - cen(b, 2)) ** 2;
    while (stack.length) {
      const t = stack.pop()!;
      for (const u of this.neighbors(t)) {
        if (inR[u]) continue;
        const c = fn[3 * t] * fn[3 * u] + fn[3 * t + 1] * fn[3 * u + 1] + fn[3 * t + 2] * fn[3 * u + 2];
        if (c < cosA) continue;
        if (cosC > -2 && sn[0] * fn[3 * u] + sn[1] * fn[3 * u + 1] + sn[2] * fn[3 * u + 2] < cosC) continue;
        if (r2 < Infinity) {
          const a = 3 * f[3 * u];
          const dx = p[a] - seedPoint[0], dy = p[a + 1] - seedPoint[1], dz = p[a + 2] - seedPoint[2];
          if (dx * dx + dy * dy + dz * dz > r2) continue;
        }
        if (iso && (kap[u] > kHi || kap[u] < kLo)) continue;
        let an = anchor[t], an2 = anchor2[t];           // an: ≥ D zurück, an2: jüngerer Anker
        if (dist2(u, an2) > D2) { an = an2; an2 = t; }
        if (iso && fn[3 * an] * fn[3 * u] + fn[3 * an + 1] * fn[3 * u + 1] + fn[3 * an + 2] * fn[3 * u + 2] < cosK) continue;
        anchor[u] = an; anchor2[u] = an2;
        inR[u] = 1; if (++cnt > maxTris) return null;
        if (this.sliver[u]) continue; // Splitter: aufnehmen, aber nicht weiterwachsen
        stack.push(u);
      }
    }
    for (let t = 0; t < nt; t++) if (inR[t] === 1) out.push(t);
    return new Uint32Array(out);
  }

  /** Knoten der Region; bevorzugt innere Knoten (alle anliegenden Dreiecke in der Region),
   *  damit Kantenpunkte mit gemischten Normalen den Fit nicht stören. */
  regionVertices(tris: Uint32Array): { all: Uint32Array; interior: Uint32Array } {
    const m = this.mesh, f = m.indices, nv = m.positions.length / 3, { offsets } = this.vt;
    const cnt = new Uint32Array(nv);
    for (const t of tris) for (let k = 0; k < 3; k++) cnt[f[3 * t + k]]++;
    const all: number[] = [], interior: number[] = [];
    for (let v = 0; v < nv; v++) if (cnt[v]) {
      all.push(v);
      if (cnt[v] === offsets[v + 1] - offsets[v]) interior.push(v);
    }
    return { all: new Uint32Array(all), interior: new Uint32Array(interior) };
  }
}

/** Pinsel: Knoten innerhalb radius um einen Punkt, deren Normale zur Blickseite zeigt. */
export function brushSelect(m: MeshData, center: Vec3, radius: number, facing?: Vec3): Uint32Array {
  const p = m.positions, n = m.vertexNormals, r2 = radius * radius, out: number[] = [];
  for (let v = 0; v < p.length / 3; v++) {
    const dx = p[3 * v] - center[0], dy = p[3 * v + 1] - center[1], dz = p[3 * v + 2] - center[2];
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    if (facing && n && n[3 * v] * facing[0] + n[3 * v + 1] * facing[1] + n[3 * v + 2] * facing[2] < 0) continue;
    out.push(v);
  }
  return new Uint32Array(out);
}

/** Punkte/Normalen einer Knotenmenge holen, ggf. gleichmäßig ausdünnen. */
export function gather(m: MeshData, idx: Uint32Array, maxPts = 30000): { p: Vec3[]; n: Vec3[] } {
  const step = Math.max(1, Math.ceil(idx.length / maxPts));
  const P: Vec3[] = [], N: Vec3[] = [];
  const pos = m.positions, nr = m.vertexNormals;
  for (let i = 0; i < idx.length; i += step) {
    const v = idx[i];
    P.push([pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]]);
    if (nr) N.push([nr[3 * v], nr[3 * v + 1], nr[3 * v + 2]]);
  }
  return { p: P, n: N };
}
