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
    // Katalog (Bottom-Sheet, Register „Katalog“): Haken setzen, Soll eintragen
    for (const [f, k, n] of [['Zylinder 1', 'Durchmesser', '12'], ['Abstand 1', 'Abstand X', '35'], ['Abstand 1', 'Abstand 3D', '40,1']]) {
      await page.selectOption('#cat-feat', { label: f });
      await page.locator(`#catalog .cat-item[data-kind="${k}"] input[type=checkbox]`).tap();
      const inp = page.locator(`#catalog .cat-item[data-kind="${k}"] .cat-ed input`).first(); await inp.fill(n); await inp.press('Enter');
    }
    await page.selectOption('#cat-feat', { label: 'Zylinder 1' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${prefix}${label}-katalog.png` });
    await page.tap('#table-pane button[data-ctab="liste"]');    await page.waitForTimeout(400);
    await page.screenshot({ path: `${prefix}${label}-liste.png` });
    const st = await page.evaluate(() => [...document.querySelectorAll('#ctrl-table .st')].map((e) => e.textContent).join(','));
    console.log('   Liste:', st);
    if (st !== 'IO,IO,IO') errs.push('Liste unerwartet: ' + st);
    const tree = await page.textContent('#tree'); if (/Durchmesser|Abstand X/.test(tree)) errs.push('Prüfmerkmale im Baum');
    await page.tap('#mobile-bar [data-panel="table"]'); await page.waitForTimeout(300);
    // Labels + ViewCube
    await page.evaluate(() => window.__app.viewer.view('iso')); await page.waitForTimeout(400);
    const nl = await page.evaluate(() => document.querySelectorAll('#labels .lbl').length);
    const lz = await page.evaluate(() => document.querySelector('#labels .lbl[data-fid="1"]')?.textContent ?? '');
    if (nl !== 3 || !lz.includes('Durchmesser')) errs.push(`Labels: ${nl} / ${lz}`);
    const cb = await page.locator('#navcube').boundingBox();
    // Tap auf die Mitte der OBEN-Fläche
    const top = await page.evaluate(() => { const c = window.__app.viewer.cube; c.syncCam(); const r = c.el.getBoundingClientRect(); const v = c.cam.position.clone().set(0, 0, 1).project(c.cam); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; });
    await page.touchscreen.tap(top[0], top[1]); await page.waitForTimeout(300);
    const dz = await page.evaluate(() => { const { viewer } = window.__app; return viewer.camera.position.clone().sub(viewer.controls.target).normalize().z; });
    if (dz < 0.999 || cb.x > 20) errs.push('ViewCube-Tap OBEN: ' + dz);
    await page.evaluate(() => window.__app.viewer.view('iso')); await page.waitForTimeout(300);
    await page.screenshot({ path: `${prefix}${label}-labels-viewcube.png` });
    // Augen-Symbol im Baum
    await page.tap('#mobile-bar [data-panel="tree"]'); await page.waitForTimeout(300);
    await page.locator('#tree [data-fid="2"] .eye').tap();
    await page.screenshot({ path: `${prefix}${label}-baum-augen.png` });
    if (!(await page.evaluate(() => window.__app.state.hidden.has(2)))) errs.push('Auge ohne Wirkung');
    await page.locator('#tree [data-fid="2"] .eye').tap();
    await page.tap('#mobile-bar [data-panel="tree"]');
    // Hilfsebene: Kreis-Modus, Tap auf die Oberseite neben der Bohrung -> zweifarbige Vorschau
    await page.evaluate(() => { document.querySelector('.tab[data-tab="merkmale"]').click(); document.querySelector('[data-ftype="Kreis"]').click(); });
    await page.evaluate(() => { const { viewer } = window.__app; viewer.controls.target.set(22, 22, 17); viewer.camera.position.set(37, -8, 50); viewer.controls.update(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => { document.querySelectorAll('#labels .lbl').forEach((e) => (e.style.pointerEvents = 'none')); });
    const hp = await page.evaluate(() => { const { viewer } = window.__app; const r = viewer.renderer.domElement.getBoundingClientRect();
      for (const p of [[27.2, 20, 20], [20, 27.2, 20], [12.8, 20, 20], [20, 12.8, 20]]) {
        const v = viewer.camera.position.clone().set(...p).project(viewer.camera); const x = r.left + (v.x + 1) / 2 * r.width, y = r.top + (1 - v.y) / 2 * r.height;
        const h = viewer.pick(x, y);
        if (h && document.elementFromPoint(x, y) === viewer.renderer.domElement && Math.hypot(h.point[0] - p[0], h.point[1] - p[1], h.point[2] - p[2]) < 0.6) return [x, y]; }
      return [0, 0]; });
    await page.touchscreen.tap(hp[0], hp[1]);
    await page.waitForFunction(() => window.__app.state.preview?.aux, null, { timeout: 30000 }).catch(async () => errs.push('Hilfsebene: ' + await page.textContent('#status')));
    await page.waitForTimeout(300);
    console.log('   Hilfsebene:', await page.evaluate(() => { const p = window.__app.state.preview; return p?.aux ? [p.indices.length, p.aux.indices.length, p.fit.diameter.toFixed(4), p.fit.form.toFixed(4)].join(' / ') : 'keine'; }));
    await page.screenshot({ path: `${prefix}${label}-hilfsebene-vorschau.png` });
    if (await page.evaluate(() => window.__app.state.preview?.aux)) { await page.tap('#pc-create'); }
    // Bericht
    await page.evaluate(() => { document.querySelector('.tab[data-tab="pruef"]').click(); });
    await page.tap('#btn-report2'); await page.waitForTimeout(400);
    await page.screenshot({ path: `${prefix}${label}-bericht.png` });
    const rep = await page.textContent('#report-view'); if (!rep.includes('Tabelle 1') || !rep.includes('Kreis 1')) errs.push('Bericht unvollständig');
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
