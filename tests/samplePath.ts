// Demo parts: public ones in public/samples (shown in the app), test-only ones in tests/fixtures/samples.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export function samplePath(name: string): string {
  for (const d of ['../public/samples/', './fixtures/samples/']) { const p = fileURLToPath(new URL(d + name, import.meta.url)); if (existsSync(p)) return p; }
  throw new Error('sample not found: ' + name);
}
