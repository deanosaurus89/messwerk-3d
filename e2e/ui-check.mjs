// Headless-Prüfung der Produktionsversion (dist/) mit Playwright + Chromium.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 8765;
const srv = spawn('npx', ['serve', '-l', String(PORT), 'dist'], { stdio: 'ignore' });
await sleep(2500);
const exe = process.env.CHROME || undefined;
const browser = await chromium.launch({ executablePath: exe, channel: exe ? undefined : 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.click('#btn-sample');
  await page.waitForFunction(() => window.__app.state.data, null, { timeout: 120000 });
  console.log('Geladen:', await page.textContent('#stats'));
  await page.click('.tab[data-tab="merkmale"]');
  await page.click('[data-ftype="auto"]');

  // Weltpunkt anklicken: in mehreren Ansichten suchen, bis der Strahl die Zielstelle trifft
  async function clickWorld(p, views = ['iso', '-Y', '+X', '+Z', '-X', '+Y']) {
    for (const v of views) {
      const xy = await page.evaluate(([p, v]) => {
        const { viewer } = window.__app; viewer.view(v);
        const THREE_V = viewer.camera.position.clone().set(p[0], p[1], p[2]).project(viewer.camera);
        const r = viewer.renderer.domElement.getBoundingClientRect();
        const x = r.left + (THREE_V.x + 1) / 2 * r.width, y = r.top + (1 - THREE_V.y) / 2 * r.height;
        const h = viewer.pick(x, y);
        if (!h) return null;
        const d = Math.hypot(h.point[0] - p[0], h.point[1] - p[1], h.point[2] - p[2]);
        return d < 0.6 ? [x, y] : null;
      }, [p, v]);
      if (xy) { await page.mouse.click(xy[0], xy[1]); return v; }
    }
    return null;
  }
  const targets = [
    ['Ebene', [5, 55, 20]], ['Zylinder', [20, 26.04, 17]], ['Zylinder', [85, 13, 16]], ['Langloch', [20, 50, 16]],
    ['Zylinder', [55.05, 22, 26]], ['Kegel', [82, 29.2, 22]], ['Kugel', [60, 3.1, 22]],
  ];
  for (const [type, p] of targets) {
    const n0 = await page.evaluate(() => window.__app.state.features.length);
    const v = await clickWorld(p);
    if (!v) { fail(`Zielpunkt ${p} nicht sichtbar`); continue; }
    await page.waitForFunction((n) => window.__app.state.features.length > n, n0, { timeout: 60000 }).catch(() => {});
    const f = await page.evaluate(() => { const f = window.__app.state.features.at(-1); return f && { type: f.type, d: f.measured.diameter, l: f.measured.length, w: f.measured.width, c: f.measured.center, rms: f.measured.rms }; });
    console.log(`Klick ${p} (Ansicht ${v}) ->`, JSON.stringify(f));
    if (!f || f.type !== type) fail(`erwartet ${type}, erhalten ${f?.type}`);
  }
  await page.keyboard.press('Escape');
  // Sollwerte eintragen
  const nominals = { 'Zylinder 1|Durchmesser': 12, 'Zylinder 1|X': 20, 'Zylinder 1|Y': 20, 'Zylinder 2|Durchmesser': 6, 'Langloch 1|Länge': 30, 'Langloch 1|Breite': 10,
    'Zylinder 3|Durchmesser': 16, 'Zylinder 3|X': 55, 'Kugel 1|Durchmesser': 14, 'Kegel 1|Kegelwinkel': 61.93, 'Ebene 1|Ebenheit': 0 };
  const nrows = (await page.$$('#ctrl-table tbody tr')).length;
  for (let i = 0; i < nrows; i++) {
    const r = (await page.$$('#ctrl-table tbody tr'))[i];
    const [a, b] = await r.$$eval('td', (t) => [t[0].textContent, t[1].textContent]);
    const k = `${a}|${b}`;
    if (k in nominals) { const inp = (await r.$$('td input'))[0]; await inp.fill(String(nominals[k]).replace('.', ',')); await inp.press('Enter'); }
    if (k === 'Zylinder 1|Durchmesser') { // engere Toleranz -> NIO
      const r2 = (await page.$$('#ctrl-table tbody tr'))[i]; const ins = await r2.$$('td input');
      await ins[1].fill('0,05'); await ins[1].press('Enter');
      const r3 = (await page.$$('#ctrl-table tbody tr'))[i]; await (await r3.$$('td input'))[2].fill('-0,05'); await (await r3.$$('td input'))[2].press('Enter');
    }
  }
  // Abstand zwischen Bohrung (Zylinder 1) und Bolzen (Zylinder 3)
  await page.click('.tab[data-tab="pruef"]');
  await page.click('#tree .node:has-text("Zylinder 1")');
  await page.click('[data-dist="Abstand X"]');
  await page.click('#tree .node:has-text("Zylinder 3")');
  const last = (await page.$$('#ctrl-table tbody tr')).at(-1);
  const inp = (await last.$$('td input'))[0]; await inp.fill('35'); await inp.press('Enter');
  const res = await page.evaluate(() => [...document.querySelectorAll('#ctrl-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].slice(0, 8).map((t) => t.querySelector('input')?.value ?? t.textContent).join(' | ')));
  console.log(res.join('\n'));
  await page.click('#tree .node:has-text("Zylinder 1")');
  await page.evaluate(() => window.__app.viewer.view('iso'));
  await sleep(500);
  await page.screenshot({ path: 'docs/screenshot-uebersicht.png' });
  // Pinsel-Test an der Oberseite
  await page.click('.tab[data-tab="merkmale"]');
  await page.click('[data-ftype="Ebene"]');
  await page.click('#dialog [data-m="Pinsel"]');
  await page.evaluate(() => window.__app.viewer.view('+Z'));
  const pt = await page.evaluate(() => { const { viewer } = window.__app; const v = viewer.camera.position.clone().set(12, 6, 20).project(viewer.camera); const r = viewer.renderer.domElement.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; });
  await page.mouse.move(pt[0], pt[1]); await page.mouse.down();
  for (let i = 0; i < 10; i++) { await page.mouse.move(pt[0] + i * 4, pt[1]); await sleep(80); }
  await page.mouse.up(); await sleep(300);
  console.log('Pinsel markiert:', await page.evaluate(() => window.__app.state.brushCount));
  await page.screenshot({ path: 'docs/screenshot-pinsel.png' });
  await page.click('#d-create');
  await page.waitForFunction(() => window.__app.state.features.at(-1).method === 'Pinsel', null, { timeout: 30000 });
  console.log('Pinsel-Merkmal:', await page.evaluate(() => { const f = window.__app.state.features.at(-1); return `${f.name} Z=${f.measured.center[2].toFixed(4)} Ebenheit=${f.measured.form.toFixed(4)} n=${f.pointCount}`; }));
  await page.keyboard.press('Escape');
  // Tablet-Ansicht (iPad quer)
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.click('#tree .node:has-text("Langloch 1")');
  await page.evaluate(() => window.__app.viewer.view('+Z'));
  await sleep(500);
  await page.screenshot({ path: 'docs/screenshot-ipad-langloch.png' });
  // CSV-Export
  await page.click('.tab[data-tab="start"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-csv')]);
  await dl.saveAs('docs/beispiel-pruefmerkmale.csv');
  console.log('CSV gespeichert.');
} catch (e) { fail(e.stack || e); }
console.log('Konsolenfehler:', errors.length ? errors : 'keine');
if (errors.length) process.exitCode = 1;
await browser.close(); srv.kill();
