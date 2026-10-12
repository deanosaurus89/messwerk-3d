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
