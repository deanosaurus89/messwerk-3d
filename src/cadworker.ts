// CAD-Worker: OpenCascade (WASM, ~50 MB, gzip ~14 MB) wird erst beim ersten CAD-Import geladen.
import * as C from './cad/occcore';
import type { TrimOp } from './cad/occcore';

export type CadReq =
  | { op: 'load'; bytes: Uint8Array; name: string }
  | { op: 'apply'; ops: TrimOp[] }
  | { op: 'export'; fmt: 'step' | 'iges'; faces: number[] };

let oc: any = null, orig: any[] = [], diag = 100;
const cache = new Map<number, { key: string; shape: any; area: number }>();
async function getOC() {
  if (oc) return oc;
  const [{ default: mainJS }, { default: wasmUrl }] = await Promise.all([import('opencascade.js/dist/opencascade.full.js' as any), import('opencascade.js/dist/opencascade.full.wasm?url' as any)]);
  oc = await new mainJS({ locateFile: (p: string) => (p.endsWith('.wasm') ? wasmUrl : p) });
  return oc;
}
const post = (m: any, tr: Transferable[] = []) => (self as any).postMessage(m, tr);
self.onmessage = async (e: MessageEvent<{ id: number; req: CadReq }>) => {
  const { id, req } = e.data; const prog = (text: string, info: { frac?: number; step?: number; steps?: number } = {}) => post({ id, progress: { text, ...info } });
  try {
    let r: any; const tr: Transferable[] = [];
    if (req.op === 'load') {
      const t0 = performance.now(); const first = !oc; if (first) prog('Loading OpenCascade …', { step: 1, steps: 3 });
      const o = await getOC(); const tInit = performance.now() - t0;
      prog('Reading file …', { step: first ? 2 : 1, steps: first ? 3 : 2 }); const sh = C.readCAD(o, req.bytes, req.name); const tRead = performance.now() - t0 - tInit;
      orig = C.faces(o, sh); cache.clear(); diag = C.bboxDiag(o, sh);
      prog(`Tessellating ${orig.length} faces …`, { step: first ? 3 : 2, steps: first ? 3 : 2, frac: 0 });
      const defl = diag / 1500; let lastP = 0; const fl = orig.map((f, i) => { if (performance.now() - lastP > 150) { lastP = performance.now(); prog(`Tessellating face ${i + 1}/${orig.length}`, { step: first ? 3 : 2, steps: first ? 3 : 2, frac: i / orig.length }); } const t = C.tessellate(o, f, defl); tr.push(t.positions.buffer, t.indices.buffer, t.normals.buffer); return { ...C.faceInfo(o, f, i), tess: t }; });
      r = { faces: fl, diag, ms: { init: tInit, read: tRead, tess: performance.now() - t0 - tInit - tRead }, firstLoad: first };
    } else if (req.op === 'apply') {
      // je Fläche nur neu rechnen, wenn sich ihre Operationskette geändert hat
      const o = oc; const changed: any[] = []; const errors: (string | null)[] = req.ops.map(() => null);
      const touched = new Set<number>(); req.ops.forEach((op) => op.faces.forEach((i) => touched.add(i))); for (const i of cache.keys()) touched.add(i);
      let n = 0; const todo = touched.size; let seen = 0;
      for (const i of touched) { seen++;
        const chain = req.ops.map((op, k) => ({ op, k })).filter((x) => x.op.faces.includes(i)); const key = JSON.stringify(chain.map((x) => x.op));
        if (cache.get(i)?.key === key) continue;
        prog(`Trimming face ${i + 1} (${++n}) …`, { frac: (seen - 1) / todo });
        let sh = orig[i];
        for (const { op, k } of chain) { try { sh = C.applyOne(o, sh, op, orig); } catch (err: any) { errors[k] = String(err?.message ?? err); } }
        if (!chain.length) { cache.delete(i); changed.push({ id: i, reset: true }); continue; }
        const t = C.tessellate(o, sh, diag / 1500); tr.push(t.positions.buffer, t.indices.buffer, t.normals.buffer);
        const a = C.area(o, sh); cache.set(i, { key, shape: sh, area: a });
        changed.push({ id: i, tess: t, area: a, pieces: C.faces(o, sh).length });
      }
      r = { changed, errors };
    } else {
      const o = oc; const list = req.faces.map((i) => cache.get(i)?.shape ?? orig[i]);
      prog(`${req.fmt === 'step' ? 'STEP' : 'IGES'} schreiben …`, { step: 1, steps: 2 }); const bytes = C.writeCAD(o, list, req.fmt);
      prog('Prüfung: wieder einlesen …', { step: 2, steps: 2 });
      // Prüfung: wieder einlesen, Fläche und Gültigkeit vergleichen
      const back = C.readCAD(o, bytes, req.fmt === 'step' ? 'x.stp' : 'x.igs');
      const want = list.reduce((s, x) => s + C.area(o, x), 0), got = C.area(o, back);
      r = { bytes, check: { faces: C.faces(o, back).length, area: got, expected: want, valid: C.isValid(o, back) } }; tr.push(bytes.buffer);
    }
    post({ id, result: r }, tr);
  } catch (err: any) { post({ id, error: String(err?.message ?? err) }); }
};
