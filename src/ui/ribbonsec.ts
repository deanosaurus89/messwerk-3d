// Ribbon sections: a panel with several sections (.rsec markers, e.g. Start › Features | Coordinate Systems | Mesh
// editing) shows ONE section at a time, chosen with the chips at the panel's left edge – so the panel never needs
// horizontal scrolling (desktop and phone). The choice is remembered per panel. Activating a control inside a hidden
// section from code (e.g. a shortcut) stays possible; showRibbonSection() switches to the section of an element.
const KEY = 'mw3d-rsec';
let mem: Record<string, number> = {};
try { mem = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* private mode */ }

function apply(panel: HTMLElement, k: number) {
  panel.querySelectorAll<HTMLElement>('[data-rs]').forEach((g) => g.classList.toggle('rs-off', +g.dataset.rs! !== k));
  panel.querySelectorAll<HTMLButtonElement>('.rsec-nav button').forEach((b, i) => { b.classList.toggle('on', i === k); b.setAttribute('aria-selected', String(i === k)); });
  panel.dataset.rsk = String(k);
}
export function initRibbonSections(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('#ribbon .panel').forEach((panel) => {
    const marks = [...panel.querySelectorAll<HTMLElement>(':scope > .rsec')]; if (marks.length < 2 || panel.querySelector('.rsec-nav')) return;
    const nav = document.createElement('div'); nav.className = 'rsec-nav'; nav.setAttribute('role', 'tablist');
    let k = -1;
    for (const el of [...panel.children] as HTMLElement[]) {
      if (el.classList.contains('rsec')) { k++; const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab');
        const label = el.textContent?.trim() || el.title; b.textContent = label; b.title = el.title || label; const kk = k; b.onclick = () => { mem[panel.dataset.tab!] = kk; try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* ignore */ } apply(panel, kk); };
        nav.appendChild(b); el.remove(); continue; }
      if (k >= 0) el.dataset.rs = String(k);
    }
    panel.prepend(nav); if (marks.every((m) => m.hasAttribute('data-phone'))) panel.classList.add('rs-phoneonly'); // desktop: all groups, chips only on the phone
    apply(panel, Math.min(mem[panel.dataset.tab!] ?? 0, k));
  });
}
/** switch to the section that contains el (if it is inside a sectioned panel) */
export function showRibbonSection(el: Element | null) {
  const g = el?.closest<HTMLElement>('[data-rs]'), panel = g?.closest<HTMLElement>('.panel'); if (g && panel) apply(panel, +g.dataset.rs!);
}

/** Desktop: no horizontal scrolling – while the visible panel is wider than the ribbon, switch its largest group to the
 *  compact two-row layout (small buttons, icon beside the label; tooltips unchanged). Phone layout is pure CSS (wrap). */
export function fitRibbon() {
  const rib = document.getElementById('ribbon'); if (!rib) return;
  const panel = rib.querySelector<HTMLElement>('.panel:not(.hidden)'); if (!panel) return;
  const groups = [...panel.querySelectorAll<HTMLElement>(':scope > .group')];
  groups.forEach((g) => g.classList.remove('compact'));
  if (matchMedia('(max-width: 900px), (max-height: 560px)').matches) return;
  const over = () => panel.scrollWidth > panel.clientWidth + 1;
  const cand = groups.filter((g) => !g.classList.contains('rs-off') && g.querySelectorAll('.big').length >= 3)
    .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
  for (const g of cand) { if (!over()) break; g.classList.add('compact'); }
}
let fitT = 0;
export function installFitRibbon() {
  const run = () => { cancelAnimationFrame(fitT); fitT = requestAnimationFrame(fitRibbon); };
  window.addEventListener('resize', run);
  document.getElementById('ribbon-tabs')?.addEventListener('click', run);
  document.getElementById('ribbon')?.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('.rsec-nav')) run(); });
  run();
}
