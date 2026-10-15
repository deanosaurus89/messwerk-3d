// Einheitliche Bestätigungsleiste unten im 3D-Fenster für interaktive Modi: ↶ Rückgängig · ↷ Wiederholen · ✓ Bestätigen · ✕ Abbrechen.
// Die Leiste spiegelt die vorhandenen Bedienelemente (Menüband/Modusleiste/Dialog): sie ruft deren Aktionen auf, die Menüband-Knöpfe bleiben.
export interface ActionSpec { label?: string; undo?: HTMLButtonElement | null; redo?: HTMLButtonElement | null; ok?: HTMLButtonElement | null; cancel?: HTMLButtonElement | null; okTitle?: string; }
const slots = new Map<string, ActionSpec | null>();
let el: HTMLDivElement | null = null;
export function initActionBar(host: HTMLElement) {
  el = document.createElement('div'); el.id = 'action-bar'; el.className = 'hidden'; host.appendChild(el);
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
}
/** Slot setzen (z. B. 'mesh', 'cad', 'preview'); der zuletzt gesetzte nicht-leere Slot mit höchster Priorität wird gezeigt. */
export function setActions(slot: string, spec: ActionSpec | null) { slots.set(slot, spec); draw(); }
const ORDER = ['preview', 'cad', 'mesh'];
function draw() {
  if (!el) return; const spec = ORDER.map((k) => slots.get(k)).find((s) => s && (s.ok || s.undo || s.redo || s.cancel));
  if (!spec) { el.className = 'hidden'; el.innerHTML = ''; return; }
  el.className = '';
  const b = (k: keyof ActionSpec, txt: string, title: string, cls = '') => { const src = spec[k] as HTMLButtonElement | null | undefined; if (!src) return '';
    return `<button data-k="${k}" class="${cls}" title="${title}" ${src.disabled ? 'disabled' : ''}>${txt}</button>`; };
  el.innerHTML = (spec.label ? `<span class="ab-l">${spec.label}</span>` : '') + b('undo', '↶', 'Rückgängig (Strg+Z)') + b('redo', '↷', 'Wiederholen') + b('cancel', '✕', 'Abbrechen (Esc)', 'ab-x') + b('ok', '✓', spec.okTitle ?? 'Bestätigen (Enter / Rechtsklick)', 'ab-ok');
  el.querySelectorAll<HTMLButtonElement>('button[data-k]').forEach((x) => (x.onclick = () => { (spec[x.dataset.k as keyof ActionSpec] as HTMLButtonElement)?.click(); }));
}
