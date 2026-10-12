// Promise-basierte Schnittstelle zum Rechen-Worker.
import type { Req } from './worker';

export class Engine {
  private w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private seq = 0;
  private pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  constructor() {
    this.w.onmessage = (e) => {
      const p = this.pending.get(e.data.id); if (!p) return;
      this.pending.delete(e.data.id);
      e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data.result);
    };
  }
  call<T = any>(req: Req, transfer: Transferable[] = []): Promise<T> {
    const id = ++this.seq;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.w.postMessage({ id, req }, transfer); });
  }
}

/** Polygonbearbeitung in eigenem Worker; cancel() beendet ihn sofort (und startet einen neuen). */
import type { PolyReq } from './polyworker';
export class PolyEngine {
  private w!: Worker; private cur: { id: number; rej: (e: Error) => void } | null = null; private seq = 0;
  private make() { this.w = new Worker(new URL('./polyworker.ts', import.meta.url), { type: 'module' }); }
  constructor() { this.make(); }
  get running() { return !!this.cur; }
  run<T = any>(req: PolyReq, onProgress?: (p: { tris: number; done: number }) => void): Promise<T> {
    if (this.cur) this.cancel();
    const id = ++this.seq;
    return new Promise((res, rej) => {
      this.cur = { id, rej };
      this.w.onmessage = (e) => {
        if (e.data.id !== id) return;
        if (e.data.progress) { onProgress?.(e.data.progress); return; }
        this.cur = null; e.data.error ? rej(new Error(e.data.error)) : res(e.data.result);
      };
      this.w.postMessage({ id, req });
    });
  }
  cancel() { if (!this.cur) return; this.w.terminate(); const c = this.cur; this.cur = null; this.make(); c.rej(new Error('abgebrochen')); }
}
