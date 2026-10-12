// Trainingsmodus: geführte Tour mit Hervorhebung (Coach Marks) auf der echten Oberfläche.
// Jeder Schritt prüft laufend, ob der Benutzer die Aktion ausgeführt hat (check), und schaltet dann weiter.
export interface TourStep {
  title: string;
  text: string;
  target?: () => Element | null;                         // hervorzuhebendes UI-Element
  world?: () => { x: number; y: number } | null;         // Bildschirmpunkt einer 3D-Stelle (Markierung zum Antippen)
  check?: () => boolean;                                  // Schritt erledigt?
  enter?: () => void;
}

export class Tour {
  idx = 0;
  done = false;
  private card: HTMLDivElement;
  private hl: HTMLDivElement;
  private mk: HTMLDivElement;
  private timer = 0;
  private advanceAt = 0;
  private raf = 0;
  constructor(private name: string, private steps: TourStep[], private onEnd: () => void) {
    this.card = document.createElement('div'); this.card.id = 'tour-card';
    this.hl = document.createElement('div'); this.hl.id = 'tour-hl';
    this.mk = document.createElement('div'); this.mk.id = 'tour-marker';
    document.body.append(this.hl, this.mk, this.card);
    document.body.classList.add('training');
  }
  start() { this.go(0); this.timer = window.setInterval(() => this.tick(), 250); const loop = () => { this.place(); this.raf = requestAnimationFrame(loop); }; loop(); }
  go(i: number) {
    this.idx = Math.max(0, Math.min(this.steps.length - 1, i)); this.advanceAt = 0;
    const s = this.steps[this.idx]; s.enter?.(); this.render();
  }
  end() {
    clearInterval(this.timer); cancelAnimationFrame(this.raf);
    this.card.remove(); this.hl.remove(); this.mk.remove(); document.body.classList.remove('training'); this.done = true; this.onEnd();
  }
  private ok() { const s = this.steps[this.idx]; return !s.check || s.check(); }
  private render() {
    const s = this.steps[this.idx], last = this.idx === this.steps.length - 1, ok = this.ok();
    this.card.innerHTML = `<div class="tc-head"><span class="tc-badge">🎓 ${this.name}</span><span class="tc-n">Schritt ${this.idx + 1}/${this.steps.length}</span>
      <button class="tc-x" title="Training beenden">✕</button></div>
      <div class="tc-title">${s.title}</div><div class="tc-text">${s.text}</div>
      ${s.check ? `<div class="tc-state ${ok ? 'ok' : ''}">${ok ? '✔ Erledigt' : '… warte auf deine Aktion'}</div>` : ''}
      <div class="tc-btns"><button class="btn" id="tc-back" ${this.idx === 0 ? 'disabled' : ''}>◀ Zurück</button>
      <button class="btn primary" id="tc-next" ${ok ? '' : 'disabled'}>${last ? 'Fertig' : 'Weiter ▶'}</button></div>`;
    this.card.dataset.step = String(this.idx);
    this.card.querySelector<HTMLButtonElement>('.tc-x')!.onclick = () => this.end();
    this.card.querySelector<HTMLButtonElement>('#tc-back')!.onclick = () => this.go(this.idx - 1);
    this.card.querySelector<HTMLButtonElement>('#tc-next')!.onclick = () => (last ? this.end() : this.go(this.idx + 1));
  }
  private tick() {
    const s = this.steps[this.idx]; if (!s.check) return;
    const ok = s.check();
    const shown = this.card.querySelector('.tc-state')?.classList.contains('ok');
    if (ok !== shown) this.render();
    if (ok && this.idx < this.steps.length - 1) {
      if (!this.advanceAt) this.advanceAt = performance.now() + 900;
      else if (performance.now() > this.advanceAt) this.go(this.idx + 1);
    } else this.advanceAt = 0;
  }
  private place() {
    const s = this.steps[this.idx];
    const t = s.target?.() as HTMLElement | null | undefined;
    const r = t && t.getClientRects().length ? t.getBoundingClientRect() : null;
    if (r && r.width) {
      this.hl.style.display = 'block';
      Object.assign(this.hl.style, { left: r.left - 5 + 'px', top: r.top - 5 + 'px', width: r.width + 10 + 'px', height: r.height + 10 + 'px' });
    } else this.hl.style.display = 'none';
    const w = s.world?.();
    if (w) { this.mk.style.display = 'block'; this.mk.style.left = w.x + 'px'; this.mk.style.top = w.y + 'px'; } else this.mk.style.display = 'none';
    // Karte nicht über das Ziel legen
    const y = r ? r.top + r.height / 2 : w ? w.y : 0;
    this.card.classList.toggle('top', y > window.innerHeight * 0.5);
  }
}
