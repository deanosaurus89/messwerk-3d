// Fortschrittsanzeige unten links (neben dem Navigationswürfel): Balken, Prozent, aktueller Schritt und Schritt i/n.
// Für alle längeren Operationen; ohne Prozentangabe läuft der Balken unbestimmt.
export interface ProgressInfo { frac?: number; step?: number; steps?: number; label?: string; }
let el: HTMLDivElement | null = null, depth = 0, t0 = 0, title = '';
export function initProgress(host: HTMLElement) {
  el = document.createElement('div'); el.id = 'progress'; el.className = 'hidden'; el.setAttribute('role', 'progressbar');
  el.innerHTML = '<div class="pg-t"><span class="pg-l"></span><span class="pg-s"></span><span class="pg-p"></span></div><div class="pg-bar"><i></i></div>'; host.appendChild(el);
}
/** Operation beginnen (verschachtelt zulässig: nur die äußerste zählt). */
export function progressBegin(name: string, info: ProgressInfo = {}) { if (!el) return; if (depth++ === 0) { title = name; t0 = performance.now(); el.className = 'indet'; } progressUpdate(info); }
export function progressUpdate(info: ProgressInfo) {
  if (!el || !depth) return;
  const f = info.frac; el.className = f === undefined ? 'indet' : '';
  el.querySelector<HTMLElement>('.pg-l')!.textContent = info.label ?? title;
  el.querySelector<HTMLElement>('.pg-s')!.textContent = info.steps && info.steps > 1 ? `Schritt ${info.step ?? 1}/${info.steps}` : '';
  el.querySelector<HTMLElement>('.pg-p')!.textContent = f === undefined ? '' : `${Math.round(100 * Math.min(1, Math.max(0, f)))} %`;
  (el.querySelector('.pg-bar i') as HTMLElement).style.width = f === undefined ? '' : `${(100 * Math.min(1, Math.max(0, f))).toFixed(1)}%`;
  el.setAttribute('aria-valuenow', f === undefined ? '' : String(Math.round(100 * f)));
}
export function progressEnd() { if (!el || !depth) return; if (--depth === 0) { el.className = 'hidden'; void t0; } }
/** Promise mit Fortschrittsanzeige umschließen. */
export async function withProgress<T>(name: string, p: Promise<T>): Promise<T> { progressBegin(name); try { return await p; } finally { progressEnd(); } }
