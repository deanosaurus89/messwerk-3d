// Punktauswahl am Polygonmodell: Regionenwachstum ab Klickpunkt und Pinsel-Auswahl.
import { MeshData, vertexTriangles } from './mesh';
import type { Vec3 } from './linalg';

export interface GrowOptions {
  maxAngleDeg: number;   // max. Normalenwinkel zwischen benachbarten Dreiecken (Glattheit)
  radius: number;        // Suchradius um den Klickpunkt (mm), 0 = unbegrenzt
  maxCurvatureDeg?: number; // optional: max. Abweichung zur Saat-Normalen (0 = aus)
}

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

  growRegion(seedTri: number, seedPoint: Vec3, o: GrowOptions): Uint32Array {
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
        inR[u] = 1;
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
