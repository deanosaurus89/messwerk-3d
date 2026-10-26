// Training: jeden Schritt überspringen (Ergebnis wird automatisch erzeugt) und per Schrittliste springen.
// Aufruf: node e2e/training-skip-check.mjs [URL|-] [desktop|iphone]
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
const result = () => S(() => { const { state } = window.__app; const fm = new Map(state.features.map((f) => [f.id, f]));
  const pc = state.controls.find((c) => c.kind === 'Position');
  return { feats: state.features.map((f) => f.name + (f.datum ? `[${f.datum}]` : '')).join(', '), pos: pc ? pc.datumIds.map((i) => fm.get(i)?.datum).join('|') + ' ' + JSON.stringify(pc.basic) : '',
    posVal: pc ? window.__app.evaluate(pc, fm, window.__app.ctx).measured : null }; });
try {
  await page.goto(URL.includes('nodemo') ? URL : URL + (URL.includes('?') ? '&' : '?') + 'nodemo', { waitUntil: 'networkidle' });
  // A) alles überspringen
  await S(() => window.__app.startTraining()); let n = 0;
  while (n++ < 40) {
    const t = await S(() => { const t = window.__app.tour; return t ? { i: t.idx, n: t.steps.length } : null; }); if (!t) break;
    if (t.i === t.n - 1) { await page.click('#tc-next'); break; }
    const skip = page.locator('#tc-skip');
    if (await skip.count()) await skip.click(); else await page.click('#tc-next');
    await page.waitForFunction((i) => !window.__app.tour || window.__app.tour.idx !== i, t.i, { timeout: 60000 });
    if (t.i === 1 && MODE === 'desktop') await page.screenshot({ path: `${process.env.SHOT_DIR || 'docs'}/${MODE}-training-ueberspringen.png` });
  }
  let r = await result(); console.log('Alles übersprungen:', JSON.stringify(r));
  if (!/Plane 1\[A\].*Plane 2\[B\].*Plane 3\[C\].*Cylinder 1/.test(r.feats) || r.pos !== 'A|B|C [20,20,0]' || !(r.posVal < 0.05)) fail('Überspringen erzeugt nicht alle Ergebnisse');
  // B) neu laden, Training, Schrittliste → direkt zu „Positionstoleranz“
  await page.reload({ waitUntil: 'networkidle' }); await page.click('#rb-discard').catch(() => {});
  await S(() => window.__app.startTraining()); await page.click('#tc-list'); await sleep(200);
  await page.screenshot({ path: `${process.env.SHOT_DIR || 'docs'}/${MODE}-training-schrittliste.png` });
  const k = await S(() => window.__app.tour.steps.findIndex((s) => s.title.startsWith('Position tolerance')));
  await page.click(`.tc-list button[data-i="${k}"]`);
  await page.waitForFunction((k) => window.__app.tour?.idx === k, k, { timeout: 90000 });
  r = await result(); console.log('Sprung zu Schritt', k + 1, ':', JSON.stringify(r));
  if (!/Plane 1\[A\].*Plane 2\[B\].*Plane 3\[C\].*Cylinder 1/.test(r.feats)) fail('Sprung erzeugt Voraussetzungen nicht');
  await sleep(1500);
  if (!(await S(() => window.__app.tour.idx)) > k) console.log('(Position automatisch erkannt → weiter)');
} catch (e) { fail(e.stack || e); }
console.log('Konsolenfehler:', errors.length ? errors : 'keine'); if (errors.length) process.exitCode = 1;
await browser.close();
