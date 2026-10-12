import { defineConfig } from 'vite';
export default defineConfig({
  // GitHub Pages: PAGES_BASE=/messwerk-3d/ (im Workflow gesetzt); lokal relativ für start.bat
  base: process.env.PAGES_BASE ?? './',
  worker: { format: 'es' },
  build: { target: 'es2020', outDir: 'dist', chunkSizeWarningLimit: 1500 },
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 120000 },
});
