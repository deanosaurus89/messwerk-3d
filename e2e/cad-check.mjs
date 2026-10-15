// Nützliche Funktionen – CAD beschneiden: Import STEP/IGES, Auswahl, Rand-Offset, Insel, Schnittlinie, Rückgängig, Export + Prüfung.
// Aufruf: node e2e/cad-check.mjs [URL|-] [desktop|iphone]
import { chromium, webkit, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
let URL = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null; const PH = process.argv[3] === 'iphone'; const SUF = PH ? '-iphone' : '';
if (!URL) { URL = 'http://localhost:8770/'; srv = spawn('npx', ['serve', '-l', '8770', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const b = PH ? await webkit.launch() : await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext(PH ? { ...devices['iPhone 14 Pro'], acceptDownloads: true } : { viewport: { width: 1500, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const S = (f, a) => page.evaluate(f, a); const ok = (c, m) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); if (!c) process.exitCode = 1; };
const idle = () => page.waitForFunction(() => !window.__app.cad.busy, null, { timeout: 300000 });
const camd = () => S(() => { const v = window.__app.viewer; return v.camera.position.toArray().map((x) => +x.toFixed(2)).join(','); });
const tap = async (x, y) => { if (process.env.DBG) console.log('cam', await camd()); if (PH) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); await sleep(350); };
const panel = async (on) => { if (PH) { await S((on) => window.__app.togglePanel('dialog', on), on); await sleep(on ? 300 : 700); } };
await page.goto(URL, { waitUntil: 'networkidle' });
await page.click('.tab[data-tab="nuetz"]');
// sichtbarer Punkt auf einer Fläche (größtes Dreieck, vom Picking bestätigt), Rückgabe Bildschirmkoordinaten
const spot = (pred) => S((pred) => { const a = window.__app, v = a.viewer, r = v.renderer.domElement.getBoundingClientRect(); const fs = [...a.cad.faces].filter((f) => f.visible && (pred === 'any' || f.type === pred)).sort((x, y) => y.area - x.area);
  for (const f of fs.slice(0, 40)) { const t = f.res ? f.res.tess : f.tess; const P = t.positions, I = t.indices; const cand = [];
    for (let i = 0; i < I.length; i += 3) { const c = [0, 1, 2].map((j) => (P[3 * I[i] + j] + P[3 * I[i + 1] + j] + P[3 * I[i + 2] + j]) / 3); cand.push(c); }
    for (let k = 0; k < cand.length; k += Math.max(1, Math.floor(cand.length / 60))) { const q = new (v.camera.position.constructor)(...cand[k]).project(v.camera); const x = r.left + (q.x + 1) / 2 * r.width, y = r.top + (1 - q.y) / 2 * r.height;
      if (x < r.left + 80 || x > r.right - 80 || y < r.top + 80 || y > r.bottom - 80) continue; if (document.elementFromPoint(x, y) !== v.renderer.domElement) continue;
      // Umgebung ±40 px muss dieselbe Fläche treffen (für Insel/Schnitt)
      const same = [[0, 0], [40, 0], [-40, 0], [0, 40], [0, -40]].every(([dx, dy]) => a.cadPick(x + dx, y + dy)?.id === f.id); if (same) return { id: f.id, x, y, area: f.res ? f.res.area : f.area, type: f.type }; } }
  return null; }, pred);
const frontal = (T) => S((T) => { const a = window.__app, v = a.viewer; const f = [...a.cad.faces].filter((f) => T === 'any' || f.type === T).sort((x, y) => y.area - x.area)[0]; const P = f.tess.positions, N = f.tess.normals;
    const c = [0, 0, 0]; const n = P.length / 3; for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) c[j] += P[3 * i + j] / n;
    let best = 0, bd = Infinity; for (let i = 0; i < n; i++) { const d = (P[3 * i] - c[0]) ** 2 + (P[3 * i + 1] - c[1]) ** 2 + (P[3 * i + 2] - c[2]) ** 2; if (d < bd) { bd = d; best = i; } }
    v.camera.position.set(c[0] + N[3 * best] * 100, c[1] + N[3 * best + 1] * 100, c[2] + N[3 * best + 2] * 100); v.controls.target.set(...c); v.controls.update(); v.focus(c, Math.sqrt(f.area) * 0.6); }, T);
const areaOf = (id) => S((id) => { const f = window.__app.cad.faces[id]; return f.res ? f.res.area : f.area; }, id);
const FX = process.env.CAD_FIXTURES || 'tests/fixtures/cad';
for (const [file, key] of [[FX + '/motordeckel.stp', 'stp'], [FX + '/deviated-cover.igs', 'igs']]) {
  const t0 = Date.now(); await page.setInputFiles('#cad-file', file);
  await page.waitForFunction((n) => window.__app.cad.name && window.__app.cad.name.includes(n), file.split('/').pop(), { timeout: 300000 }); await idle(); await sleep(800);
  const L = await S(() => window.__app.cad.lastLoad);
  ok(L.faces > 0, `${key}: ${L.faces} Flächen ${JSON.stringify(L.types)} · gesamt ${((Date.now() - t0) / 1000).toFixed(1)} s (WASM-Init ${(L.ms.init / 1000).toFixed(1)} s, Lesen ${(L.ms.read / 1000).toFixed(1)} s, Tessellieren ${(L.ms.tess / 1000).toFixed(1)} s, ${L.tris} Dreiecke)`);
  if (PH) await S(() => document.body.classList.remove('show-tree', 'show-dialog'));
  await page.screenshot({ path: `docs/cad-${key}-geladen${SUF}.png` });
  if (key === 'igs') {
    await frontal('any'); await sleep(400); const s = await spot('any'); await tap(s.x, s.y); ok(await S((id) => window.__app.cad.sel.has(id), s.id), `igs: Fläche ${s.id + 1} gewählt (${s.type})`);
    await S(() => window.__app.cadSetTool('offset')); await panel(true); await page.fill('#cad-d', '3'); await page.dispatchEvent('#cad-d', 'input'); await page.click('#cad-off-ok'); await panel(false); await idle();
    const a1 = await areaOf(s.id); ok(a1 < s.area, `igs: Rand-Offset 3 mm ${s.area.toFixed(1)} → ${a1.toFixed(1)} mm²`);
    await page.screenshot({ path: `docs/cad-igs-offset${SUF}.png` });
    break;
  }
  // 1) Hover + Auswahl
  // größte ebene Fläche frontal in den Blick nehmen
  await frontal('Ebene');
  await sleep(500);
  if (process.env.DBG) { page.on('console', (m) => m.text().startsWith('CAMSET') && console.log(m.text())); await S(() => { const v = window.__app.viewer; for (const k of ['view', 'focus', 'setCamera']) { const o = v[k].bind(v); v[k] = (...a) => { console.log('CAMSET ' + k + ' ' + new Error().stack.split('\n').slice(2, 5).join(' | ')); return o(...a); }; } }); }
  const s = await spot('Ebene') ?? await spot('any'); ok(!!s, 'sichtbare Fläche gefunden ' + JSON.stringify(s));
  if (!PH) { await page.mouse.move(s.x, s.y); await sleep(200); ok(await S(() => window.__app.cad.hover) === s.id, 'Hover hebt Fläche hervor'); }
  await tap(s.x, s.y); ok(await S((id) => window.__app.cad.sel.has(id) && !!document.querySelector(`.cad-face.sel[data-cadf="${id}"]`), s.id), `Fläche ${s.id + 1} gewählt, Baum synchron`);
  // 2) Rand-Offset
  await page.click('[data-cadtool="offset"]').catch(async () => S(() => window.__app.cadSetTool('offset'))); await panel(true);
  await page.fill('#cad-d', '3'); await page.dispatchEvent('#cad-d', 'input'); await page.click('#cad-off-ok'); await panel(false); await idle();
  const a1 = await areaOf(s.id); ok(a1 < s.area && a1 > 0, `Rand-Offset 3 mm: ${s.area.toFixed(1)} → ${a1.toFixed(1)} mm²`);
  await page.screenshot({ path: `docs/cad-offset${SUF}.png` });
  // 3) Insel Kreis in der Flächenmitte
  await S(() => window.__app.cadSetTool('circle')); await panel(false); await tap(s.x, s.y); await tap(s.x + 18, s.y); await idle();
  console.log('dbg', JSON.stringify(await S(() => [window.__app.cad.tool, window.__app.cad.draft.length, window.__app.cad.ops.map((o) => o.kind)])));
  const a2 = await areaOf(s.id); ok(a2 < a1, `Insel Kreis: ${a1.toFixed(1)} → ${a2.toFixed(1)} mm²`);
  // 4) Insel Rechteck
  await S(() => window.__app.cadSetTool('rect')); await tap(s.x - 35, s.y - 30); await tap(s.x - 22, s.y - 18); await idle();
  const a3 = await areaOf(s.id); ok(a3 < a2, `Insel Rechteck: ${a2.toFixed(1)} → ${a3.toFixed(1)} mm²`);
  // 5) Schnittlinie über die Fläche, rechte Seite entfernen
  await S(() => window.__app.cadSetTool('cut')); await tap(s.x + 30, s.y - 120); await tap(s.x + 30, s.y + 120);
  await panel(true); await page.click('#cad-cut-ok'); await panel(false); await tap(s.x + 38, s.y + 4); await idle();
  fs.writeFileSync('/tmp/ops.json', JSON.stringify(await S(() => window.__app.cad.ops)));
  const a4 = await areaOf(s.id); ok(a4 < a3, `Schnittlinie: ${a3.toFixed(1)} → ${a4.toFixed(1)} mm²`);
  const nops = await S(() => window.__app.cad.ops.length); ok(nops === 4, `${nops} Operationen in der Liste, Fehler: ${JSON.stringify(await S(() => window.__app.cad.errors))}`);
  await S(() => window.__app.cadSetTool(null)); await sleep(300);
  await page.screenshot({ path: `docs/cad-beschnitte${SUF}.png` });
  // 6) Rückgängig
  await S(() => window.__app.cadUndo()); await idle(); ok(Math.abs(await areaOf(s.id) - a3) < 0.01, 'Rückgängig stellt Fläche vor dem Schnitt wieder her');
  // 7) Export STEP und IGES der gewählten Fläche
  for (const fmt of ['step', 'iges']) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), S((fmt) => window.__app.cadExport(fmt, false), fmt)]); await idle();
    const p = `/tmp/cad-export${SUF}.${fmt === 'step' ? 'stp' : 'igs'}`; await dl.saveAs(p);
    const E = await S(() => window.__app.cad.lastExport);
    ok(E.valid && Math.abs(E.area - a3) / a3 < 0.005 && fs.statSync(p).size > 500, `Export ${fmt.toUpperCase()} ${dl.suggestedFilename()} (${(fs.statSync(p).size / 1024).toFixed(0)} kB): wieder eingelesen ${E.faces} Fläche(n), ${E.area.toFixed(1)} mm² (soll ${a3.toFixed(1)}), gültig ${E.valid}`);
  }
  if (PH) { await S(() => window.__app.cadSetTool('export')); await sleep(400); await page.screenshot({ path: `docs/cad-export${SUF}.png` }); await panel(false); await S(() => window.__app.cadSetTool(null)); }
}
const vis = await S(() => { const r = window.__app.viewer.renderer.domElement.getBoundingClientRect(); return r.width * r.height / (innerWidth * innerHeight); });
ok(vis > 0.3, `3D-Ansicht sichtbar (${(vis * 100).toFixed(0)} %)`);
ok(!errs.length, 'keine Seitenfehler ' + errs.join(' | '));
await b.close(); srv?.kill();
