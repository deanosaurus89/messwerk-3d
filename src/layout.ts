// Desktop layout: tree (left), dialog (right) and the controls pane (bottom) can be closed and resized;
// the 3D view always keeps the remaining space. Sizes/visibility persist in localStorage.
// On phones the panes are overlays (see style.css) and this module only keeps its state.
export type PaneId = 'tree' | 'dialog' | 'table';
const KEY = 'mw-layout-v1';
const DEF = { tree: 270, dialog: 300, table: 250 };
const MIN = { tree: 160, dialog: 220, table: 110 };
interface LayoutState { size: Record<PaneId, number>; open: Record<PaneId, boolean>; }
let st: LayoutState = { size: { ...DEF }, open: { tree: true, dialog: true, table: true } };
const listeners: (() => void)[] = [];
export const onLayoutChange = (f: () => void) => listeners.push(f);
try { const s = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (s?.size && s?.open) st = { size: { ...DEF, ...s.size }, open: { ...st.open, ...s.open } }; } catch { /* ignore */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ } };
export const paneOpen = (p: PaneId) => st.open[p];
function apply() {
  const r = document.documentElement.style;
  r.setProperty('--tree-w', st.open.tree ? st.size.tree + 'px' : '0px');
  r.setProperty('--dlg-w', st.open.dialog ? st.size.dialog + 'px' : '0px');
  r.setProperty('--tbl-h', st.open.table ? st.size.table + 'px' : '0px');
  document.body.classList.toggle('no-tree', !st.open.tree); document.body.classList.toggle('no-dialog', !st.open.dialog); document.body.classList.toggle('no-table', !st.open.table);
  document.querySelectorAll<HTMLElement>('[data-pane-toggle]').forEach((b) => b.classList.toggle('on', st.open[b.dataset.paneToggle as PaneId]));
  window.dispatchEvent(new Event('resize')); listeners.forEach((f) => f());
}
export function setPaneOpen(p: PaneId, on: boolean) { st.open[p] = on; save(); apply(); }
export function initLayout() {
  const spec: [PaneId, string, 'x' | '-x' | 'y'][] = [['tree', '#tree-pane', 'x'], ['dialog', '#dialog-pane', '-x'], ['table', '#table-pane', 'y']];
  for (const [p, sel, ax] of spec) {
    const pane = document.querySelector<HTMLElement>(sel)!; const h = document.createElement('div'); h.className = 'splitter splitter-' + p; h.title = 'Drag to resize';
    pane.appendChild(h);
    const title = pane.querySelector('.pane-title'); if (title && !title.querySelector('.pane-x')) {
      const x = document.createElement('button'); x.className = 'pane-x'; x.textContent = '✕'; x.title = 'Close panel (View ribbon reopens it)';
      x.onclick = () => setPaneOpen(p, false); title.insertBefore(x, title.firstChild); }
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault(); h.setPointerCapture(e.pointerId); const x0 = e.clientX, y0 = e.clientY, s0 = st.size[p]; document.body.classList.add('resizing');
      const mv = (ev: PointerEvent) => { const d = ax === 'x' ? ev.clientX - x0 : ax === '-x' ? x0 - ev.clientX : y0 - ev.clientY;
        const max = ax === 'y' ? innerHeight * 0.7 : innerWidth * 0.45; st.size[p] = Math.round(Math.min(max, Math.max(MIN[p], s0 + d))); apply(); };
      const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); document.body.classList.remove('resizing'); save(); };
      h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
    });
    h.addEventListener('dblclick', () => { st.size[p] = DEF[p]; save(); apply(); });
  }
  document.querySelectorAll<HTMLElement>('[data-pane-toggle]').forEach((b) => (b.onclick = () => setPaneOpen(b.dataset.paneToggle as PaneId, !st.open[b.dataset.paneToggle as PaneId])));
  apply();
}
