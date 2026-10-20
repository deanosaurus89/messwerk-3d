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
      return h && document.elementFromPoint(x, y) === viewer.renderer.domElement && Math.hypot(h.point[0] - p[0], h.point[1] - p[1], h.point[2] - p[2]) < 0.6 ? [x, y] : null;
    }, [p, v]);
    if (xy) { await page.mouse.click(xy[0], xy[1]); return v; }
  }
  return null;
}
// Prüfmerkmal über den Katalog (Checkliste) unter der 3D-Ansicht abhaken und Soll/Toleranzen setzen
async function addCtrl(feat, kind, nominal, up, lo) {
  await page.selectOption('#cat-feat', { label: feat });
  const item = () => page.locator(`#catalog .cat-item[data-kind="${kind}"]`);
  await item().locator('input[type=checkbox]').check();
  const set = async (k, v) => { if (v == null) return; const i = item().locator('.cat-ed input').nth(k); await i.fill(String(v).replace('.', ',')); await i.press('Enter'); };
  await set(0, nominal); await set(1, up); await set(2, lo);
}
try {
  await page.goto(URL);
  await page.evaluate(() => document.querySelector('#whatsnew')?.remove()); // 0.40: Dialog fing Klicks ab
  // 0.40: „beispielteil“ ist keine Beispielkarte mehr (neuer Satz) – Datei direkt importieren
  await page.setInputFiles('#file', 'public/samples/beispielteil.stl');
  if (await page.waitForSelector('#unit-dlg', { timeout: 20000 }).then(() => true, () => false)) await page.click('#unit-dlg [data-ok]');
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
    const pv = await S(() => { const p = window.__app.state.preview; return { c: p.fit.center.map((v) => +v.toFixed(3)), len: p.fit.length, type: p.fit.type, n: p.indices.length, d: p.fit.diameter, rms: p.fit.rms, form: p.fit.form }; });
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
    console.log(`${sel.name}: ${pv.n} Punkte, RMS ${pv.rms.toFixed(4)}, Form ${pv.form.toFixed(4)}${pv.d ? ', D ' + pv.d.toFixed(4) : ''} c=${pv.c} L=${pv.len?.toFixed(3)}`);
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
  await addCtrl('Ebene 1', 'Form');
  await addCtrl('Zylinder 1', 'Durchmesser', 12, '0,05', '-0,05');
  await addCtrl('Zylinder 1', 'X', 20);
  await addCtrl('Langloch 1', 'Länge', 30);
  await addCtrl('Langloch 1', 'Breite', 10);
  await addCtrl('Zylinder 3', 'Durchmesser', 16);
  await addCtrl('Kegel 1', 'Kegelwinkel', 61.93);
  await addCtrl('Kugel 1', 'Durchmesser', 14);
  await addCtrl('Abstand 1', 'Abstand 3D', 39.8);
  await addCtrl('Abstand 1', 'Abstand X', 35);
  await addCtrl('Abstand 2', 'Abstand Z', 3);
  const tree = await page.textContent('#tree');
  if (/Durchmesser|Ebenheit|Abstand X/.test(tree)) fail('Prüfmerkmale erscheinen im Baum');
  if (!tree.includes('Ist')) fail('Ist-Komponente fehlt im Baum');
  const rows = await S(() => [...document.querySelectorAll('#ctrl-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].slice(0, 8).map((t) => t.querySelector('input')?.value ?? t.textContent).join(' | ')));
  console.log(rows.join('\n'));
  const st = rows.map((r) => r.split(' | ')[7]);
  if (st.filter((s) => s === 'NIO').length !== 1 || st.filter((s) => s === 'IO').length !== rows.length - 1) fail('IO/NIO unerwartet');
  // ---------- v3: Labels mit gewählten Prüfmerkmalen
  const lab = await S(() => [...document.querySelectorAll('#labels .lbl')].map((e) => ({ id: +e.dataset.fid, txt: e.textContent, rows: e.querySelectorAll('tr').length, nio: e.querySelectorAll('tr.NIO').length })));
  if (lab.length !== await S(() => window.__app.state.features.length)) fail('Nicht für alle Merkmale ein Label');
  const lz1 = lab.find((l) => l.txt.startsWith('Zylinder 1'));
  if (!lz1 || !lz1.txt.includes('Durchmesser') || !lz1.txt.includes('Position X')) fail('Label Zylinder 1 ohne gewählte Prüfmerkmale: ' + lz1?.txt);
  const lk = lab.find((l) => l.txt.startsWith('Zylinder 2')); if (!lk || lk.rows !== 0) fail('Label ohne Prüfmerkmale sollte nur Kopf zeigen');
  if (lab.reduce((s, l) => s + l.nio, 0) !== 1) fail('NIO-Färbung im Label fehlt');
  // Abhaken entfernt das Prüfmerkmal wieder
  await page.selectOption('#cat-feat', { label: 'Zylinder 2' });
  await page.locator('#catalog .cat-item[data-kind="Std.-Abw."] input[type=checkbox]').check();
  if (!(await S(() => window.__app.state.controls.some((c) => c.kind === 'Std.-Abw.')))) fail('Katalog-Haken legt kein Prüfmerkmal an');
  await page.locator('#catalog .cat-item[data-kind="Std.-Abw."] input[type=checkbox]').uncheck();
  if (await S(() => window.__app.state.controls.some((c) => c.kind === 'Std.-Abw.'))) fail('Haken entfernen löscht Prüfmerkmal nicht');
  // Label ziehen: Versatz bleibt bei Kameraänderung erhalten
  await S(() => window.__app.viewer.view('iso')); await sleep(200);
  const box = await page.locator('#labels .lbl[data-fid="2"]').boundingBox();
  await page.mouse.move(box.x + 10, box.y + 6); await page.mouse.down(); await page.mouse.move(box.x - 60, box.y - 40, { steps: 6 }); await page.mouse.up();
  const off = await S(() => window.__app.state.labelOffsets.get(2));
  if (!off) fail('Label-Verschiebung nicht gespeichert');
  await S(() => window.__app.viewer.view('+X')); await sleep(500);
  let chk = await S(() => { const { viewer, state } = window.__app; const f = state.features.find((x) => x.id === 2); const o = state.labelOffsets.get(2);
    const v = viewer.camera.position.clone().set(f.measured.center[0] + o[0], f.measured.center[1] + o[1], f.measured.center[2] + o[2]).project(viewer.camera);
    const r = viewer.el.getBoundingClientRect(), e = document.querySelector('#labels .lbl[data-fid="2"]').getBoundingClientRect();
    return [Math.hypot((v.x + 1) / 2 * r.width + r.left - (e.left + e.width / 2), (1 - v.y) / 2 * r.height + r.top - (e.top + e.height / 2)), (v.x + 1) / 2 * r.width + r.left, (1 - v.y) / 2 * r.height + r.top, e.left, e.top, e.width, e.height, o]; });
  console.log('Label-Check', JSON.stringify(chk)); chk = chk[0];
  if (chk > 2) fail('Gezogenes Label folgt dem 3D-Versatz nicht: ' + chk);
  // ---------- v3: ViewCube (unten links)
  const cube = await page.locator('#navcube').boundingBox();
  const host = await page.locator('#scene').boundingBox();
  if (!(cube.x - host.x < 30 && host.y + host.height - (cube.y + cube.height) < 30)) fail('ViewCube nicht unten links');
  await S(() => window.__app.viewer.view('iso')); await sleep(150);
  const cubeHit = async (dir) => S((d) => { // Bildschirmpunkt einer Würfel-Position (Fläche/Kante/Ecke)
    const { viewer } = window.__app; const c = viewer.cube; c.syncCam(); const r = c.el.getBoundingClientRect();
    const v = c.cam.position.clone().set(d[0] * 0.98, d[1] * 0.98, d[2] * 0.98).project(c.cam);
    return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }, dir);
  const camDir = () => S(() => { const { viewer } = window.__app; const d = viewer.camera.position.clone().sub(viewer.controls.target).normalize(); return [d.x, d.y, d.z]; });
  let pt = await cubeHit([0, 0, 1]); await page.mouse.click(pt[0], pt[1]); await sleep(150);
  let d = await camDir(); if (d[2] < 0.999) fail('ViewCube OBEN -> keine Draufsicht: ' + d);
  const xy = await S(() => { const { viewer } = window.__app; const a = viewer.camera.position.clone().set(0, 0, 20).project(viewer.camera), b = viewer.camera.position.clone().set(10, 0, 20).project(viewer.camera), c = viewer.camera.position.clone().set(0, 10, 20).project(viewer.camera); return [b.x - a.x, c.y - a.y]; });
  if (!(xy[0] > 0 && xy[1] > 0)) fail('Draufsicht nicht XY (X rechts, Y oben)');
  await page.screenshot({ path: 'docs/desktop-viewcube-oben.png' });
  pt = await cubeHit([0.5, -1, 0]); await S(() => window.__app.viewer.viewDir([1, -1, 1])); await sleep(100);
  pt = await cubeHit([1, -1, 1]); await S(() => window.__app.viewer.view('iso')); await sleep(100);
  pt = await cubeHit([1, -1, 1]); await page.mouse.click(pt[0], pt[1]); await sleep(150);
  d = await camDir(); if (Math.abs(d[0] - 0.577) > 0.02 || Math.abs(d[1] + 0.577) > 0.02) fail('ViewCube-Ecke -> keine Zwischenansicht: ' + d);
  pt = await cubeHit([0, -1, 0]); await page.mouse.click(pt[0], pt[1]); await sleep(150);
  d = await camDir(); if (d[1] > -0.999) fail('ViewCube VORNE: ' + d);
  pt = await cubeHit([1, -1, 0]); await page.mouse.click(pt[0], pt[1]); await sleep(150);
  d = await camDir(); if (Math.abs(d[2]) > 0.02 || Math.abs(d[0] - 0.707) > 0.02) fail('ViewCube-Kante: ' + d);
  // ---------- v3: Augen-Symbol
  await page.click('#tree [data-fid="7"] .eye');
  const hid = await S(() => ({ h: window.__app.state.hidden.has(7), lbl: !!document.querySelector('#labels .lbl[data-fid="7"]') }));
  if (!hid.h || hid.lbl) fail('Ausblenden (Auge) ohne Wirkung');
  await page.click('#tree .model-node .eye');
  if (await S(() => window.__app.viewer.model.visible)) fail('Polygonmodell nicht ausgeblendet');
  await page.screenshot({ path: 'docs/desktop-augen-ausgeblendet.png' });
  await page.click('#tree .model-node .eye'); await page.click('#tree [data-fid="7"] .eye');
  await S(() => window.__app.viewer.view('iso')); await sleep(300);
  await page.click('#tree [data-fid="2"]');
  await page.screenshot({ path: 'docs/desktop-labels-katalog.png' });
  // ---------- v3: Hilfsebene (Kreis in Projektionsebene)
  await page.click('.tab[data-tab="merkmale"]');
  await page.click('[data-ftype="Kreis"]');
  if (!(await clickWorld([27.2, 20, 20], ['+Z', 'iso', '-Y', '+X']))) fail('Oberseite neben Bohrung nicht anklickbar');
  await page.waitForFunction(() => window.__app.state.preview?.aux, null, { timeout: 60000 }).catch(async (e) => { throw new Error(e.message + ' Status: ' + await page.textContent('#status')); });
  const aux = await S(() => { const p = window.__app.state.preview; return { d: p.fit.diameter, z: p.fit.center[2], nw: p.indices.length, np: p.aux.indices.length, card: document.querySelector('#preview-card').textContent }; });
  console.log('Hilfsebene-Vorschau:', JSON.stringify({ ...aux, card: undefined }));
  if (Math.abs(aux.d - 12.08) > 0.02 || Math.abs(aux.z - 20) > 0.01 || aux.np < 100 || !aux.card.includes('Hilfsebene')) fail('Hilfsebene-Vorschau falsch');
  if (await S(() => window.__app.state.features.length) !== 9) fail('Vorschau hat Merkmal erzeugt');
  await S(() => { const { viewer } = window.__app; viewer.viewDir([0.5, -1, 1.1]); viewer.controls.target.set(22, 22, 17); viewer.camera.position.set(22 + 0.5 * 30, 22 - 30, 17 + 1.1 * 30); viewer.controls.update(); }); await sleep(300);
  await page.screenshot({ path: 'docs/desktop-hilfsebene-vorschau.png' });
  await page.click('#pc-create');
  const kf = await S(() => window.__app.state.features.at(-1));
  if (kf.type !== 'Kreis' || !kf.aux) fail('Kreis mit Hilfsebene nicht erzeugt');
  if (!(await page.textContent('#tree')).includes('Hilfsebene')) fail('Hilfsebene fehlt im Baum');
  // nur Wand anklicken + vorhandene Ebene (Ebene 1 = Oberseite) als Hilfsebene
  await page.selectOption('#d-aux', { label: 'Vorhandene Ebene: Ebene 1' });
  await S(() => document.getElementById('btn-toggle-labels').click()); // Labels ausblenden (Ansicht > Labels)
  if (!(await clickWorld([85, 13, 16]))) fail('Bohrungswand nicht anklickbar');
  await page.waitForFunction(() => window.__app.state.preview?.aux, null, { timeout: 60000 });
  const aux2 = await S(() => { const p = window.__app.state.preview; return { d: p.fit.diameter, z: p.fit.center[2], src: p.aux.source }; });
  if (Math.abs(aux2.d - 6) > 0.02 || Math.abs(aux2.z - 20) > 0.01 || aux2.src !== 'Ebene 1') fail('Hilfsebene aus vorhandener Ebene falsch: ' + JSON.stringify(aux2));
  await page.click('#pc-create');
  await S(() => document.getElementById('btn-toggle-labels').click());
  await page.keyboard.press('Escape');
  // ---------- v3: Tabelle erzeugen
  await page.click('.tab[data-tab="pruef"]');
  await page.click('#btn-report2');
  await page.waitForSelector('#report-view:not(.hidden)');
  const rep = await page.textContent('#report-view');
  if (!rep.includes('Tabelle 1') || !rep.includes('Rundheit') || !rep.includes('NIO')) fail('Bericht unvollständig');
  if (!(await page.textContent('#tree')).includes('Tabelle 1')) fail('Bericht fehlt im Baum');
  await page.screenshot({ path: 'docs/desktop-bericht.png' });
  const [dlr] = await Promise.all([page.waitForEvent('download'), page.click('#rv-csv')]);
  await dlr.saveAs('docs/beispiel-bericht.csv');
  const [dlh] = await Promise.all([page.waitForEvent('download'), page.click('#rv-html')]);
  await dlh.saveAs('docs/beispiel-bericht.html');
  await page.click('#rv-close');
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
