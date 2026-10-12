// Headless-Prüfung (Desktop) der dist/-Version oder einer URL: node e2e/ui-check.mjs [URL]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

let URL = process.argv[2], srv = null;
if (!URL) { URL = 'http://localhost:8765/'; srv = spawn('npx', ['serve', '-l', '8765', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
const S = (fn, arg) => page.evaluate(fn, arg);
async function clickWorld(p, views = ['iso', '-Y', '+X', '+Z', '-X', '+Y']) {
  for (const v of views) {
    const xy = await S(([p, v]) => {
      const { viewer } = window.__app; viewer.view(v);
      const q = viewer.camera.position.clone().set(p[0], p[1], p[2]).project(viewer.camera);
      const r = viewer.renderer.domElement.getBoundingClientRect();
      const x = r.left + (q.x + 1) / 2 * r.width, y = r.top + (1 - q.y) / 2 * r.height;
      const h = viewer.pick(x, y);
      return h && Math.hypot(h.point[0] - p[0], h.point[1] - p[1], h.point[2] - p[2]) < 0.6 ? [x, y] : null;
    }, [p, v]);
    if (xy) { await page.mouse.click(xy[0], xy[1]); return v; }
  }
  return null;
}
async function addCtrl(feat, kindLabel, nominal, up, lo) {
  await page.selectOption('#ca-feat', { label: feat });
  await page.selectOption('#ca-kind', { label: kindLabel });
  await page.click('#ca-add');
  const row = page.locator('#ctrl-table tbody tr').last();
  const ins = row.locator('td input');
  if (nominal != null) { await ins.nth(0).fill(String(nominal).replace('.', ',')); await ins.nth(0).press('Enter'); }
  if (up != null) { await page.locator('#ctrl-table tbody tr').last().locator('td input').nth(1).fill(String(up)); await page.locator('#ctrl-table tbody tr').last().locator('td input').nth(1).press('Enter'); }
  if (lo != null) { await page.locator('#ctrl-table tbody tr').last().locator('td input').nth(2).fill(String(lo)); await page.locator('#ctrl-table tbody tr').last().locator('td input').nth(2).press('Enter'); }
}
try {
  await page.goto(URL);
  await page.click('#btn-sample');
  await page.waitForFunction(() => window.__app.state.data, null, { timeout: 120000 });
  console.log('Geladen:', await page.textContent('#stats'));
  await page.click('.tab[data-tab="merkmale"]');
  await page.click('[data-ftype="auto"]');
  const targets = [
    ['Ebene', [5, 55, 20]], ['Zylinder', [20, 26.04, 17]], ['Zylinder', [85, 13, 16]], ['Langloch', [20, 50, 16]],
    ['Zylinder', [55.05, 22, 26]], ['Kegel', [82, 29.2, 22]], ['Kugel', [60, 3.1, 22]],
  ];
  for (const [i, [type, p]] of targets.entries()) {
    const n0 = await S(() => window.__app.state.features.length);
    if (!(await clickWorld(p))) { fail(`Zielpunkt ${p} nicht sichtbar`); continue; }
    await page.waitForFunction(() => window.__app.state.preview, null, { timeout: 60000 });
    const pv = await S(() => { const p = window.__app.state.preview; return { type: p.fit.type, n: p.indices.length, d: p.fit.diameter, rms: p.fit.rms, form: p.fit.form }; });
    const card = await page.textContent('#preview-card');
    const nAfterClick = await S(() => window.__app.state.features.length);
    if (nAfterClick !== n0) fail('Klick hat sofort ein Merkmal erzeugt');
    if (pv.type !== type) fail(`Vorschau: erwartet ${type}, erhalten ${pv.type}`);
    if (!card.includes(`${pv.n} Punkte`) || !card.includes('Erzeugen')) fail('Vorschaukarte unvollständig');
    if (i === 1) {
      // Typ überschreiben -> Kreis, zurück auf Auto; Screenshot der Vorschau
      await page.selectOption('#pc-type', 'Kreis');
      await page.waitForFunction(() => window.__app.state.preview.fit.type === 'Kreis', null, { timeout: 30000 });
      await page.selectOption('#pc-type', 'auto');
      await page.waitForFunction(() => window.__app.state.preview.fit.type === 'Zylinder', null, { timeout: 30000 });
      await page.screenshot({ path: 'docs/desktop-vorschau.png' });
    }
    if (i === 2) { // einmal verwerfen und neu
      await page.click('#pc-discard');
      if (await S(() => window.__app.state.preview)) fail('Verwerfen ohne Wirkung');
      await clickWorld(p); await page.waitForFunction(() => window.__app.state.preview, null, { timeout: 60000 });
    }
    await page.click('#pc-create');
    await page.waitForFunction((n) => window.__app.state.features.length > n, n0, { timeout: 10000 });
    const sel = await S(() => { const s = window.__app.state; const f = s.features.at(-1); return { name: f.name, sel: s.sel[0] === f.id, node: !!document.querySelector(`#tree [data-fid="${f.id}"].sel`), toast: document.querySelector('#toast').textContent }; });
    if (!sel.sel || !sel.node || !sel.toast.includes(sel.name)) fail('Rückmeldung nach Erzeugen fehlt');
    console.log(`${sel.name}: ${pv.n} Punkte, RMS ${pv.rms.toFixed(4)}, Form ${pv.form.toFixed(4)}${pv.d ? ', D ' + pv.d.toFixed(4) : ''}`);
  }
  await page.keyboard.press('Escape');
  const ctrlCount = await S(() => window.__app.state.controls.length);
  if (ctrlCount !== 0) fail('Prüfmerkmale wurden automatisch erzeugt');
  // Abstand per Dropdown
  await page.click('#btn-distance');
  await page.selectOption('#d-a', { label: 'Zylinder 1' });
  await page.selectOption('#d-b', { label: 'Zylinder 3' });
  await page.waitForFunction(() => window.__app.state.preview?.fit.type === 'Abstand');
  await page.click('#pc-create');
  // Abstand per Klick im 3D-Bild: Ebene 1 (Oberseite) -> Kugel 1
  if (!(await clickWorld([30, 5, 20]))) fail('Ebene nicht anklickbar'); await sleep(200);
  if (!(await clickWorld([60, 3.1, 22]))) fail('Kugel nicht anklickbar');
  await page.waitForFunction(() => window.__app.state.preview?.fit.type === 'Abstand', null, { timeout: 10000 });
  const d2 = await S(() => window.__app.state.preview.fit.distance);
  if (Math.abs(d2 - 3) > 0.01) fail('Abstand Ebene–Kugel ≠ 3: ' + d2);
  await page.click('#pc-create');
  await page.keyboard.press('Escape');
  // Prüfmerkmale in der Liste
  await addCtrl('Ebene 1', 'Ebenheit');
  await addCtrl('Zylinder 1', 'Durchmesser', 12, '0,05', '-0,05');
  await addCtrl('Zylinder 1', 'X', 20);
  await addCtrl('Langloch 1', 'Länge', 30);
  await addCtrl('Langloch 1', 'Breite', 10);
  await addCtrl('Zylinder 3', 'Durchmesser', 16);
  await addCtrl('Kegel 1', 'Kegelwinkel', 61.93);
  await addCtrl('Kugel 1', 'Durchmesser', 14);
  await addCtrl('Abstand 1', 'Abstand 3D', 40.1);
  await addCtrl('Abstand 1', 'Abstand X', 35);
  await addCtrl('Abstand 2', 'Abstand Z', 3);
  const tree = await page.textContent('#tree');
  if (/Durchmesser|Ebenheit|Abstand X/.test(tree)) fail('Prüfmerkmale erscheinen im Baum');
  if (!tree.includes('Ist')) fail('Ist-Komponente fehlt im Baum');
  const rows = await S(() => [...document.querySelectorAll('#ctrl-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].slice(0, 8).map((t) => t.querySelector('input')?.value ?? t.textContent).join(' | ')));
  console.log(rows.join('\n'));
  const st = rows.map((r) => r.split(' | ')[7]);
  if (st.filter((s) => s === 'NIO').length !== 1 || st.filter((s) => s === 'IO').length !== rows.length - 1) fail('IO/NIO unerwartet');
  await page.click('#tree [data-fid="8"]');
  await S(() => window.__app.viewer.view('iso')); await sleep(400);
  await page.screenshot({ path: 'docs/desktop-abstand-liste.png' });
  const [dl] = await Promise.all([page.waitForEvent('download'), (async () => { await page.click('.tab[data-tab="start"]'); await page.click('#btn-csv'); })()]);
  await dl.saveAs('docs/beispiel-pruefmerkmale.csv');
  console.log('CSV gespeichert.');
} catch (e) { fail(e.stack || e); }
console.log('Konsolenfehler:', errors.length ? errors : 'keine');
if (errors.length) process.exitCode = 1;
await browser.close(); srv?.kill();
