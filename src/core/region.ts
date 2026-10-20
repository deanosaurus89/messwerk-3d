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
  /** seed patch radius around the click [mm] (pick circle); 0/undefined = automatic 6 × local edge length */
  seedR?: number;
  /** 0.36: reine Nachbarschaft (ohne Krümmungs-/Ankerkriterium), z. B. Umgebungs-Scan am Rand */ noCurv?: boolean;
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
export interface GrowInfo { model: GeomType | 'Prisma' | 'keins'; h: number; sigma: number; tol: number; angDeg: number; seedTris: number; refits: number; capped: boolean; legacy?: boolean; rejectedRefits?: number; }

export class MeshTopology {
  vt: { offsets: Uint32Array; tris: Uint32Array };
  smooth: Float32Array; // 0.36: robuste Dreiecksnormalen (Mittel der Nachbarschafts-Ebenen-Normalen ihrer Knoten)
  /** 0.36: robuste Knotennormale – Ebenen-Fit (PCA) über alle Punkte im Radius 1,3 × lokale mittlere Kantenlänge
   *  (mind. ROBUST_MIN Punkte, sonst Radius ×1,5, max. 3×). Unempfindlich gegen Nadeldreiecke + Rauschen. */
  robustVN: Float32Array;
  /** Rechenzeit der robusten Normalen [ms] (Bericht/Tests) */
  robustMs = 0;
  /** Nadeldreiecke (1 = robuste Normale) */
  needle: Uint8Array; needleCount = 0;
  constructor(public mesh: MeshData) {
    this.vt = vertexTriangles(mesh); const nt0 = mesh.indices.length / 3; this.sReady = new Uint8Array(nt0); this.kReady = new Uint8Array(nt0);
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // Nadel-/Splitterdreiecke (Formqualität q < NEEDLE_Q): eigene Normale ist vom Rauschen dominiert -> robuste Nachbarschafts-Normale.
    // Gut geformte Dreiecke behalten ihre Normale (dort stimmen Dreiecks- und Nachbarschaftsnormale überein, gemessen: p95 < 3°),
    // damit scharfe Kanten zwischen Regelgeometrien scharf bleiben (die Nachbarschaftsnormale verschmiert sie über ±R).
    // 0.37 (Martin 19.10. 21:52): EINE Methode für alle Dreiecke – Knotennormale = Nachbarschafts-Ebenen-Fit
    // (robust gewichtet, siehe robustVertexNormals), Dreiecksnormale = Mittel ihrer drei Knotennormalen. Kein Formschalter.
    this.needle = needleTris(mesh); this.needleCount = 0; for (const x of this.needle) this.needleCount += x;
    if (NORMAL_MODE === 'needle036') {
      this.robustVN = robustVertexNormals(mesh, this.vt, ROBUST_K, ROBUST_MIN, verticesOf(mesh, this.needle), false);
      const rt = triFromVertex(mesh, this.robustVN), fn0 = mesh.faceNormals!; this.smooth = new Float32Array(fn0);
      for (let t = 0; t < this.needle.length; t++) if (this.needle[t]) for (let k = 0; k < 3; k++) this.smooth[3 * t + k] = rt[3 * t + k];
      this.sReady.fill(1);
    } else {
      // 0.38: lazy – Knoten-/Dreiecksnormalen erst beim ersten Zugriff (Wachstumsfront), dann im Cache
      this.rn = new RobustNormals(mesh, this.vt, ROBUST_K, ROBUST_MIN, NORMAL_MODE === 'robust');
      this.robustVN = this.rn.out; this.smooth = new Float32Array(mesh.faceNormals!);
    }
    this.robustMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    this.sliver = this.findSlivers();
    this.anchorDist = Math.max(1.0, 1.2 * this.medianEdge());
    this.isotropic = this.checkIsotropic();
    this.kappa = new Float32Array(this.isotropic ? nt0 : 0); this.kRaw = new Float32Array(this.isotropic ? nt0 : 0); this.kRawReady = new Uint8Array(this.isotropic ? nt0 : 0);
  }
  rn: RobustNormals | null = null; sReady: Uint8Array; kReady: Uint8Array; kRaw: Float32Array; kRawReady: Uint8Array;
  /** robuste Dreiecksnormale t (lazy): gibt das Normalen-Array zurück, Eintrag t ist danach gültig */
  N(t: number): Float32Array {
    if (this.sReady[t]) return this.smooth; this.sReady[t] = 1;
    const f = this.mesh.indices, rn = this.rn!, o = rn.out; let x = 0, y = 0, z = 0;
    const a = 3 * f[3 * t], b = 3 * f[3 * t + 1], c = 3 * f[3 * t + 2]; rn.get(a / 3); rn.get(b / 3); rn.get(c / 3);
    // Mehrheitsregel (kantenerhaltend): liegt ein Knoten des Dreiecks schon auf der Nachbarfläche (Normale > 15° von den
    // beiden anderen), zählen nur die zwei übereinstimmenden Knoten – sonst entstünden an Kanten Mischnormalen.
    const d = (i: number, j: number) => o[i] * o[j] + o[i + 1] * o[j + 1] + o[i + 2] * o[j + 2];
    const dab = d(a, b), dbc = d(b, c), dca = d(c, a), C15 = 0.9659; void dab;
    let use = [a, b, c];
    if (Math.min(dab, dbc, dca) < C15) {
      // Knoten uneinig (Dreieck berührt eine Kante): Anker = Knotennormale, die der eigenen Flächennormale am nächsten
      // liegt (sagt, auf welcher Seite das Dreieck liegt); gemittelt werden nur Knoten innerhalb 15° davon.
      const fn = this.mesh.faceNormals!; let bi = a, bd = -2;
      for (const i of [a, b, c]) { const q = o[i] * fn[3 * t] + o[i + 1] * fn[3 * t + 1] + o[i + 2] * fn[3 * t + 2]; if (q > bd) { bd = q; bi = i; } }
      use = [a, b, c].filter((i) => i === bi || d(i, bi) >= C15);
    }
    for (const i of use) { x += o[i]; y += o[i + 1]; z += o[i + 2]; }
    const l = Math.hypot(x, y, z) || 1; const s = this.smooth; s[3 * t] = x / l; s[3 * t + 1] = y / l; s[3 * t + 2] = z / l; return s;
  }
  /** Normalen für das fit-geführte Wachsen (needle036: alte 1-Ring-Normalen außer Nadeln) */
  NF(t: number): Float32Array { return NORMAL_MODE === 'needle036' ? this.smoothN : this.N(t); }
  /** alle Normalen vorab (Tests/Vergleich) */
  allN(): Float32Array { for (let t = 0; t < this.sReady.length; t++) this.N(t); return this.smooth; }
  private cenK(t: number, out: number[]) { const p = this.mesh.positions, f = this.mesh.indices; for (let k = 0; k < 3; k++) out[k] = (p[3 * f[3 * t] + k] + p[3 * f[3 * t + 1] + k] + p[3 * f[3 * t + 2] + k]) / 3; }
  // 0.38: Krümmung aus den Dreiecks-Flächennormalen (nur auf isotropen Netzen benutzt – dort sind sie gut definiert):
  // die geglätteten Nachbarschaftsnormalen verbreitern den Krümmungsanstieg an Kanten auf ±R und senken den
  // Grundwert -> die relative Schwelle (1,8·k0 + 0,2) schnitt dann 0,5–1 mm vor der Kante ab (gemessen, research/edge037).
  private kr(t: number): number {
    if (this.kRawReady[t]) return this.kRaw[t]; this.kRawReady[t] = 1;
    const ct = [0, 0, 0], cu = [0, 0, 0]; this.cenK(t, ct); const fn = this.mesh.faceNormals!; let s = 0, n = 0;
    for (const u of this.neighbors(t)) { this.cenK(u, cu); const d = Math.hypot(cu[0] - ct[0], cu[1] - ct[1], cu[2] - ct[2]); if (d < 1e-9) continue;
      const dot = fn[3 * t] * fn[3 * u] + fn[3 * t + 1] * fn[3 * u + 1] + fn[3 * t + 2] * fn[3 * u + 2]; s += Math.acos(Math.max(-1, Math.min(1, dot))) / d; n++; }
    return (this.kRaw[t] = n ? s / n : 0);
  }
  /** lokale Krümmung t (lazy, 1-Ring-geglättet) */
  K(t: number): number {
    if (this.kReady[t]) return this.kappa[t]; this.kReady[t] = 1;
    let s = this.kr(t), n = 1; for (const u of this.neighbors(t)) { s += this.kr(u); n++; } return (this.kappa[t] = s / n);
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
  /** Bezugsabstand für die Krümmungsprüfung beim Wachsen (≈ 1 mm bzw. 1,2 × mittlere Kantenlänge). */
  anchorDist: number;
  medianEdge(): number {
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
  get smoothN(): Float32Array {
    if (this._sn) return this._sn; if (NORMAL_MODE !== 'needle036') return (this._sn = this.allN()); const o = this.smoothNormals();
    for (let t = 0; t < this.needle.length; t++) if (this.needle[t]) for (let k = 0; k < 3; k++) o[3 * t + k] = this.smooth[3 * t + k];
    return (this._sn = o); }
  /** alte 1-Ring-Glättung (nur Vergleich) */
  get oneRingN(): Float32Array { return this.smoothNormals(); }
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
  growCalls = 0;
  growRegion(seedTri: number, seedPoint: Vec3, o: GrowOptions): Uint32Array {
    this.growCalls++;
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
      if (r !== null && r < 0.3 * h) { this.lastGrow = { model: 'keins', h, sigma: r, tol: 0.3 * h, angDeg: o.maxAngleDeg, seedTris: 0, refits: 0, capped: false, legacy: true }; return this.closeHoles(L); }
    }
    this.lastGrow = fitInfo; return o.strict ? new Uint32Array(0) : this.closeHoles(F);
  }
  /** 0.36 Sicherheitsnetz (morphologisches Schließen): kleine, vollständig von der Region umschlossene Flecken
   *  nicht gewählter Dreiecke (≤ maxTris, Ausdehnung ≤ 3 × Kantenlänge, nicht am Netzrand) werden aufgenommen –
   *  so entstehen keine Splitter-Schleifen um einzelne Punkte. Echte Inseln (größer) bleiben. */
  closeHoles(R: Uint32Array, maxTris = 24): Uint32Array {
    if (R.length < 3) return R;
    const nt = this.mesh.indices.length / 3, f = this.mesh.indices, p = this.mesh.positions; const inR = new Uint8Array(nt); for (const t of R) inR[t] = 1;
    const seen = new Uint8Array(nt); const add: number[] = []; const h = this.medianEdge(), lim2 = (3 * h) ** 2;
    const bnd = this.boundaryVerts();
    for (const t of R) for (const u0 of this.neighbors(t)) {
      if (inR[u0] || seen[u0]) continue;
      const comp = [u0]; seen[u0] = 1; let ok = true;
      for (let i = 0; i < comp.length && ok; i++) { const u = comp[i];
        for (let k = 0; k < 3; k++) if (bnd[f[3 * u + k]]) { ok = false; break; }
        for (const w of this.neighbors(u)) { if (inR[w] || seen[w]) continue; seen[w] = 1; comp.push(w); if (comp.length > maxTris) { ok = false; break; } } }
      if (!ok) continue;
      // Ausdehnung prüfen
      const a = 3 * f[3 * comp[0]]; let mx = 0;
      for (const u of comp) for (let k = 0; k < 3; k++) { const b = 3 * f[3 * u + k]; mx = Math.max(mx, (p[a] - p[b]) ** 2 + (p[a + 1] - p[b + 1]) ** 2 + (p[a + 2] - p[b + 2]) ** 2); }
      if (mx <= lim2) add.push(...comp);
    }
    if (!add.length) return R;
    for (const t of add) inR[t] = 1; const out: number[] = []; for (let t = 0; t < nt; t++) if (inR[t]) out.push(t);
    this.lastClosed = add.length; return new Uint32Array(out);
  }
  lastClosed = 0;
  private _bv: Uint8Array | null = null;
  /** Knoten am offenen Netzrand (Kante nur in einem Dreieck) */
  boundaryVerts(): Uint8Array {
    if (this._bv) return this._bv;
    const f = this.mesh.indices, nv = this.mesh.positions.length / 3, { offsets, tris } = this.vt; const out = new Uint8Array(nv);
    for (let v = 0; v < nv; v++) { // Kante v–w offen, wenn genau ein gemeinsames Dreieck
      const cnt = new Map<number, number>();
      for (let j = offsets[v]; j < offsets[v + 1]; j++) { const t = tris[j]; for (let k = 0; k < 3; k++) { const w = f[3 * t + k]; if (w !== v) cnt.set(w, (cnt.get(w) ?? 0) + 1); } }
      for (const c of cnt.values()) if (c === 1) { out[v] = 1; break; } }
    return (this._bv = out);
  }
  localEdge(seedTri: number): number {
    const f = this.mesh.indices, p = this.mesh.positions; const near: number[] = []; const seen = new Set([seedTri]), q = [seedTri];
    while (q.length && near.length < 150) { const t = q.shift()!; near.push(t); for (const u of this.neighbors(t)) if (!seen.has(u)) { seen.add(u); q.push(u); } }
    const el = near.map((t) => { const a = f[3 * t], b = f[3 * t + 1]; return Math.hypot(p[3 * a] - p[3 * b], p[3 * a + 1] - p[3 * b + 1], p[3 * a + 2] - p[3 * b + 2]); }).sort((x, y) => x - y);
    return el[el.length >> 1] || 1;
  }
  /** RMS der besten Regelgeometrie (autoFit) an eine Dreiecksmenge, null wenn nicht bestimmbar. */
  regionRms(tris: ArrayLike<number>, lim = 0, planeOnly = false): number | null {
    const f = this.mesh.indices, p = this.mesh.positions, sn0 = 0; void sn0; const seen = new Set<number>(); const P: Vec3[] = [], N: Vec3[] = [];
    const step = Math.max(1, Math.floor(tris.length / 400));
    for (let i = 0; i < tris.length; i += step) { const t = tris[i]; for (let k = 0; k < 3; k++) { const v = f[3 * t + k]; if (seen.has(v)) continue; seen.add(v); P.push([p[3 * v], p[3 * v + 1], p[3 * v + 2]]); N.push([this.NF(t)[3 * t], this.NF(t)[3 * t + 1], this.NF(t)[3 * t + 2]]); } }
    if (P.length < 6) return 0;
    try { const pl = fitType('Ebene', P, N); if (pl.rms < lim) return pl.rms;
      // prismatisch (Zylinder, Langloch, beliebige Wand): alle Normalen ⟂ einer Achse
      const ax = axisFromNormals(N).axis; const d = N.map((q) => Math.abs(q[0] * ax[0] + q[1] * ax[1] + q[2] * ax[2])).sort((x, y) => x - y);
      if (d[Math.floor(d.length * 0.95)] < 0.05) return 0;
      if (planeOnly && tris.length > 0.1 * this.mesh.indices.length / 3) return null; // ebene Saat, sehr große Region: Region muss Ebene oder prismatische Wand sein (keine teuren Fits)
      for (const ty of ['Zylinder', 'Kugel', 'Kegel'] as GeomType[]) { try { const c = fitType(ty, P, N); if (c.rms < lim) return c.rms; } catch { /* weiter */ } }
      const r = autoFit(P, N); const c = [r.best, ...r.candidates].filter((x) => x && x.type !== 'Freiformfläche' && isFinite(x.rms)).map((x) => x.rms); return c.length ? Math.min(...c) : null; } catch { return null; }
  }
  /** Normale für das fit-geführte Wachsen: die einheitliche kantenbewusste Dreiecksnormale (0.38.1; vorher NF = geglättet) */
  GN(t: number): Float32Array { return GNF ? this.NF(t) : this.N(t); }
  /** Neu-Fit verträglich mit dem Saat-Fit? Saat-Restabstand höchstens wenig größer, Normalenstreuung auf der Saat ≤ +2° */
  consistent(nm: FitResult, sm: FitResult, seed: number[], resid: (m: FitResult, t: ArrayLike<number>) => number, angQ: (m: FitResult, t: ArrayLike<number>, q: number) => number, tol0: number): boolean {
    if (nm.type !== sm.type) return true; // Typwechsel (Auto) folgt dem Typtest
    if (resid(nm, seed) > Math.max(1.5 * resid(sm, seed), tol0 / 3)) return false;
    return angQ(nm, seed, 0.5) <= angQ(sm, seed, 0.5) + (2 * Math.PI) / 180;
  }
  growFit(seedTri: number, seedPoint: Vec3, o: GrowOptions): Uint32Array {
    const m = this.mesh, f = m.indices, p = m.positions, nt = f.length / 3, fa = m.faceAreas!, fn = m.faceNormals!;
    const cosA = Math.cos((Math.max(1, o.maxAngleDeg) * Math.PI) / 180);
    const r2 = o.radius > 0 ? o.radius * o.radius : Infinity;
    const vpos = (v: number): Vec3 => [p[3 * v], p[3 * v + 1], p[3 * v + 2]];
    const inRad = (t: number) => { if (r2 === Infinity) return true; const a = 3 * f[3 * t]; return (p[a] - seedPoint[0]) ** 2 + (p[a + 1] - seedPoint[1]) ** 2 + (p[a + 2] - seedPoint[2]) ** 2 <= r2; };
    const dotS = (a: number, b: number) => { this.GN(a); const N = this.GN(b); return N[3 * a] * N[3 * b] + N[3 * a + 1] * N[3 * b + 1] + N[3 * a + 2] * N[3 * b + 2]; };
    const dotN = (N: Float32Array, a: number, b: number) => N[3 * a] * N[3 * b] + N[3 * a + 1] * N[3 * b + 1] + N[3 * a + 2] * N[3 * b + 2];
    // 1) lokale Kantenlänge
    const near: number[] = []; { const seen = new Set([seedTri]), q = [seedTri]; while (q.length && near.length < 150) { const t = q.shift()!; near.push(t); for (const u of this.neighbors(t)) if (!seen.has(u)) { seen.add(u); q.push(u); } } }
    const el: number[] = []; for (const t of near) { const a = f[3 * t], b = f[3 * t + 1]; el.push(Math.hypot(p[3 * a] - p[3 * b], p[3 * a + 1] - p[3 * b + 1], p[3 * a + 2] - p[3 * b + 2])); }
    el.sort((x, y) => x - y); const h = el[el.length >> 1] || 1;
    // 2) Saat-Fleck: glatte Nachbarn (Winkel zur Saat < 25°) im Radius 8h um den Klickpunkt
    const R0 = o.seedR && o.seedR > 0 ? o.seedR : SEEDG ? 6 * this.medianEdge() : 6 * h, cos0 = Math.cos((15 * Math.PI) / 180); const seed: number[] = []; const sMark = new Uint8Array(nt);
    // 0.39 (Martin): Saat = Fläche im Pick-Kreis (wie angezeigt: Pick-Radius bzw. 6 × Median-Kantenlänge des Netzes).
    // Große Dreiecke zählen, sobald eine Ecke im Kreis liegt; reicht das nicht für einen Fit (< 12 Punkte), wird der Kreis
    // minimal erweitert – nie wird ohne Saat-Fit gewachsen.
    let Rp = R0; const d2 = (q: ArrayLike<number>) => (q[0] - seedPoint[0]) ** 2 + (q[1] - seedPoint[1]) ** 2 + (q[2] - seedPoint[2]) ** 2;
    const inPick = (u: number, c: ArrayLike<number>) => { if (d2(c) <= Rp * Rp) return true; if (!SEEDG) return false; for (let k = 0; k < 3; k++) if (d2(vpos(f[3 * u + k])) <= Rp * Rp) return true; return false; };
    for (let pass = 0; pass < 6; pass++) { seed.length = 0; sMark.fill(0);
    { const q = [seedTri]; sMark[seedTri] = 1; while (q.length) { const t = q.shift()!; seed.push(t); for (const u of this.neighbors(t)) { if (sMark[u]) continue; const c = this.cen(u);
      if (!inPick(u, c)) continue; if (dotS(seedTri, u) < cos0) continue; sMark[u] = 1; q.push(u); } } }
    if (!SEEDG || seed.length * 0.5 + 3 >= 12) break; Rp *= 1.5; }
    const ptsOf = (tris: ArrayLike<number>, max = 3000) => { const seenV = new Set<number>(); const P: Vec3[] = [], N: Vec3[] = []; const step = Math.max(1, Math.floor(tris.length / max));
      for (let i = 0; i < tris.length; i += step) { const t = tris[i]; for (let k = 0; k < 3; k++) { const v = f[3 * t + k]; if (seenV.has(v)) continue; seenV.add(v); P.push(vpos(v)); } N.push([this.GN(t)[3 * t], this.GN(t)[3 * t + 1], this.GN(t)[3 * t + 2]]); }
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
    // 0.38.1: Winkelstreuung FLÄCHENgewichtet – auf adaptiven Scans liegen viele kleine Dreiecke in den Verrundungen,
    // eine Stückzahl-Quantile misst dann die Verrundung statt der Fläche (Toleranz lief auf 30°).
    const angQ = (mdl: FitResult, tris: ArrayLike<number>, q: number) => { const a: [number, number][] = []; let W = 0; for (let i = 0; i < tris.length; i += Math.max(1, Math.floor(tris.length / 1500))) { const t = tris[i]; const mn = modelNormal(mdl, this.cen(t)); const n = this.GN(t);
      const w = AW ? fa[t] : 1; W += w; a.push([Math.acos(Math.min(1, Math.abs(mn[0] * n[3 * t] + mn[1] * n[3 * t + 1] + mn[2] * n[3 * t + 2]))), w]); } a.sort((x, y) => x[0] - y[0]);
      let c = 0; for (const [v, w] of a) { c += w; if (c >= q * W) return v; } return a.length ? a[a.length - 1][0] : 0; };
    const angOf = (mdl: FitResult, tris: ArrayLike<number>) => angQ(mdl, tris, 0.9);
    const angRob = (mdl: FitResult, tris: ArrayLike<number>) => 1.4826 * angQ(mdl, tris, 0.5);
    let pax: Vec3 | null = o.prismAxis ?? null;
    if (prism && !pax) { const N = ptsOf(seed).N; const a = axisFromNormals(N); // ebener Saat-Fleck: Achse unbestimmt -> Ebene wachsen
      let spread = 0; for (const q of N) spread = Math.max(spread, 1 - Math.abs(q[0] * N[0][0] + q[1] * N[0][1] + q[2] * N[0][2]));
      if (spread > 0.004) pax = a.axis; else { prism = false; model = fitOf(seed, 'Ebene'); } }
    let sigma = model ? resid(model, seed) : 0; let tol0 = Math.min(Math.max(3 * sigma, 0.05 * h), 0.5 * h); let tol = tol0; // 0.36: 3σ (vorher 4σ), geprüft am Dreiecksschwerpunkt
    let angTol = model ? Math.min(Math.max(2.5 * angOf(model, seed), (10 * Math.PI) / 180), (30 * Math.PI) / 180) : (25 * Math.PI) / 180;
    if (prism) angTol = (12 * Math.PI) / 180;
    const angTol0 = angTol; const seedModel = model;
    const info: GrowInfo = { model: prism ? 'Prisma' : model ? model.type : 'keins', h, sigma, tol, angDeg: (angTol * 180) / Math.PI, seedTris: seed.length, refits: 0, capped: false };
    const accept = (u: number): boolean => {
      if (prism && pax) { const d = Math.abs(this.GN(u)[3 * u] * pax[0] + this.GN(u)[3 * u + 1] * pax[1] + this.GN(u)[3 * u + 2] * pax[2]); return d < Math.sin(angTol); }
      if (!model) return true;
      // 0.36: Abstand zum mitwachsenden Fit < 3σ am Schwerpunkt (Rauschen /√3), jeder Knoten < 1,5 × Toleranz
      for (let k = 0; k < 3; k++) if (Math.abs(modelDist(model, vpos(f[3 * u + k]))) > 1.5 * tol) return false;
      if (Math.abs(modelDist(model, this.cen(u))) > tol) return false;
      const mn = modelNormal(model, this.cen(u)); return Math.abs(mn[0] * this.GN(u)[3 * u] + mn[1] * this.GN(u)[3 * u + 1] + mn[2] * this.GN(u)[3 * u + 2]) > Math.cos(angTol);
    };
    const inR = new Uint8Array(nt); const out: number[] = [seedTri]; inR[seedTri] = 1; let area = fa[seedTri];
    const cap = 0.6 * this.totalArea; let next = Math.max(40, seed.length * 1.6);
    // Breitensuche (Reihenfolge unabhängig von der Lage im Raum)
    let head = 0; const rej: number[] = [];
    while (head < out.length) {
      const t = out[head++];
      for (const u of this.neighbors(t)) {
        if (inR[u]) continue;
        if (dotN(fn, t, u) < cosA && dotS(t, u) < cosA) continue;
        if (!inRad(u)) continue;
        if (!accept(u)) { inR[u] = 2; rej.push(u); continue; }
        inR[u] = 1; out.push(u); area += fa[u];
        if (area > cap) { info.capped = true; head = out.length; break; }
        if (out.length >= next && model && !prism) {
          // Neu-Fit auf der gewachsenen Region (folgt leichter Formabweichung), Toleranz bleibt am Saat-Rauschen verankert
          const nm0 = fitOf(out, autoType && info.refits < 2 ? 'auto' : model.type);
          // 0.39 (Martin): Bezug ist der Saat-Fit aus dem Pick-Kreis. Ein Neu-Fit wird nur übernommen, wenn er die Saat
          // weiterhin so gut beschreibt wie der Saat-Fit (Abstand + Normalenwinkel) – eine ausgelaufene Region kann den
          // Bezug so nie verkippen. Für alle Typen gleich.
          const nm = nm0 && (!GUARD || this.consistent(nm0, seedModel!, seed, resid, angQ, tol0)) ? nm0 : null; if (nm0 && !nm) info.rejectedRefits = (info.rejectedRefits ?? 0) + 1; if (nm) { model = nm; info.refits++; const s2 = resid(nm, out);
            if (TIGHT) { // 0.38.1: Toleranzen aus der gewachsenen Region robust neu schätzen (Median statt 90 %) – nie weiter als die Saat
              tol = Math.min(tol0, Math.max(TFLOOR * h, 3 * s2)); angTol = Math.min(angTol0, Math.max((3 * Math.PI) / 180, TK * angRob(nm, out)));
            } else tol = Math.min(2 * tol0, Math.max(tol0, 3 * s2)); }
          next = out.length * 1.6;
          // abgelehnte Nachbarn mit neuem Modell erneut prüfen
          for (const i of rej) inR[i] = 0; rej.length = 0;
          head = 0;
        }
      }
    }
    if (TIGHT && model && !prism && info.refits > 0) {
      // 0.38.1: Endprüfung gegen die zuletzt gefittete Geometrie – zusammenhängend ab der Saat, ohne weiteres Nachfitten.
      // (Über eine Verrundung wandert die Normale schrittweise; der Vergleich mit dem Endmodell schneidet diesen Ausläufer ab.)
      const keep = new Uint8Array(nt); const q = [seedTri]; keep[seedTri] = 1;
      for (let i = 0; i < q.length; i++) for (const u of this.neighbors(q[i])) if (inR[u] === 1 && !keep[u]) { keep[u] = 1; if (accept(u)) q.push(u); else keep[u] = 2; }
      for (let t = 0; t < nt; t++) if (inR[t] === 1 && keep[t] !== 1) inR[t] = 0;
    }
    info.angDeg = (angTol * 180) / Math.PI;
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
    const sn = [this.N(seedTri)[3 * seedTri], this.N(seedTri)[3 * seedTri + 1], this.N(seedTri)[3 * seedTri + 2]];
    // Bezugskrümmung: Median der Krümmung in der Saat-Umgebung (kleines Vorwachsen nur mit Winkelkriterium)
    const kap = this.kappa, iso = this.isotropic && !o.noCurv; let kLo = -1, kHi = Infinity;
    if (iso) {
      const seen = new Set<number>([seedTri]), q = [seedTri], ks: number[] = [];
      while (q.length && ks.length < 80) {
        const t = q.shift()!; ks.push(this.K(t));
        for (const u of this.neighbors(t)) {
          if (seen.has(u)) continue;
          if (this.N(t)[3 * t] * this.N(u)[3 * u] + this.N(t)[3 * t + 1] * this.N(u)[3 * u + 1] + this.N(t)[3 * t + 2] * this.N(u)[3 * u + 2] < cosA) continue;
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
        const c = this.N(t)[3 * t] * this.N(u)[3 * u] + this.N(t)[3 * t + 1] * this.N(u)[3 * u + 1] + this.N(t)[3 * t + 2] * this.N(u)[3 * u + 2];
        if (c < cosA) continue;
        if (cosC > -2 && sn[0] * this.N(u)[3 * u] + sn[1] * this.N(u)[3 * u + 1] + sn[2] * this.N(u)[3 * u + 2] < cosC) continue;
        if (r2 < Infinity) {
          const a = 3 * f[3 * u];
          const dx = p[a] - seedPoint[0], dy = p[a + 1] - seedPoint[1], dz = p[a + 2] - seedPoint[2];
          if (dx * dx + dy * dy + dz * dz > r2) continue;
        }
        if (iso && (this.K(u) > kHi || this.K(u) < kLo)) continue;
        let an = anchor[t], an2 = anchor2[t];           // an: ≥ D zurück, an2: jüngerer Anker
        if (dist2(u, an2) > D2) { an = an2; an2 = t; }
        if (iso && this.N(an)[3 * an] * this.N(u)[3 * u] + this.N(an)[3 * an + 1] * this.N(u)[3 * u + 1] + this.N(an)[3 * an + 2] * this.N(u)[3 * u + 2] < cosK) continue;
        anchor[u] = an; anchor2[u] = an2;
        inR[u] = 1; if (++cnt > maxTris) return null;
        if (this.sliver[u] && !this.needle[u]) continue; // Splitter: aufnehmen, aber nicht weiterwachsen (0.36: mit robuster Normale schon)
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

export const ROBUST_MIN = 10, ROBUST_K = 1.3, NEEDLE_Q = 0.3;
/** Normalenverfahren: 'robust' = Standard ab 0.37 (gewichteter Nachbarschafts-Fit für alle), 'plain' = ungewichteter Fit für alle,
 *  'needle036' = 0.36 (nur Nadeldreiecke) – die beiden letzten nur für Vergleichsmessungen. */
export const ROBUST_HARD = +((globalThis as any).process?.env?.RHARD ?? 2);
export const ROBUST_HA = +((globalThis as any).process?.env?.RHA ?? 15);
export const ROBUST_CT = +((globalThis as any).process?.env?.RCT ?? 0.5);
export const ROBUST_CAND = ((globalThis as any).process?.env?.RCAND ?? '1') !== '0';
const _env = (globalThis as any).process?.env ?? {};
export const GNF = (_env.GNF ?? '0') === '1';
export const AW = (_env.AW ?? '1') !== '0';
export const SEEDG = (_env.SEEDG ?? '1') !== '0';
export const GUARD = (_env.GUARD ?? '1') !== '0';
export const TIGHT = (_env.TIGHT ?? '0') === '1'; const TFLOOR = +(_env.TFLOOR ?? 0.05); const TK = +(_env.TK ?? 4);
export let NORMAL_MODE: 'robust' | 'plain' | 'needle036' = 'robust';
export function setNormalMode(m: typeof NORMAL_MODE) { NORMAL_MODE = m; }
export let ROBUST_VSTART = !!(globalThis as any).process?.env?.RVS, ROBUST_IT = +((globalThis as any).process?.env?.RIT ?? 3);
export let ROBUST_NW = +((globalThis as any).process?.env?.RNW ?? 0);
export let ROBUST_S = +((globalThis as any).process?.env?.RS ?? 0.05); export function setRobustS(x: number) { ROBUST_S = x; }
export function needleTris(m: MeshData, qmin = NEEDLE_Q): Uint8Array {
  const p = m.positions, f = m.indices, fa = m.faceAreas!, nt = f.length / 3, out = new Uint8Array(nt);
  const d2 = (a: number, b: number) => (p[a] - p[b]) ** 2 + (p[a + 1] - p[b + 1]) ** 2 + (p[a + 2] - p[b + 2]) ** 2;
  for (let t = 0; t < nt; t++) { const a = 3 * f[3 * t], b = 3 * f[3 * t + 1], c = 3 * f[3 * t + 2]; const s = d2(a, b) + d2(b, c) + d2(c, a); out[t] = s > 0 && (4 * Math.sqrt(3) * fa[t]) / s < qmin ? 1 : 0; }
  return out;
}
function verticesOf(m: MeshData, mark: Uint8Array): Uint8Array { const f = m.indices, out = new Uint8Array(m.positions.length / 3); for (let t = 0; t < mark.length; t++) if (mark[t]) { out[f[3 * t]] = out[f[3 * t + 1]] = out[f[3 * t + 2]] = 1; } return out; }
/** 0.36: robuste Knotennormalen (siehe MeshTopology.robustVN). Nachbarschaft über das Netz (nicht durch dünne Wände),
 *  Radius R = 1,3 × Median der anliegenden Kantenlängen; kleinster Eigenvektor der Kovarianz per inverser Potenziteration-Variante. */
/** 0.38: robuste Knotennormalen bei Bedarf (lazy, mit Cache) – gleiches Verfahren für alle Knoten. */
export class RobustNormals {
  readonly out: Float32Array; readonly done: Uint8Array; private stamp: Int32Array; private q: Int32Array; private W = new Float64Array(4096); private el: number[] = []; private tag = 0;
  computed = 0; ms = 0;
  constructor(private m: MeshData, private vt: { offsets: Uint32Array; tris: Uint32Array }, private k = ROBUST_K, private minPts = ROBUST_MIN, private weighted = true) {
    const nv = m.positions.length / 3; this.out = new Float32Array(3 * nv); this.done = new Uint8Array(nv); this.stamp = new Int32Array(nv).fill(-1); this.q = new Int32Array(nv);
  }
  /** Knotennormale v (berechnet beim ersten Zugriff) */
  get(v: number): Float32Array { if (!this.done[v]) { this.done[v] = 1; this.computed++; const t0 = performance.now(); this.compute(v); this.ms += performance.now() - t0; } return this.out; }
  private compute(v: number): void {
    const m = this.m, p = m.positions, f = m.indices, vn = m.vertexNormals!, { offsets, tris } = this.vt, k = this.k, minPts = this.minPts, weighted = this.weighted;
    const out = this.out, stamp = this.stamp, q = this.q, W = this.W, el = this.el;
    out[3 * v] = vn[3 * v]; out[3 * v + 1] = vn[3 * v + 1]; out[3 * v + 2] = vn[3 * v + 2];
    const o0 = offsets[v], o1 = offsets[v + 1]; if (o1 === o0) return;
    el.length = 0;
    for (let j = o0; j < o1; j++) { const t = tris[j]; for (let e = 0; e < 3; e++) { const a = f[3 * t + e], b = f[3 * t + (e + 1) % 3]; el.push(Math.hypot(p[3 * a] - p[3 * b], p[3 * a + 1] - p[3 * b + 1], p[3 * a + 2] - p[3 * b + 2])); } }
    el.sort((x, y) => x - y); let R = k * (el[el.length >> 1] || 1);
    const px = p[3 * v], py = p[3 * v + 1], pz = p[3 * v + 2];
    let nb = 0; let n = 0, sx = 0, sy = 0, sz = 0, xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
    for (let tries = 0; tries < 4; tries++) {
      const R2 = R * R, tag = ++this.tag; let head = 0, tail = 0; q[tail++] = v; stamp[v] = tag; void head;
      n = 0; sx = sy = sz = xx = xy = xz = yy = yz = zz = 0;
      while (head < tail) { const w = q[head++]; const dx = p[3 * w] - px, dy = p[3 * w + 1] - py, dz = p[3 * w + 2] - pz;
        n++; sx += dx; sy += dy; sz += dz; xx += dx * dx; xy += dx * dy; xz += dx * dz; yy += dy * dy; yz += dy * dz; zz += dz * dz;
        for (let j = offsets[w]; j < offsets[w + 1]; j++) { const t = tris[j]; for (let e = 0; e < 3; e++) { const u = f[3 * t + e]; if (stamp[u] === tag) continue; stamp[u] = tag;
          const ex = p[3 * u] - px, ey = p[3 * u + 1] - py, ez = p[3 * u + 2] - pz; if (ex * ex + ey * ey + ez * ez <= R2) q[tail++] = u; } } }
      nb = tail; if (n >= minPts || tries === 3) break; R *= 1.5;
    }
    let nx = vn[3 * v], ny = vn[3 * v + 1], nz = vn[3 * v + 2];
    if (n >= 4) {
      const cx = sx / n, cy = sy / n, cz = sz / n;
      const a = xx / n - cx * cx, b = xy / n - cx * cy, c = xz / n - cx * cz, d = yy / n - cy * cy, e = yz / n - cy * cz, g = zz / n - cz * cz;
      // kleinster Eigenvektor: Potenziteration auf (tr·I − C), Start = Flächennormale
      const tr = a + d + g; let x = nx, y = ny, z = nz;
      for (let it = 0; it < 12; it++) { const X = tr * x - (a * x + b * y + c * z), Y = tr * y - (b * x + d * y + e * z), Z = tr * z - (c * x + e * y + g * z); const l = Math.hypot(X, Y, Z) || 1; x = X / l; y = Y / l; z = Z / l; }
      if (x * nx + y * ny + z * nz < 0) { x = -x; y = -y; z = -z; }
      // Robust gewichtet (kantenerhaltend, gleiches Verfahren für alle Knoten): Nachbarn abseits der lokalen Ebene
      // werden heruntergewichtet (Cauchy-Gewicht, Skala s = 0,1·R), 3 Iterationen. Ist der ungewichtete Fit schlecht
      // (Knoten an einer Kante: Punkte zweier Flächen), startet die Gewichtung von der Ebene durch den Knoten mit seiner
      // Flächennormale – so gewinnt die Fläche, auf der der Knoten liegt, statt einer Mittelung über die Kante.
      if (weighted && nb <= W.length) {
        const sc = ROBUST_S * R, s2 = sc * sc; let cxw = cx, cyw = cy, czw = cz;
        let rr = 0; for (let i = 0; i < nb; i++) { const w = q[i]; const d = (p[3 * w] - px - cx) * x + (p[3 * w + 1] - py - cy) * y + (p[3 * w + 2] - pz - cz) * z; rr += d * d; }
        const rms0 = Math.sqrt(rr / nb);
        // alle Nachbarn liegen schon eng an der Ebene (rms < 0,2·s): Gewichte ≈ 1, Ergebnis = ungewichteter Fit -> Iteration sparen
        if (rms0 > ROBUST_CT * sc || ROBUST_VSTART) {
          // 0.38: Knoten an einer Kante – Startebene durch den Knoten, deren Normale die meisten Nachbarn trägt
          // (Kandidaten: Flächennormalen der Nachbarschaft + Knotennormale). Die Fläche, auf der der Knoten liegt,
          // hat im Radius die Mehrheit -> sie gewinnt, statt einer Mittelung über die Kante.
          cxw = 0; cyw = 0; czw = 0; x = vn[3 * v]; y = vn[3 * v + 1]; z = vn[3 * v + 2];
          if (ROBUST_CAND) {
            const fnn = m.faceNormals!; const score = (ax: number, ay: number, az: number) => { let sw = 0; for (let i = 0; i < nb; i++) { const w = q[i]; const d = (p[3 * w] - px) * ax + (p[3 * w + 1] - py) * ay + (p[3 * w + 2] - pz) * az; sw += 1 / (1 + (d * d) / s2); } return sw; };
            let best = score(x, y, z);
            for (let i = 0; i < nb; i++) { const w = q[i]; const t = tris[offsets[w]]; const ax = fnn[3 * t], ay = fnn[3 * t + 1], az = fnn[3 * t + 2]; const sco = score(ax, ay, az); if (sco > best) { best = sco; x = ax; y = ay; z = az; } }
          }
        }
        const nIt = rms0 < 0.2 * sc ? 0 : ROBUST_IT, H2 = (2.5 * sc) ** 2, HC = Math.cos((ROBUST_HA * Math.PI) / 180);
        for (let iter = 0; iter < (nIt ? nIt + ROBUST_HARD : 0); iter++) {
          const hard = iter >= nIt; let sw = 0, mx = 0, my = 0, mz = 0;
          for (let i = 0; i < nb; i++) { const w = q[i]; const dx = p[3 * w] - px, dy = p[3 * w + 1] - py, dz = p[3 * w + 2] - pz; const d = (dx - cxw) * x + (dy - cyw) * y + (dz - czw) * z;
            // Abschluss (hart): nur Punkte nahe der Ebene UND mit passender eigener Knotennormale (< ROBUST_HA°) –
            // Punkte der Nachbarfläche direkt an der Kante liegen auch nahe der Ebene, ihre Normalen aber nicht.
            let wt = hard ? (d * d < H2 && Math.abs(vn[3 * w] * x + vn[3 * w + 1] * y + vn[3 * w + 2] * z) > HC ? 1 : 0) : 1 / (1 + (d * d) / s2);
            if (ROBUST_NW > 0) { const c = Math.max(0, vn[3 * w] * x + vn[3 * w + 1] * y + vn[3 * w + 2] * z); wt *= c ** ROBUST_NW; }
            W[i] = wt; sw += wt; mx += wt * dx; my += wt * dy; mz += wt * dz; }
          if (sw < 3) break; mx /= sw; my /= sw; mz /= sw; let A = 0, B = 0, Cc = 0, D = 0, E = 0, G = 0;
          for (let i = 0; i < nb; i++) { const w = q[i]; const dx = p[3 * w] - px - mx, dy = p[3 * w + 1] - py - my, dz = p[3 * w + 2] - pz - mz, wt = W[i];
            A += wt * dx * dx; B += wt * dx * dy; Cc += wt * dx * dz; D += wt * dy * dy; E += wt * dy * dz; G += wt * dz * dz; }
          const t2 = A + D + G;
          for (let it = 0; it < 12; it++) { const X = t2 * x - (A * x + B * y + Cc * z), Y = t2 * y - (B * x + D * y + E * z), Z = t2 * z - (Cc * x + E * y + G * z); const l = Math.hypot(X, Y, Z) || 1; x = X / l; y = Y / l; z = Z / l; }
          cxw = mx; cyw = my; czw = mz;
        }
        if (x * nx + y * ny + z * nz < 0) { x = -x; y = -y; z = -z; }
      }
      if (Number.isFinite(x)) { nx = x; ny = y; nz = z; }
    }
    out[3 * v] = nx; out[3 * v + 1] = ny; out[3 * v + 2] = nz;
  }
}
export function robustVertexNormals(m: MeshData, vt: { offsets: Uint32Array; tris: Uint32Array }, k = ROBUST_K, minPts = ROBUST_MIN, only?: Uint8Array, weighted = true): Float32Array {
  const R = new RobustNormals(m, vt, k, minPts, weighted), vn = m.vertexNormals!, nv = m.positions.length / 3;
  for (let v = 0; v < nv; v++) { if (only && !only[v]) { R.out[3 * v] = vn[3 * v]; R.out[3 * v + 1] = vn[3 * v + 1]; R.out[3 * v + 2] = vn[3 * v + 2]; continue; } R.get(v); }
  return R.out;
}
export function triFromVertex(m: MeshData, VN: Float32Array): Float32Array {
  const f = m.indices, fn = m.faceNormals!, nt = f.length / 3, out = new Float32Array(3 * nt);
  for (let t = 0; t < nt; t++) { let x = 0, y = 0, z = 0; for (let k = 0; k < 3; k++) { const v = 3 * f[3 * t + k]; x += VN[v]; y += VN[v + 1]; z += VN[v + 2]; }
    let l = Math.hypot(x, y, z); if (l < 1e-9) { x = fn[3 * t]; y = fn[3 * t + 1]; z = fn[3 * t + 2]; l = 1; }
    out[3 * t] = x / l; out[3 * t + 1] = y / l; out[3 * t + 2] = z / l; }
  return out;
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
