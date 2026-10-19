import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const version: string = JSON.parse(readFileSync('./package.json', 'utf8')).version;
const rev = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; } })();
const buildInfo = () => JSON.stringify({ version, rev, date: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' });
/** version.json next to index.html: the static test checklist (public/test.html) reads the real app version from it */
const versionJson = {
  name: 'version-json',
  generateBundle(this: any) { this.emitFile({ type: 'asset', fileName: 'version.json', source: buildInfo() }); },
  configureServer(server: any) { server.middlewares.use((req: any, res: any, next: any) => { if (req.url?.split('?')[0].endsWith('/version.json')) { res.setHeader('Content-Type', 'application/json'); res.end(buildInfo()); } else next(); }); },
};
export default defineConfig({
  plugins: [versionJson],
  // GitHub Pages: PAGES_BASE=/messwerk-3d/ (im Workflow gesetzt); lokal relativ für start.bat
  base: process.env.PAGES_BASE ?? './',
  define: { __BUILD__: JSON.stringify({ version, rev, date: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' }) },
  worker: { format: 'es' },
  build: { target: 'es2020', outDir: 'dist', chunkSizeWarningLimit: 1500 },
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 120000 },
});
