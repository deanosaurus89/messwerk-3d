// Collects all UI source strings passed to t()/tt() (gettext style: the English text is the key) into
// i18n/messages.json, keeping existing translations. Add a language by filling in its column, e.g. "de".
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const files = []; const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.ts$/.test(p)) files.push(p); } };
walk('src');
const keys = new Set(); const re = /\b(?:tt|t|tr)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
for (const f of files) { const s = readFileSync(f, 'utf8'); let m; while ((m = re.exec(s))) if (!m[2].includes('${')) keys.add(m[2].replace(/\\(['"`])/g, '$1')); }
const out = 'i18n/messages.json'; mkdirSync('i18n', { recursive: true });
const old = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
const res = {}; for (const k of [...keys].sort()) res[k] = old[k] ?? {};
writeFileSync(out, JSON.stringify(res, null, 1) + '\n'); console.log(`${keys.size} strings → ${out}`);
