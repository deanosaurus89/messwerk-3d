// Beispielteil-Auswahl + scan-ähnliche Demoteile: Dialog, Laden, automatische Extraktion per Klick gegen Soll (samples/*.json), Netz-Nahaufnahmen.
// Aufruf: node e2e/samples-check.mjs [URL|-] [desktop|iphone]
import { chromium, webkit, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
let URL = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null;
const MODE = process.argv[3] || 'desktop';
if (!URL) { URL = 'http://localhost:8765/'; srv = spawn('npx', ['serve', '-l', '8765', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const browser = MODE === 'desktop' ? await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }) : await webkit.launch();
const ctx = await browser.newContext(MODE === 'desktop' ? { viewport: { width: 1600, height: 950 } } : { ...devices['iPhone 14 Pro'] });
const page = await ctx.newPage(); const touch = MODE !== 'desktop';
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
const S = (fn, a) => page.evaluate(fn, a);
const P = MODE === 'desktop' ? 'desktop' : 'iphone';
async function clickWorld(p, views) {
  for (const v of views) {
    await S(([v, p]) => { const { viewer } = window.__app; if (typeof v === 'string') viewer.view(v); else if (v.focus) { viewer.viewDir(v.focus); viewer.focus(p, 12); } else { viewer.viewDir(v); viewer.view('fit'); viewer.viewDir(v); } }, [v, p]);
    await sleep(400); // Layout/Kamera setzen lassen (Telefon: Panels ändern die Canvasgröße)
    const xy = await S(([p, v]) => {
      const { viewer } = window.__app; void v;
      const q = viewer.camera.position.clone().set(p[0], p[1], p[2]).project(viewer.camera);
      const r = viewer.renderer.domElement.getBoundingClientRect(); const x = Math.floor(r.left + (q.x + 1) / 2 * r.width), y = Math.floor(r.top + (1 - q.y) / 2 * r.height); // Touch-Tipp landet auf ganzen Pixeln
      const h = viewer.pick(x, y);
      return h && document.elementFromPoint(x, y) === viewer.renderer.domElement && Math.hypot(h.point[0] - p[0], h.point[1] - p[1], h.point[2] - p[2]) < 0.6 ? [x, y] : null;
    }, [p, v]);
    if (xy) {
      touch ? await page.touchscreen.tap(xy[0], xy[1]) : await page.mouse.click(xy[0], xy[1]);
      if (await page.waitForFunction(() => window.__app.state.preview, null, { timeout: 25000 }).then(() => true, () => false)) {
        const h = await S(() => { const pv = window.__app.state.preview; return pv.hit?.point ?? pv.hit; });
        if (!Array.isArray(h) || Math.hypot(h[0] - p[0], h[1] - p[1], h[2] - p[2]) < 1.0) return true;
        console.log('    (Tipp traf', h.map((v) => v.toFixed(2)).join(','), 'statt Prüfpunkt – nächste Ansicht)');
        await page.click('#cp-cancel').catch(() => {});
      }
      console.log('    (keine Vorschau nach Klick – nächste Ansicht; Status:', await page.textContent('#status'), ')');
    }
  }
  return false;
}
const VIEWS = ['iso', '+Z', '-Y', '+X', '-X', '+Y', [1, -1, 0.3], [-1, -1, 0.3], [0, -1, 0.15], [1, 1, 0.5], ...[[0, 0, 1], [1, 0.2, 1.2], [-1, 0.2, 1.2], [0.2, 1, 1.2], [0.2, -1, 1.2], [1, -1, 0.3]].map((d) => ({ focus: d }))];
const ACCEPT = { Zylinder: ['Zylinder', 'Kreis'], Langloch: ['Langloch'], Ebene: ['Ebene'], Kugel: ['Kugel'], Kegel: ['Kegel'], Torus: ['Torus'] };
const close = { pruefplatte: [[85.2, 45, 14], [1, -1.6, 1.1], 3.2], flansch: [[0, -22.5, 38], [0.3, -1, 0.3], 3.5], freiform: [[70, 30, 20.2], [0.4, -1, 0.9], 3.5] };
try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await S(() => document.querySelector('#whatsnew')?.remove()); // 0.40: „Neu in dieser Version“ fing die Klicks ab
  await page.click('#btn-sample');
  await page.waitForSelector('.sample-card');
  await page.waitForFunction(() => [...document.querySelectorAll('.sample-card img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 20000 }).catch(() => fail('Vorschaubilder nicht geladen'));
  const cards = await S(() => [...document.querySelectorAll('.sample-card')].map((c) => c.dataset.key));
  console.log('Karten:', cards.join(', '));
  // 0.40: Kartensatz aus public/samples/index.json (statt fest 4 / pruefplatte, freiform)
  const IDX = JSON.parse(fs.readFileSync('public/samples/index.json', 'utf8')).filter((x) => !x.hidden).map((x) => x.key);
  if (cards.length !== IDX.length || IDX.some((k) => !cards.includes(k))) fail(`erwartet Beispielteile ${IDX.join(', ')}`);
  await page.screenshot({ path: `docs/${P}-beispiel-auswahl.png` });
  await page.click('#sd-close');
  // Teile ohne Soll-JSON: nur Laden prüfen (Mesh vorhanden); Teile mit Soll-JSON: zusätzlich Auto-Extraktion gegen Soll
  for (const key of IDX.filter((k) => !fs.existsSync(`public/samples/${k}.json`) && k !== 'cadsample')) {
    await page.click('.tab[data-tab="start"]').catch(() => {}); const t0 = Date.now();
    await page.click('#btn-sample'); await page.click(`.sample-card[data-key="${key}"]`);
    const loaded = await page.waitForFunction((k) => window.__app.state.data?.name === k && window.__app.state.data.vertexCount > 1000, key, { timeout: 180000 }).then(() => true, () => false);
    if (!loaded) fail(`${key}: nicht geladen`); else console.log(`${key}: geladen in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  for (const key of IDX.filter((k) => fs.existsSync(`public/samples/${k}.json`))) {
    const nom = JSON.parse(fs.readFileSync(`public/samples/${key}.json`, 'utf8'));
    await page.click('.tab[data-tab="start"]').catch(() => {});
    const t0 = Date.now();
    await page.click('#btn-sample'); await page.click(`.sample-card[data-key="${key}"]`);
    await page.waitForFunction((k) => window.__app.state.data?.name === k, key, { timeout: 180000 });
    const st = await page.textContent('#stats');
    console.log(`${nom.name}: geladen in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${st}`);
    await page.click('.tab[data-tab="merkmale"]'); await page.click('[data-ftype="auto"]');
    let ok = 0, tried = 0;
    for (const f of nom.features.filter((x) => x.probe && x.type !== 'Freiform')) {
      tried++;
      if (!(await clickWorld(f.probe, VIEWS))) { console.log(`  ${f.id}: Prüfpunkt nicht sichtbar – übersprungen`); tried--; continue; }
      await page.waitForFunction(() => window.__app.state.preview, null, { timeout: 60000 });
      const m = await S(() => window.__app.state.preview.fit); const hit = await S(() => window.__app.state.preview.hit?.point ?? window.__app.state.preview.hit);
      let err = '';
      if (!ACCEPT[f.type].includes(m.type)) err = `Typ ${m.type}`;
      else if (f.diameter && Math.abs(m.diameter - f.diameter) > 0.03) err = `D ${m.diameter}`;
      else if (f.type === 'Langloch' && (Math.abs(m.length - f.length) > 0.05 || Math.abs(m.width - f.width) > 0.03)) err = `L/B ${m.length}/${m.width}`;
      else if (f.type === 'Kegel' && Math.abs(2 * m.halfAngle * 180 / Math.PI - f.includedAngleDeg) > 0.5) err = 'Winkel';
      else if (f.type === 'Torus' && (Math.abs(m.radius - f.majorRadius) > 0.1 || Math.abs(Math.abs(m.minorRadius) - f.minorRadius) > 0.05)) err = 'Torus R/r';
      else if (f.type === 'Ebene' && Math.abs((m.center[0] - f.point[0]) * f.normal[0] + (m.center[1] - f.point[1]) * f.normal[1] + (m.center[2] - f.point[2]) * f.normal[2]) > 0.01) err = 'Ebenenlage';
      console.log(`  ${f.id}: ${m.type}${m.diameter ? ' Ø' + m.diameter.toFixed(4) : ''}${m.type === 'Langloch' ? ` ${m.length.toFixed(3)}×${m.width.toFixed(3)}` : ''}${m.type === 'Torus' ? ` R${m.radius.toFixed(3)} r${Math.abs(m.minorRadius).toFixed(3)}` : ''}${m.type === 'Kegel' ? ` ${(2 * m.halfAngle * 180 / Math.PI).toFixed(3)}°` : ''} Form ${m.form.toFixed(4)}${err ? ' Treffer ' + JSON.stringify(hit) : ''} ${err ? '✗ ' + err : '✓'}`);
      if (err) fail(`${key} ${f.id}: ${err}`); else ok++;
      await page.click('#cp-ok');
    }
    if (ok < Math.min(3, tried)) fail(`${key}: nur ${ok} Merkmale korrekt geprüft`);
    console.log(`  → ${ok}/${tried} korrekt`);
    await S(() => { const { viewer } = window.__app; viewer.viewDir([1, -1.3, 1.1]); viewer.view('fit'); viewer.viewDir([1, -1.3, 1.1]); }); await sleep(500);
    await page.screenshot({ path: `docs/${P}-scan-${key}.png` });
    const c = close[key]; if (!c) { await page.keyboard.press('Escape').catch(() => {}); continue; }
    await S(([t, d, r]) => { const { viewer, state } = window.__app; state.showLabels = false; state.showPrims = false; state.colorPts = false; state.sel = []; window.__app.renderAll(); viewer.viewDir(d); viewer.focus(t, r); viewer.setWireframe(true); }, c);
    await sleep(600); await page.screenshot({ path: `docs/${P}-scan-${key}-netz.png` });
    await S(() => { const { viewer, state } = window.__app; viewer.setWireframe(false); state.showLabels = true; state.showPrims = true; state.colorPts = true; window.__app.renderAll(); });
    await page.keyboard.press('Escape').catch(() => {});
  }
} catch (e) { fail(e.stack || e); await page.screenshot({ path: '/tmp/samples-fail.png' }).catch(() => {}); }
console.log('Konsolenfehler:', errors.length ? errors : 'keine'); if (errors.length) process.exitCode = 1;
await browser.close(); srv?.kill();
