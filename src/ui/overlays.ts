// Central overlay manager (stabilization rule): every CONTEXTUAL overlay belongs to one context – an interactive mode,
// the open feature dialog, the Analyze session, or a selected control. It is drawn only while that context is alive and
// its state is cleared when the context ends. Persistent display exists only through explicit View-ribbon toggles
// (points, geometries, annotations, curves, extraction-zone preference …), which are NOT managed here.
export type OverlayCtx = 'mode' | 'dialog' | 'analyze' | 'control';
export interface OverlayDef { id: string; ctx: OverlayCtx; label: string; clear?: () => void }

export class OverlayManager {
  private defs = new Map<string, OverlayDef>();
  private alive = new Map<OverlayCtx, boolean>();
  /** ids cleared by the last sync() (for tests/diagnostics) */
  lastCleared: string[] = [];
  constructor(private probe: Record<OverlayCtx, () => boolean>) {}
  register(...ds: OverlayDef[]) { for (const d of ds) this.defs.set(d.id, d); return this; }
  /** Is the context of this overlay alive? Unknown ids are treated as persistent (true). */
  on(id: string): boolean { const d = this.defs.get(id); return d ? this.probe[d.ctx]() : true; }
  ctxAlive(c: OverlayCtx) { return this.probe[c](); }
  /** Call before drawing: contexts that ended since the last call get their overlays cleared. Returns the cleared ids. */
  sync(): string[] {
    const out: string[] = [];
    for (const c of Object.keys(this.probe) as OverlayCtx[]) {
      const now = this.probe[c](), was = this.alive.get(c) ?? false;
      if (was && !now) for (const d of this.defs.values()) if (d.ctx === c) { try { d.clear?.(); } catch { /* best effort */ } out.push(d.id); }
      this.alive.set(c, now);
    }
    this.lastCleared = out; return out;
  }
  list() { return [...this.defs.values()].map((d) => ({ id: d.id, ctx: d.ctx, label: d.label, on: this.on(d.id) })); }
}
