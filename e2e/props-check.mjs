// Eigenschaften-Dialog: Fit-Parameter (Methode, Ausreißer, Regionenwachstum, Normalenfilter, Typ) mit automatischem Neu-Fit,
// Bezug umbenennen/entfernen, Abstand + Prüfmerkmal aktualisiert.  Aufruf: node e2e/props-check.mjs [URL|-] [desktop|iphone]
import { chromium, webkit, devices } from 'playwright';
import { setTimeout as sleep } from 'node:timers/promises';
const URL = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : 'http://localhost:8766/';
const MODE = process.argv[3] || 'desktop';
const browser = MODE === 'desktop' ? await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }) : await webkit.launch();
const ctx = await browser.newContext(MODE === 'desktop' ? { viewport: { width: 1600, height: 950 } } : { ...devices['iPhone 14 Pro'] });
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
const S = (f, a) => page.evaluate(f, a);
const hole = () => S(() => { const { state, evaluate, ctx } = window.__app; const f = state.features.find((x) => x.type === 'Zylinder' || x.name.startsWith('Zylinder') || x.name.startsWith('Kreis'));
  const fm = new Map(state.features.map((x) => [x.id, x])); const pc = state.controls.find((c) => c.kind === 'Position');
  const m = f.measured; return { type: f.type, n: f.pointCount, d: m.diameter, rms: m.rms, nf: m.nfRemoved ?? 0, out: m.outliers ?? 0, pos: pc ? evaluate(pc, fm, ctx).measured : null, dist: state.features.find((x) => x.type === 'Abstand')?.measured.distance }; });
const setInput = async (sel, v) => { await page.fill(sel, String(v)); await page.press(sel, 'Enter'); await page.locator(sel).evaluate((e) => e.dispatchEvent(new Event('change', { bubbles: true }))); };
const waitIdle = async (prev) => { await page.waitForFunction((p) => { const f = window.__app.state.features.find((x) => x.name.startsWith('Zylinder') || x.name.startsWith('Kreis')); return f && JSON.stringify([f.pointCount, f.measured.rms, f.type]) !== p; }, prev, { timeout: 30000 }).catch(() => {}); await sleep(300); };
try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await S(() => window.__app.startTraining()); await page.click('#tc-list');
  const k = await S(() => window.__app.tour.steps.findIndex((s) => s.title.startsWith('Positionstoleranz')));
  await page.click(`.tc-list button[data-i="${k}"]`);
  await page.waitForFunction((k) => window.__app.tour?.idx === k, k, { timeout: 90000 });
  await S(() => window.__app.tour.ensureUpTo ? null : null);
  // Position anlegen lassen, Training beenden
  await page.click('#tc-skip').catch(() => {}); await sleep(800);
  await page.click('#tour-card .tc-x'); await sleep(300);
  // Abstand Bohrung → Ebene C (konstruiert) anlegen, damit Aktualisierung prüfbar ist
  await S(() => { const { state } = window.__app; const h = state.features.find((x) => x.name.startsWith('Zylinder')); state.sel = [h.id]; state.mode = null; window.__app.renderAll(); });
  if (MODE !== 'desktop') await S(() => window.__app.togglePanel('dialog', true));
  await page.waitForSelector('#fp-box');
  const sig = async () => { const h = await hole(); return JSON.stringify([h.n, h.rms, h.type]); };
  const h0 = await hole(); console.log('Start:', JSON.stringify(h0));
  if (!(h0.pos != null)) fail('Position fehlt');
  // 1) Normalenfilter ein (Standard 30° / 10 %), dann 5° / 25 %
  let p = await sig(); await page.locator('#fp-nf').check(); await waitIdle(p);
  p = await sig(); await setInput('#fp-nfa', 5); await waitIdle(p);
  p = await sig(); await setInput('#fp-nfp', 25); await waitIdle(p);
  const h1 = await hole(); console.log('Normalenfilter 5°/25 %:', JSON.stringify(h1));
  if (!(h1.nf > 0 && h1.n < h0.n && h1.n >= Math.floor(h0.n * 0.75) - 1)) fail('Normalenfilter wirkt nicht/zu stark');
  await page.locator('#fp-nf').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `docs/${MODE}-eigenschaften-normalenfilter.png` });
  // 2) Methode ohne Ausreißerentfernung
  p = await sig(); await page.selectOption('#fp-method', 'lsq'); await waitIdle(p);
  const h2 = await hole(); console.log('Gauß ohne Ausreißer:', JSON.stringify(h2)); if (h2.out !== 0) fail('Ausreißer trotz LSQ');
  await page.selectOption('#fp-method', 'rob'); await sleep(800);
  // 3) Regionenwachstum enger
  p = await sig(); await setInput('#fp-ang', 5); await waitIdle(p);
  const h3 = await hole(); console.log('Wachstum 5°:', JSON.stringify(h3)); if (!(Math.abs(h3.d - 12.08) < 0.1)) fail('Durchmesser nach Neu-Fit falsch');
  // 4) Typ → Kreis (Hilfsebene automatisch) und zurück
  p = await sig(); await page.selectOption('#d-retype', 'Kreis'); await waitIdle(p);
  const h4 = await hole(); console.log('Typ Kreis:', JSON.stringify(h4)); if (h4.type !== 'Kreis') fail('Typwechsel ohne Wirkung');
  await page.waitForSelector('#fp-aux');
  p = await sig(); await page.selectOption('#d-retype', 'Zylinder'); await waitIdle(p);
  // 5) Bezug am Merkmal: Ebene A umbenennen in D und zurück, entfernen + wieder zuweisen
  const datums = async () => S(() => window.__app.state.features.filter((f) => f.datum).map((f) => f.name + '=' + f.datum).join(','));
  await S(() => { const { state } = window.__app; state.sel = [state.features.find((f) => f.datum === 'A').id]; window.__app.renderAll(); });
  await page.selectOption('#dt-letter', 'D'); await page.click('#dt-apply'); const d1 = await datums();
  await page.click('#dt-remove'); const d2 = await datums();
  await page.selectOption('#dt-letter', 'A'); await page.click('#dt-apply'); const d3 = await datums();
  console.log('Bezüge:', d1, '|', d2, '|', d3);
  if (!d1.includes('Ebene 1=D') || d2.includes('Ebene 1=') || !d3.includes('Ebene 1=A')) fail('Bezug umbenennen/entfernen');
  const h5 = await hole(); console.log('Ende:', JSON.stringify(h5)); if (!(h5.pos != null && h5.pos < 0.05)) fail('Position nach Neu-Fit nicht aktualisiert');
} catch (e) { fail(e.stack || e); }
console.log('Konsolenfehler:', errors.length ? errors : 'keine'); if (errors.length) process.exitCode = 1;
await browser.close();
