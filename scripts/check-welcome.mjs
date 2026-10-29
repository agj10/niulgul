import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('public/presets/welcome.json', root), 'utf8'));
for (const [file, expected] of Object.entries({ ...manifest.inputs, 'public/presets/welcome.bin': manifest.dataSha256 })) {
  const actual = createHash('sha256').update(readFileSync(new URL(file, root))).digest('hex');
  if (actual !== expected) throw new Error(file + ' changed. Run npm run build:welcome to refresh the welcome preset.');
}
console.log('Precomputed welcome preset matches the samples and original engine.');
