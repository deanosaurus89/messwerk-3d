/** 0.38 Pick-Modus (generisch, wiederverwendbar): solange ein registriertes Werkzeug aktiv ist, verändert die Maus
 *  auf dem Desktop die Ansicht NICHT (kein Drehen/Zoomen/Verschieben) – Klicks picken, das Mausrad ändert den
 *  Radius des Werkzeugs. Leertaste schaltet in den Navigationsmodus und zurück (navPaused). Touch bleibt unverändert. */
export interface PickTool { name: string; active: () => boolean; wheel: (dir: 1 | -1, e: WheelEvent) => void; }
const tools: PickTool[] = [];
let paused = () => false;
export function registerPickTool(t: PickTool) { const i = tools.findIndex((x) => x.name === t.name); if (i >= 0) tools[i] = t; else tools.push(t); }
export function activePickTool(): PickTool | null { if (paused()) return null; return tools.find((t) => t.active()) ?? null; }
export function pickModeActive(): boolean { return !!activePickTool(); }
/** am Viewer-Container einhängen (Capture-Phase, vor den OrbitControls) */
export function installPickMode(host: HTMLElement, controls: { enabled: boolean }, isPaused: () => boolean) {
  paused = isPaused;
  const fine = () => matchMedia('(pointer: fine)').matches;
  host.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && fine()) controls.enabled = !pickModeActive(); }, true);
  host.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && !e.buttons && fine()) controls.enabled = !pickModeActive(); }, true);
  host.addEventListener('wheel', (e) => {
    const t = activePickTool(); if (!t || !fine()) { controls.enabled = true; return; }
    e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation(); controls.enabled = false;
    t.wheel((e.deltaY || e.deltaX) > 0 ? -1 : 1, e);
  }, { capture: true, passive: false });
  document.body.dataset.pickmode = '1';
}
