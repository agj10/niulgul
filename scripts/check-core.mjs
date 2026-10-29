import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(readFileSync(resolve(root,'public/engine/original.json'),'utf8'));
for(const [file,expected] of Object.entries({...manifest.sources,'public/engine/original.wasm':manifest.wasmSha256})){
  const actual=createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex');
  if(actual!==expected)throw new Error(file+' changed. Run npm run build:core to rebuild the original Rust engine.');
}
console.log('Original Rust engine and source hashes verified.');

