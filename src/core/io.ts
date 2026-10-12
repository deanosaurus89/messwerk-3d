// Import von Polygonmodellen: STL (ASCII/binär), PLY (ASCII/binär LE), OBJ, XYZ-Punktwolke.
import { MeshData, computeNormals, weld } from './mesh';

const dec = new TextDecoder();

export function parseSTL(buf: ArrayBuffer, name = 'STL'): MeshData {
  const dv = new DataView(buf);
  let binary = false;
  if (buf.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    binary = 84 + 50 * n === buf.byteLength;
  }
  let tri: Float32Array;
  if (binary) {
    const n = dv.getUint32(80, true);
    tri = new Float32Array(9 * n);
    for (let i = 0; i < n; i++) {
      const o = 84 + 50 * i + 12;
      for (let k = 0; k < 9; k++) tri[9 * i + k] = dv.getFloat32(o + 4 * k, true);
    }
  } else {
    const txt = dec.decode(buf);
    const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
    const out: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt))) out.push(+m[1], +m[2], +m[3]);
    if (out.length === 0) throw new Error('STL enthält keine Dreiecke');
    tri = new Float32Array(out);
  }
  const w = weld(tri);
  const mesh: MeshData = { name, positions: w.positions, indices: w.indices };
  computeNormals(mesh);
  return mesh;
}

export function parseOBJ(buf: ArrayBuffer, name = 'OBJ'): MeshData {
  const pos: number[] = [], idx: number[] = [];
  for (const line of dec.decode(buf).split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') pos.push(+p[1], +p[2], +p[3]);
    else if (p[0] === 'f') {
      const nv = pos.length / 3;
      const f = p.slice(1).map((s) => { const i = parseInt(s.split('/')[0], 10); return i < 0 ? nv + i : i - 1; });
      for (let i = 1; i < f.length - 1; i++) idx.push(f[0], f[i], f[i + 1]);
    }
  }
  const mesh: MeshData = { name, positions: new Float32Array(pos), indices: new Uint32Array(idx) };
  if (idx.length) computeNormals(mesh);
  return mesh;
}

export function parseXYZ(buf: ArrayBuffer, name = 'Punktwolke'): MeshData {
  const pos: number[] = [];
  for (const line of dec.decode(buf).split(/\r?\n/)) {
    const p = line.replace(/[,;]/g, ' ').trim().split(/\s+/);
    if (p.length < 3) continue;
    const x = +p[0], y = +p[1], z = +p[2];
    if (isFinite(x) && isFinite(y) && isFinite(z)) pos.push(x, y, z);
  }
  return { name, positions: new Float32Array(pos), indices: new Uint32Array(0) };
}

const PLY_T: Record<string, [string, number]> = {
  char: ['Int8', 1], uchar: ['Uint8', 1], int8: ['Int8', 1], uint8: ['Uint8', 1],
  short: ['Int16', 2], ushort: ['Uint16', 2], int16: ['Int16', 2], uint16: ['Uint16', 2],
  int: ['Int32', 4], uint: ['Uint32', 4], int32: ['Int32', 4], uint32: ['Uint32', 4],
  float: ['Float32', 4], float32: ['Float32', 4], double: ['Float64', 8], float64: ['Float64', 8],
};

export function parsePLY(buf: ArrayBuffer, name = 'PLY'): MeshData {
  const bytes = new Uint8Array(buf);
  const head = dec.decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const he = head.indexOf('end_header');
  if (he < 0) throw new Error('Ungültige PLY-Datei');
  let off = he + 'end_header'.length;
  while (bytes[off] === 13 || bytes[off] === 10) off++;
  let format = 'ascii';
  const els: { name: string; count: number; props: string[][] }[] = [];
  for (const l of head.slice(0, he).split(/\r?\n/)) {
    const p = l.trim().split(/\s+/);
    if (p[0] === 'format') format = p[1];
    else if (p[0] === 'element') els.push({ name: p[1], count: +p[2], props: [] });
    else if (p[0] === 'property') els[els.length - 1].props.push(p.slice(1));
  }
  const pos: number[] = [], idx: number[] = [];
  const pushFace = (f: number[]) => { for (let i = 1; i < f.length - 1; i++) idx.push(f[0], f[i], f[i + 1]); };
  if (format === 'ascii') {
    const tok = dec.decode(bytes.subarray(off)).trim().split(/\s+/);
    let t = 0;
    for (const e of els) for (let r = 0; r < e.count; r++) {
      const row: Record<string, number> = {}; let list: number[] = [];
      for (const pr of e.props) {
        if (pr[0] === 'list') { const k = +tok[t++]; list = tok.slice(t, t + k).map(Number); t += k; }
        else row[pr[1]] = +tok[t++];
      }
      if (e.name === 'vertex') pos.push(row.x, row.y, row.z);
      else if (e.name === 'face') pushFace(list);
    }
  } else if (format === 'binary_little_endian') {
    const dv = new DataView(buf);
    const rd = (t: string, o: number) => (dv as any)['get' + PLY_T[t][0]](o, true) as number;
    for (const e of els) for (let r = 0; r < e.count; r++) {
      const row: Record<string, number> = {}; let list: number[] = [];
      for (const pr of e.props) {
        if (pr[0] === 'list') {
          const k = rd(pr[1], off); off += PLY_T[pr[1]][1];
          list = []; for (let i = 0; i < k; i++) { list.push(rd(pr[2], off)); off += PLY_T[pr[2]][1]; }
        } else { row[pr[1]] = rd(pr[0], off); off += PLY_T[pr[0]][1]; }
      }
      if (e.name === 'vertex') pos.push(row.x, row.y, row.z);
      else if (e.name === 'face') pushFace(list);
    }
  } else throw new Error('PLY-Format nicht unterstützt: ' + format);
  const mesh: MeshData = { name, positions: new Float32Array(pos), indices: new Uint32Array(idx) };
  if (idx.length) computeNormals(mesh);
  return mesh;
}

export function parseByName(fileName: string, buf: ArrayBuffer): MeshData {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const name = fileName.replace(/\.[^.]+$/, '');
  if (ext === 'stl') return parseSTL(buf, name);
  if (ext === 'ply') return parsePLY(buf, name);
  if (ext === 'obj') return parseOBJ(buf, name);
  if (['xyz', 'txt', 'asc', 'csv'].includes(ext)) return parseXYZ(buf, name);
  throw new Error('Unbekanntes Dateiformat: .' + ext);
}

/** Binäres STL schreiben (für Tests/Beispieldaten). */
export function writeSTL(positions: Float32Array, indices: Uint32Array): ArrayBuffer {
  const nt = indices.length / 3;
  const buf = new ArrayBuffer(84 + 50 * nt), dv = new DataView(buf);
  dv.setUint32(80, nt, true);
  for (let t = 0; t < nt; t++) {
    const o = 84 + 50 * t + 12;
    for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) dv.setFloat32(o + 12 * k + 4 * c, positions[3 * indices[3 * t + k] + c], true);
  }
  return buf;
}
