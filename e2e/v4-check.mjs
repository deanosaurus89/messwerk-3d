// v4-Prüfung: Trainingsmodus, Bezüge (Umbenennen/Entfernen), Position A|B|C, Zentrieren, Torus, Auto-Hilfsebene, Speichern/Laden, Autosave.
// Aufruf: node e2e/v4-check.mjs [URL] [desktop|iphone|ipad]
import { chromium, webkit, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';

let URL = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null;
const MODE = process.argv[3] || 'desktop';
if (!URL) { URL = 'http://localhost:8765/'; srv = spawn('npx', ['serve', '-l', '8765', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const P = MODE === 'desktop' ? 'desktop' : MODE;
const browser = MODE === 'desktop'
  ? await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  : await webkit.launch();
const ctx = await browser.newContext(MODE === 'desktop' ? { viewport: { width: 1600, height: 950 }, acceptDownloads: true }
  : { ...devices[{ iphone: 'iPhone 14 Pro', 'iphone-quer': 'iPhone 14 Pro landscape', ipad: 'iPad Pro 11 landscape' }[MODE]], acceptDownloads: true });
const page = await ctx.newPage();
const touch = MODE !== 'desktop';
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
const S = (fn, arg) => page.evaluate(fn, arg);
const tapXY = async (x, y) => (touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
const shot = (n) => page.screenshot({ path: `${process.env.SHOT_DIR || 'docs'}/${P}-${n}.png` });
const panel = (n, on) => S(([n, on]) => window.__app.togglePanel?.(n, on), [n, on]);
async function worldXY(p, views) {
  for (const v of views) {
    const xy = await S(([p, v]) => {
      const { viewer } = window.__app; if (v) viewer.view(v);
      const q = viewer.camera.position.clone().set(p[0], p[1], p[2]).project(viewer.camera);
      const r = viewer.renderer.domElement.getBoundingClientRect();
      const x = r.left + (q.x + 1) / 2 * r.width, y = r.top + (1 - q.y) / 2 * r.height;
      const h = viewer.pick(x, y);
      return h && document.elementFromPoint(x, y) === viewer.renderer.domElement && Math.hypot(h.point[0] - p[0], h.point[1] - p[1], h.point[2] - p[2]) < 0.6 ? [x, y] : null;
    }, [p, v]);
    if (xy) return xy;
  }
  return null;
}
const clickWorld = async (p, views = ['iso', '-Y', '+X', '+Z', '-X', '+Y']) => { const xy = await worldXY(p, views); if (xy) await tapXY(...xy); return !!xy; };
const tourInfo = () => S(() => { const t = window.__app.tour; const c = document.querySelector('#tour-card'); if (!t || !c) return null;
  const m = document.querySelector('#tour-marker'); const mr = m && m.style.display === 'block' ? m.getBoundingClientRect() : null;
  return { idx: t.idx, n: t.steps.length, title: c.querySelector('.tc-title').textContent, ok: !!c.querySelector('.tc-state.ok'), marker: mr ? [mr.left + mr.width / 2, mr.top + mr.height / 2] : null }; });

try {
  await page.goto(URL.includes('nodemo') ? URL : URL + (URL.includes('?') ? '&' : '?') + 'nodemo', { waitUntil: 'networkidle' });
  await S(() => indexedDB.deleteDatabase('messwerk3d'));
  // ---------------- Trainingsmodus (Hilfe › Trainingsmodus: Bezüge)
  if (touch) await page.locator('.tab[data-tab="hilfe"]').tap(); else await page.click('.tab[data-tab="hilfe"]');
  await page.click('#btn-training');
  let guard = 0, shotDone = false, lastIdx = -1, sameCount = 0;
  while (guard++ < 200) {
    const t = await tourInfo(); if (!t) break;
    if (t.idx === lastIdx) sameCount++; else { sameCount = 0; lastIdx = t.idx; console.log(`  Schritt ${t.idx + 1}/${t.n}: ${t.title}`); await sleep(400); continue; }
    if (sameCount > 60) { await shot('training-haengt'); console.log(JSON.stringify(t)); fail('Training hängt bei: ' + t.title + ' / Status: ' + await page.textContent('#status')); break; }
    if (t.ok || /Training:|Done!/.test(t.title)) {
      if (t.idx === t.n - 1) { await shot('training-fertig'); await page.click('#tc-next'); break; }
      if (await page.locator('#tc-next').isEnabled()) await page.click('#tc-next').catch(() => {});
      await sleep(300); continue;
    }
    if (sameCount !== 1 && !(/Create|Assign datum|Tap the/.test(t.title) && sameCount % 8 === 0)) { await sleep(500); continue; } // Aktion einmal pro Schritt; Erzeugen, Bezug und Taps wiederholen (Marker kann nach dem Layout nachziehen)
    console.log('    Aktion', t.marker ? 'Marker ' + t.marker.map(Math.round) : '');
    if (t.marker) {
      if (!shotDone && /hole/.test(t.title)) { await shot('training-schritt'); shotDone = true; }
      await tapXY(t.marker[0], t.marker[1]);
    } else if (/Assign datum [ABC]/.test(t.title)) await page.click('#dt-apply');
    else if (/Normal direction/.test(t.title)) await page.locator('#fp-nf').check();
    else if (/Position tolerance/.test(t.title)) {
      await page.locator('#catalog .cat-item[data-kind="Position"] input[type=checkbox]').check();
      for (const letter of ['A', 'B', 'C']) {
        const sel = page.locator('#catalog .cat-item[data-kind="Position"] select.dslot').last();
        await sel.waitFor({ state: 'visible', timeout: 10000 });
        const val = await sel.evaluate((el, letter) => [...el.options].find((o) => o.textContent.trim().startsWith(letter + ' '))?.value ?? '', letter);
        if (!val) fail('Datum slot ohne ' + letter);
        await sel.selectOption(val);
        await sleep(200);
      }
    }
    else if (/Basic dimensions/.test(t.title)) {
      // TED stays empty until the drawing values are entered (suggestions are unconfirmed).
      for (const k of ['0', '1']) {
        const inp = page.locator(`#catalog .cat-item[data-kind="Position"] input.ted[data-ted="${k}"]`);
        await inp.fill('20');
        await inp.evaluate((el) => el.dispatchEvent(new Event('change', { bubbles: true })));
        await sleep(200);
      }
      for (let i = 0; i < 6; i++) {
        const ok = page.locator('#catalog .cat-item[data-kind="Position"] button.ted-ok:not([data-cf="0"]):not([data-cf="1"])').first();
        if (!(await ok.count())) break;
        await ok.click();
        await sleep(200);
      }
    }
    else if (t.title === 'Create') { await page.waitForFunction(() => window.__app.state.preview, null, { timeout: 60000 }); await page.click('#cp-ok'); }
    else if (/Load sample/.test(t.title)) { await page.click('#btn-sample'); await page.waitForFunction(() => window.__app.state.data, null, { timeout: 120000 }); }
    else if (/Start ribbon/.test(t.title)) await page.click('.tab[data-tab="merkmale"]');
    else if (/Feature type Plane/.test(t.title)) await page.click('[data-ftype="Ebene"]');
    else if (/Feature type Cylinder/.test(t.title)) await page.click('[data-ftype="Zylinder"]');
    await sleep(500);
  }
  const tr = await S(() => { const { state } = window.__app; const fm = new Map(state.features.map((f) => [f.id, f]));
    return { tour: !!window.__app.tour, feats: state.features.map((f) => `${f.name}${f.datum ? '[' + f.datum + ']' : ''}`), pos: state.controls.filter((c) => c.kind === 'Position').map((c) => ({ d: c.datumIds.map((i) => fm.get(i).datum).join('|'), b: c.basic })) }; });
  console.log('Nach Training:', JSON.stringify(tr));
  if (tr.tour || tr.pos.length !== 1 || tr.pos[0].d !== 'A|B|C') fail('Training nicht vollständig durchlaufen');
  // Bezugsfahnen im Baum + Label
  const flags = await S(() => ({ tree: [...document.querySelectorAll('#tree .dflag')].map((e) => e.textContent), lbl: [...document.querySelectorAll('#labels .dflag')].map((e) => e.textContent), lblTxt: [...document.querySelectorAll('#labels .lbl')].map((e) => e.textContent).join(' ') }));
  if (flags.tree.sort().join() !== 'A,B,C') fail('Bezugsfahnen im Baum: ' + flags.tree);
  if (!flags.lbl.includes('A') || !/A\|B\|C|A \| B \| C/.test(flags.lblTxt)) fail('Bezug/Position im 3D-Label fehlt');
  const posRes = await S(() => { const a = window.__app; const c = a.state.controls.find((k) => k.kind === 'Position'); return document.querySelector('#catalog .cat-item[data-kind="Position"]')?.textContent; });
  console.log('Position im Katalog:', posRes?.replace(/\s+/g, ' '));
  const cyl = await S(() => window.__app.state.features.find((f) => f.type === 'Zylinder').id);
  await S((id) => { const { state, viewer } = window.__app; state.sel = [id]; window.__app.renderAll(); viewer.view('iso'); }, cyl);
  if (touch) await panel('table', true);
  await sleep(400); await shot('bezuege-position');
  // ---------------- Bezüge umbenennen (tauschen) und entfernen
  const posText = () => S(() => { const { state } = window.__app; const fm = new Map(state.features.map((f) => [f.id, f])); const c = state.controls.find((k) => k.kind === 'Position');
    const r = window.__app.evaluate(c, fm, window.__app.ctx?.() ?? {}); return { d: c.datumIds.map((i) => fm.get(i)?.datum ?? '-').join('|'), flag: r.flag ?? '', val: r.measured }; });
  const selDatum = (L) => S((L) => { const { state } = window.__app; const f = state.features.find((g) => g.datum === L); state.sel = [f.id]; window.__app.renderAll(); }, L);
  if (touch) await panel('dialog', true);
  await selDatum('A'); await page.selectOption('#dt-letter', 'B'); await page.click('#dt-apply');
  let pt = await posText(); console.log('Nach Tausch A↔B:', JSON.stringify(pt));
  if (pt.d !== 'B|A|C' || pt.flag) fail('Umbenennen/Tauschen falsch');
  await selDatum('B'); await page.selectOption('#dt-letter', 'A'); await page.click('#dt-apply');
  pt = await posText(); if (pt.d !== 'A|B|C') fail('Rücktausch falsch: ' + pt.d);
  await selDatum('C'); await page.click('#dt-remove');
  pt = await posText(); console.log('Nach Entfernen C:', JSON.stringify(pt));
  if (!/Bezug/.test(pt.flag)) fail('Entfernter Bezug wird nicht markiert');
  if (!(await S(() => document.querySelector('#ctrl-list, #catalog')?.textContent.includes('⚠')))) console.log('  (Hinweis: ⚠ nicht in sichtbarer Liste)');
  await page.selectOption('#dt-letter', 'C'); await page.click('#dt-apply');
  pt = await posText(); if (pt.flag || pt.d !== 'A|B|C') fail('Wieder zuweisen hebt Markierung nicht auf: ' + JSON.stringify(pt));
  // ---------------- Zentrieren (⚙ › Center, Doppelklick im Baum, Kontextmenü). The old floating #btn-center is hidden; the gear is the control.
  if (touch) await panel('dialog', false);
  await S((id) => { const { state, viewer } = window.__app; state.sel = [id]; window.__app.renderAll(); viewer.view('iso'); }, cyl);
  const gear = await page.locator('#view-gear .vg-btn').boundingBox();
  if (!gear || !(await S(() => { const b = document.querySelector('#view-gear .vg-btn'), r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return b.contains(e) || e === b; }))) fail('View-Zahnrad verdeckt');
  await page.click('#view-gear .vg-btn');
  await page.click('#view-gear [data-vg="center"]'); await sleep(500);
  const tgt = await S(() => { const t = window.__app.viewer.controls.target; return [t.x, t.y, t.z]; });
  if (Math.hypot(tgt[0] - 20, tgt[1] - 20, tgt[2] - 10) > 0.5) fail('Zentrieren: Ziel ' + tgt);
  await shot('zentrieren');
  if (!touch) {
    // Double-click opens the feature dialog. Centering from the tree is the context menu (⚙ › Center is checked above).
    await S(() => window.__app.viewer.view('fit'));
    await page.click(`#tree [data-fid="${cyl}"]`, { button: 'right' });
    const menu = page.locator('#ctx-menu');
    if (!(await menu.textContent())?.includes('Center')) fail('Kontextmenü ohne Zentrieren');
    await menu.locator('button', { hasText: 'Center' }).click();
    await sleep(400);
    const t2 = await S(() => { const t = window.__app.viewer.controls.target; return [t.x, t.y, t.z]; });
    if (Math.hypot(t2[0] - 20, t2[1] - 20, t2[2] - 10) > 0.5) fail('Kontextmenü Zentrieren: Ziel ' + t2);
    await page.dblclick(`#tree [data-fid="${cyl}"]`);
    await sleep(300);
    if (!(await S(() => document.body.classList.contains('show-dialog')))) fail('Doppelklick öffnet nicht den Merkmal-Dialog');
    await S(() => window.__app.togglePanel('dialog', false));
  }
  // ---------------- Torus
  if (touch) await panel('table', false);
  await page.click('.tab[data-tab="merkmale"]');
  await page.click('#btn-feat-more'); await page.click('[data-ftype="Torus"]');
  if (!(await clickWorld([40, 16, 22.8], ['iso', '-Y', '+Z', '+Y']))) fail('Torus nicht anklickbar');
  await page.waitForFunction(() => window.__app.state.preview?.fit.type === 'Torus', null, { timeout: 60000 });
  const to = await S(() => { const f = window.__app.state.preview.fit; return { R: f.radius, r: f.minorRadius, c: f.center }; });
  console.log('Torus-Vorschau:', JSON.stringify(to));
  if (Math.abs(to.R - 6) > 0.05 || Math.abs(Math.abs(to.r) - 2) > 0.05) fail('Torus-Fit falsch');
  await S(() => { const { viewer } = window.__app; viewer.focus([40, 10, 20.8], 10); }); await sleep(300);
  await shot('torus-vorschau');
  await page.click('#cp-ok');
  // ---------------- Automatisch: Hilfsebene am Bohrungsrand, nur Ebene auf freier Fläche
  await page.click('[data-ftype="auto"]');
  if (!(await clickWorld([27.2, 20, 20], ['+Z', 'iso']))) fail('Rand neben Bohrung nicht anklickbar');
  await page.waitForFunction(() => window.__app.state.preview?.aux, null, { timeout: 60000 }).catch(() => fail('Auto: keine Hilfsebene'));
  const au = await S(() => { const p = window.__app.state.preview; return { t: p.fit.type, d: p.fit.diameter, n: p.indices.length, na: p.aux?.indices.length, aux: !!p.aux }; });
  console.log('Auto-Hilfsebene:', JSON.stringify(au));
  if (au.t !== 'Kreis' || Math.abs(au.d - 12.08) > 0.05 || !au.aux) fail('Auto-Hilfsebene falsch');
  await S(() => window.__app.viewer.focus([20, 20, 18], 14)); await sleep(300);
  await shot('auto-hilfsebene');
  await page.click('#cp-cancel');
  if (!(await clickWorld([70, 50, 20], ['+Z', 'iso']))) fail('Freie Fläche nicht anklickbar');
  await page.waitForFunction(() => window.__app.state.preview, null, { timeout: 60000 });
  const ap = await S(() => ({ t: window.__app.state.preview.fit.type, aux: !!window.__app.state.preview.aux }));
  if (ap.t !== 'Ebene' || ap.aux) fail('Auto auf freier Fläche: ' + JSON.stringify(ap));
  await page.click('#cp-cancel'); await page.keyboard.press('Escape');
  // ---------------- Speichern / Laden (Rundlauf) + Autosave
  const snap = () => S(() => { const { state, viewer } = window.__app; const c = viewer.getCamera();
    return JSON.stringify({ f: state.features.map((f) => [f.name, f.type, f.datum ?? '', f.indices.length, f.auxIndices?.length ?? 0, +f.measured.center[0].toFixed(4)]), c: state.controls.map((c) => [c.kind, c.datumIds ?? [], c.basic ?? [], c.tolUp]),
      h: [...state.hidden], lo: [...state.labelOffsets.entries()], r: state.reports.length, cam: c.position.map((v) => +v.toFixed(3)) }); });
  await S(() => window.__app.state.labelOffsets.set(1, [3, 4, 5]));
  await S(() => { const s = window.__app.state; s.hidden.add(s.features.find((f) => f.type === 'Torus').id); window.__app.renderAll(); });
  await page.click('.tab[data-tab="start"]');
  const before = await snap();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-save')]);
  const file = `/tmp/${P}-projekt.mw3d`; await dl.saveAs(file);
  console.log('Gespeichert:', dl.suggestedFilename(), (fs.statSync(file).size / 1048576).toFixed(2), 'MB');
  if (!dl.suggestedFilename().endsWith('.mw3d')) fail('Dateiname ohne .mw3d');
  await sleep(2500); // Autosave
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#restore-bar:not(.hidden)', { timeout: 10000 }).catch(() => fail('Wiederherstellen-Leiste fehlt'));
  await shot('autosave-wiederherstellen');
  await page.setInputFiles('#file-project', file);
  await page.waitForFunction(() => window.__app.state.features.length > 0, null, { timeout: 60000 });
  await sleep(300);
  const after = await snap();
  if (after !== before) { fail('Rundlauf Speichern/Laden ungleich'); console.log(before, '\n', after); }
  else console.log('Rundlauf .mw3d: identisch (' + before.length + ' Zeichen Zustand)');
  await shot('projekt-geladen');
  await sleep(2500);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#restore-bar:not(.hidden)');
  await page.click('#rb-restore');
  await page.waitForFunction(() => window.__app.state.features.length > 0, null, { timeout: 60000 }); await sleep(300);
  const noCam = (j) => JSON.stringify({ ...JSON.parse(j), cam: 0 });
  const idb = await snap();
  if (idb !== before) console.log('  Kamera Autosave:', JSON.parse(idb).cam, 'gespeichert:', JSON.parse(before).cam);
  if (noCam(idb) !== noCam(before)) { fail('Autosave-Wiederherstellung ungleich'); console.log(idb); } else console.log('Autosave/IndexedDB: identisch');
} catch (e) { fail(e.stack || e); await shot('fehler').catch(() => {}); }
console.log('Konsolenfehler:', errors.length ? errors : 'keine');
if (errors.length) process.exitCode = 1;
await browser.close(); srv?.kill();
