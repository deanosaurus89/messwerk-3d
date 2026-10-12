// Mobil-Prüfung (WebKit/iPhone + Chromium): Modell sichtbar? Tap-Extraktion?
// Aufruf: node e2e/mobile-check.mjs <URL> [screenshot-prefix]
import { webkit, chromium, devices } from 'playwright';
const URL = process.argv[2] || 'http://localhost:8765/';
const prefix = process.argv[3] || '';
let failed = false;
async function run(browserType, devName, landscape, label) {
  const b = await browserType.launch(browserType === chromium ? { channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {});
  const dev = landscape ? devices[devName + ' landscape'] : devices[devName];
  const ctx = await b.newContext({ ...dev });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.click('#btn-sample');
  await page.waitForFunction(() => window.__app.state.data, null, { timeout: 120000 });
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => {
    const { viewer } = window.__app; const c = viewer.renderer.domElement, r = c.getBoundingClientRect();
    const gl = viewer.renderer.getContext();
    // Pixel in Bildmitte lesen: Teil (grau) vs. Hintergrund (blau-grau Verlauf)
    viewer.renderer.render(viewer.scene, viewer.camera);
    const px = new Uint8Array(4); gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { w: r.width, h: r.height, buf: [gl.drawingBufferWidth, gl.drawingBufferHeight], webgl2: viewer.renderer.capabilities.isWebGL2, px: [...px] };
  });
  // Teil sichtbar, wenn Mittelpixel nicht dem Hintergrund entspricht: Netz ist mittig, Hintergrundfarbe ändert sich vertikal glatt
  const bgRef = await page.evaluate(() => { const { viewer } = window.__app; const m = viewer.model; m.visible = false; viewer.renderer.render(viewer.scene, viewer.camera);
    const gl = viewer.renderer.getContext(); const px = new Uint8Array(4); gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); m.visible = true; return [...px]; });
  const visible = info.w > 50 && info.h > 50 && info.px.some((v, i) => Math.abs(v - bgRef[i]) > 12);
  // Tap auf Bohrungswand
  await page.evaluate(() => { const b = document.querySelector('[data-ftype="auto"]'); b.click(); });
  const xy = await page.evaluate(() => { const { viewer } = window.__app; viewer.view('iso'); const v = viewer.camera.position.clone().set(20, 26.04, 17).project(viewer.camera); const r = viewer.renderer.domElement.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; });
  const tapWorld = async (p) => {
    const xy = await page.evaluate((p) => { const { viewer } = window.__app; viewer.view('iso'); const v = viewer.camera.position.clone().set(...p).project(viewer.camera); const r = viewer.renderer.domElement.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }, p);
    await page.touchscreen.tap(xy[0], xy[1]);
  };
  await tapWorld([20, 26.04, 17]);
  let feat = null;
  try {
    await page.waitForFunction(() => window.__app.state.preview, null, { timeout: 30000 });
    if (await page.evaluate(() => window.__app.state.features.length)) throw new Error('sofort erzeugt');
    if (!(await page.isVisible('#pc-create'))) throw new Error('Erzeugen-Knopf nicht sichtbar');
    if (prefix) await page.screenshot({ path: `${prefix}${label}-vorschau.png` });
    await page.tap('#pc-create');
    await page.waitForFunction(() => window.__app.state.features.length > 0, null, { timeout: 10000 });
    feat = await page.evaluate(() => { const f = window.__app.state.features[0]; return `${f.type} D=${f.measured.diameter?.toFixed(4)}`; });
  } catch (e) { errs.push('Ablauf: ' + e.message); }
  await page.waitForTimeout(400);
  if (prefix) await page.screenshot({ path: `${prefix}${label}.png` });
  if (prefix && label.includes('hochformat') && feat) {
    await tapWorld([55.05, 22, 26]);
    await page.waitForFunction(() => window.__app.state.preview, null, { timeout: 30000 });
    await page.tap('#pc-create');
    await page.evaluate(() => document.querySelector('.tab[data-tab="merkmale"]').click());
    await page.tap('#btn-distance');
    await page.waitForTimeout(400);
    await page.selectOption('#d-a', { label: 'Zylinder 1' }); await page.selectOption('#d-b', { label: 'Zylinder 2' });
    await page.waitForFunction(() => window.__app.state.preview?.fit.type === 'Abstand');
    await page.tap('#pc-create');
    await page.evaluate(() => window.__app.viewer.view('+Z'));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${prefix}${label}-abstand.png` });
    await page.tap('#mobile-bar [data-panel="tree"]'); await page.waitForTimeout(400);
    await page.screenshot({ path: `${prefix}${label}-baum.png` });
    await page.tap('#mobile-bar [data-panel="tree"]');
    await page.tap('#mobile-bar [data-panel="table"]'); await page.waitForTimeout(300);
    for (const [f, k, n] of [['Zylinder 1', 'Durchmesser', '12'], ['Abstand 1', 'Abstand X', '35'], ['Abstand 1', 'Abstand 3D', '40,1']]) {
      await page.selectOption('#ca-feat', { label: f }); await page.selectOption('#ca-kind', { label: k }); await page.tap('#ca-add');
      const inp = page.locator('#ctrl-table tbody tr').last().locator('td input').first(); await inp.fill(n); await inp.press('Enter');
    }
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${prefix}${label}-liste.png` });
    const st = await page.evaluate(() => [...document.querySelectorAll('#ctrl-table .st')].map((e) => e.textContent).join(','));
    console.log('   Liste:', st);
    if (st !== 'IO,IO,IO') errs.push('Liste unerwartet: ' + st);
    const tree = await page.textContent('#tree'); if (/Durchmesser|Abstand X/.test(tree)) errs.push('Prüfmerkmale im Baum');
  }
  const ok = visible && feat?.startsWith('Zylinder') && !errs.length;
  if (!ok) failed = true;
  console.log(`${ok ? 'OK ' : 'FEHLER'} ${label}: Canvas ${info.w}x${info.h} (Puffer ${info.buf}), WebGL2=${info.webgl2}, Mitte ${info.px} vs. Hintergrund ${bgRef} -> sichtbar=${visible}; Tap -> ${feat}; Fehler: ${errs.length ? errs : 'keine'}`);
  await b.close();
}
await run(webkit, 'iPhone 14', false, 'webkit-hochformat');
await run(webkit, 'iPhone 14', true, 'webkit-querformat');
await run(webkit, 'iPad (gen 7)', true, 'webkit-ipad');
await run(chromium, 'Pixel 7', false, 'chromium-hochformat');
process.exitCode = failed ? 1 : 0;
