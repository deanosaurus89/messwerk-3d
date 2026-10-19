// Projektdatei (.mw3d = ZIP: project.json + Binärdaten des Netzes und der Merkmalspunkte) und Autosave (IndexedDB).
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export interface ProjectBinary { positions: Float32Array; indices: Uint32Array; }
export interface IndexBlob { offsets: Record<string, [number, number]>; data: Uint32Array; }
export const FORMAT = 'messwerk3d-project';
/** 1 = flat features (≤ 0.27); 2 = feature node + Ist (0.28, core/featuremodel.ts – older files are migrated on load) */
export const VERSION = 2;

/** Typisierte Merkmals-Indizes (Punkte, Hilfsebenen-Punkte) in einen Block packen. */
export function packIndices(arrs: Record<string, Uint32Array | undefined>): IndexBlob {
  let n = 0; for (const a of Object.values(arrs)) n += a?.length ?? 0;
  const data = new Uint32Array(n), offsets: Record<string, [number, number]> = {};
  let o = 0;
  for (const [k, a] of Object.entries(arrs)) if (a) { data.set(a, o); offsets[k] = [o, a.length]; o += a.length; }
  return { offsets, data };
}
export function unpackIndex(b: IndexBlob, key: string): Uint32Array | undefined {
  const r = b.offsets[key]; return r ? b.data.slice(r[0], r[0] + r[1]) : undefined;
}
const u8 = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const aligned = (u: Uint8Array) => { const c = new Uint8Array(u.length); c.set(u); return c.buffer; };

export function writeProject(json: any, mesh: ProjectBinary, idx: IndexBlob): Uint8Array {
  const meta = { ...json, format: FORMAT, version: VERSION, indexOffsets: idx.offsets };
  return zipSync({
    'project.json': strToU8(JSON.stringify(meta)),
    'mesh/positions.f32': [u8(mesh.positions), { level: 1 }],
    'mesh/indices.u32': [u8(mesh.indices), { level: 6 }],
    'features/indices.u32': [u8(idx.data), { level: 6 }],
  });
}

export function readProject(data: Uint8Array): { json: any; mesh: ProjectBinary; idx: IndexBlob } {
  const z = unzipSync(data);
  if (!z['project.json']) throw new Error('Not a MessWerk 3D project file (project.json missing)');
  const json = JSON.parse(strFromU8(z['project.json']));
  if (json.format !== FORMAT) throw new Error('Unbekanntes Dateiformat');
  if (json.version > VERSION) throw new Error(`Projektversion ${json.version} ist neuer als diese App`);
  return {
    json,
    mesh: { positions: new Float32Array(aligned(z['mesh/positions.f32'])), indices: new Uint32Array(aligned(z['mesh/indices.u32'])) },
    idx: { offsets: json.indexOffsets ?? {}, data: new Uint32Array(aligned(z['features/indices.u32'] ?? new Uint8Array(0))) },
  };
}

// ------------------------------------------------------------------ IndexedDB (Autosave)
const DB = 'messwerk3d', STORE = 'kv';
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function idbSet(key: string, val: any) {
  const d = await db();
  await new Promise<void>((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(val, key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  d.close();
}
export async function idbGet<T = any>(key: string): Promise<T | undefined> {
  const d = await db();
  const v = await new Promise<T | undefined>((res, rej) => { const r = d.transaction(STORE).objectStore(STORE).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  d.close(); return v;
}
export async function idbDel(key: string) {
  const d = await db();
  await new Promise<void>((res) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(key); t.oncomplete = () => res(); });
  d.close();
}
