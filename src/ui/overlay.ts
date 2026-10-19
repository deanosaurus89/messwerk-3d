/**
 * Common close behaviour for help/info overlays: Esc, tap on the backdrop (handled by the caller) and a
 * downward swipe on the header – or on the content when it is scrolled to the top – closes them (iOS has no Esc).
 */
export function bindSwipeClose(box: HTMLElement, close: () => void, scrollEl?: HTMLElement | null) {
  let y0 = -1, x0 = 0;
  box.addEventListener('touchstart', (e) => {
    const t = e.touches[0]; if (!t || e.touches.length > 1) { y0 = -1; return; }
    const tgt = e.target as HTMLElement, onHead = !!tgt.closest?.('.rv-head, .ov-top');
    const sc = scrollEl ?? (box.querySelector('.rv-body, .sd-grid') as HTMLElement | null);
    y0 = onHead || !sc || sc.scrollTop <= 0 || box === sc && box.scrollTop <= 0 ? t.clientY : -1; x0 = t.clientX;
  }, { passive: true });
  box.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0]; if (y0 < 0 || !t) return;
    const dy = t.clientY - y0, dx = Math.abs(t.clientX - x0); y0 = -1;
    if (dy > 70 && dy > 1.5 * dx) close();
  }, { passive: true });
}
/** Esc closes the overlay while it is in the DOM and visible; returns a detach function. */
export function bindEscClose(box: HTMLElement, close: () => void) {
  const h = (e: KeyboardEvent) => { if (e.key !== 'Escape') return; if (!box.isConnected) { document.removeEventListener('keydown', h, true); return; }
    if (box.classList.contains('hidden')) return; e.stopPropagation(); close(); };
  document.addEventListener('keydown', h, true);
  return () => document.removeEventListener('keydown', h, true);
}
/** Scroll `target` to the top of its scroll container WITHOUT touching any ancestor (scrollIntoView also scrolls
 *  overflow:hidden layout containers on iOS/Chrome, which pushed the help header under the ribbon). */
export function scrollWithin(container: HTMLElement, target: Element | null, smooth = false) {
  if (!target) return;
  const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 4;
  container.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
}
/** Layout containers that must never scroll (they are overflow:hidden; a programmatic scroll shifts the whole UI). */
export function pinLayout(sel: string) {
  document.querySelectorAll<HTMLElement>(sel).forEach((el) => el.addEventListener('scroll', () => { if (el.scrollTop || el.scrollLeft) { el.scrollTop = 0; el.scrollLeft = 0; } }));
}
