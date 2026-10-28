// Mobile CAD nominal: tap a face → highlight/preview → ✓ → tree.
// Aufruf: node e2e/mobile-nominal.mjs <URL>
// One iPhone portrait pass. The display mesh is the coarse 0.48 chord; the tap must still resolve a face.
import { webkit, devices } from 'playwright';
const URL = process.argv[2] || 'http://localhost:8765/';
const b = await webkit.launch();
const ctx = await b.newContext({ ...devices['iPhone 14'] });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(URL + (URL.includes('?') ? '&' : '?') + 'nodemo', { waitUntil: 'networkidle' });
await page.evaluate(() => document.querySelector('#btn-sample').click());
await page.locator('.sample-card[data-key="cadsample"]').tap();
await page.waitForFunction(() => window.__app.cad.faces.length > 10, null, { timeout: 180000 });
await page.evaluate(() => {
  window.__app.startFitMode('auto', 'soll');
  document.querySelectorAll('#labels .lbl, #leaders').forEach((e) => { e.style.pointerEvents = 'none'; });
});
const hit = await page.evaluate(() => {
  const { cadPickHit, viewer, cad } = window.__app;
  viewer.view('iso');
  const r = viewer.renderer.domElement.getBoundingClientRect();
  let fallback = null;
  for (let y = r.top + 30; y < r.bottom - 90; y += 12) {
    for (let x = r.left + 16; x < r.right - 16; x += 12) {
      const top = document.elementFromPoint(x, y);
      if (top !== viewer.renderer.domElement) continue;
      const h = cadPickHit(x, y);
      if (!h) continue;
      const face = cad.faces[h.id];
      const spot = { x, y, id: h.id, type: face?.type ?? '' };
      if (!fallback) fallback = spot;
      if (face?.type === 'Ebene' || face?.type === 'Zylinder') return spot;
    }
  }
  return fallback;
});
if (!hit) errs.push('no CAD face under a touch point');
else {
  console.log('tap', JSON.stringify(hit));
  await page.touchscreen.tap(hit.x, hit.y);
  try {
    await page.waitForFunction(() => window.__app.state.preview?.role === 'soll', null, { timeout: 10000 });
  } catch (e) { errs.push('no nominal preview: ' + (await page.textContent('#status')) + ' / ' + e.message); }
  const ok = await page.locator('#cp-ok').isVisible().catch(() => false);
  if (!ok) errs.push('confirm button missing');
  else {
    const hover = await page.evaluate(() => window.__app.cad.hover);
    if (!(hover >= 0)) errs.push('face not highlighted');
    await page.tap('#cp-ok');
    try {
      await page.waitForFunction(() => window.__app.state.features.some((f) => f.soll), null, { timeout: 8000 });
    } catch (e) { errs.push('not in the tree: ' + e.message); }
  }
}
const feat = await page.evaluate(() => window.__app.state.features.map((f) => `${f.type}:${f.soll ? 'soll' : 'ist'}`).join(','));
console.log(errs.length ? 'FEHLER ' + errs.join(' | ') : 'OK nominal tap → ' + feat);
await b.close();
process.exitCode = errs.length ? 1 : 0;
