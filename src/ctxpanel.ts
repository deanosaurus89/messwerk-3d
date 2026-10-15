// ONE context-dependent bottom panel in the 3D view for every interactive mode and preview:
// title · mode controls (brush radius, method …) · stats of the preview · ↶ ↷ ✕ ✓.
// Slots ('preview', 'cad', 'mesh', …) are prioritised; the first non-empty slot is shown.
import { t } from './i18n';
export interface CtxAction { run: () => void; disabled?: boolean; title?: string; label?: string; }
export interface CtxSpec {
  title: string; cls?: string;
  /** controls (HTML) – bound via bind() after rendering */
  controls?: string; stats?: string; bind?: (el: HTMLElement) => void;
  undo?: CtxAction | null; redo?: CtxAction | null; cancel?: CtxAction | null; ok?: CtxAction | null;
}
const slots = new Map<string, CtxSpec | null>();
const ORDER = ['preview', 'dist', 'cad', 'mesh', 'tool'];
let el: HTMLDivElement | null = null;
export function initCtxPanel(host: HTMLElement) {
  el = document.createElement('div'); el.id = 'ctx-panel'; el.className = 'hidden'; host.appendChild(el);
  for (const ev of ['pointerdown', 'wheel', 'pointerup'] as const) el.addEventListener(ev, (e) => e.stopPropagation());
}
export function setCtx(slot: string, spec: CtxSpec | null) { slots.set(slot, spec); draw(); }
export const ctxVisible = () => !!el && !el.classList.contains('hidden');
function draw() {
  if (!el) return; const spec = ORDER.map((k) => slots.get(k)).find((s) => !!s) ?? null;
  document.body.classList.toggle('ctx-on', !!spec);
  if (!spec) { el.className = 'hidden'; el.innerHTML = ''; return; }
  el.className = spec.cls ?? '';
  const b = (k: 'undo' | 'redo' | 'cancel' | 'ok', txt: string, title: string, cls: string) => { const a = spec[k]; if (!a) return '';
    return `<button data-k="${k}" id="cp-${k}" class="${cls}" title="${a.title ?? title}" ${a.disabled ? 'disabled' : ''}>${a.label ?? txt}</button>`; };
  el.innerHTML = `<div class="cp-main"><div class="cp-head"><span class="cp-t">${spec.title}</span>${spec.controls ? `<span class="cp-c">${spec.controls}</span>` : ''}</div>
    ${spec.stats ? `<div class="cp-s">${spec.stats}</div>` : ''}</div>
    <div class="cp-btns">${b('undo', '↶', t('Undo (Ctrl+Z)'), '')}${b('redo', '↷', t('Redo'), '')}${b('cancel', '✕', t('Cancel (Esc)'), 'cp-x')}${b('ok', '✓', t('Confirm (Enter / right-click)'), 'cp-ok')}</div>`;
  el.querySelectorAll<HTMLButtonElement>('button[data-k]').forEach((x) => (x.onclick = () => (spec as any)[x.dataset.k!]?.run()));
  spec.bind?.(el);
}
/** Compatibility for modules that expose their own buttons (CAD trimming): mirror them as panel actions. */
export interface ActionSpec { label?: string; undo?: HTMLButtonElement | null; redo?: HTMLButtonElement | null; ok?: HTMLButtonElement | null; cancel?: HTMLButtonElement | null; okTitle?: string; }
export function setActions(slot: string, a: ActionSpec | null) {
  const m = (x?: HTMLButtonElement | null, title?: string): CtxAction | null => (x ? { run: () => x.click(), disabled: x.disabled, title } : null);
  setCtx(slot, a && (a.ok || a.undo || a.redo || a.cancel) ? { title: a.label ?? '', undo: m(a.undo), redo: m(a.redo), cancel: m(a.cancel), ok: m(a.ok, a.okTitle) } : null);
}
