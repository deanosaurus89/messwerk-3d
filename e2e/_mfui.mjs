import { chromium } from 'playwright';
const base = process.argv[2];
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage(); p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto(base + '?nodemo'); await p.waitForTimeout(2000);
await p.setInputFiles('#file', '/tmp/multifeature.stl');
await p.waitForSelector('#unit-dlg', { timeout: 120000 }); await p.click('#unit-dlg [data-ok]'); await p.waitForTimeout(5000);
await p.evaluate(() => document.querySelector('#whatsnew')?.remove());
await p.evaluate(() => window.__app.startFitMode('Ebene')); await p.waitForTimeout(500);
const box = await p.locator('canvas').first().boundingBox();
for (const [fx, fy] of [[0.5, 0.5], [0.4, 0.6], [0.6, 0.45], [0.3, 0.4]]) {
  await p.evaluate(() => { const A = window.__app; A.state.preview = null; });
  await p.mouse.click(box.x + box.width * fx, box.y + box.height * fy); await p.waitForTimeout(6000);
  const r = await p.evaluate(() => { const pv = window.__app.state.preview; return pv ? { n: pv.indices.length, grown: pv.grown?.length, type: pv.fit.type, form: pv.fit.form, normal: pv.fit.normal?.map((x) => +x.toFixed(2)), fill: window.__app.state.opts.fill.on, nv: window.__app.state.data.vertexCount } : null; });
  console.log(fx, fy, JSON.stringify(r)); await p.screenshot({ path: `/tmp/mf-${fx}-${fy}.png` });
}
await b.close();
