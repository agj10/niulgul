import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vision = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const destination = resolve(root, 'public/vision');
await mkdir(destination, { recursive: true });
for (const file of await readdir(vision)) {
  if (/\.(wasm|js)$/.test(file)) await copyFile(resolve(vision, file), resolve(destination, file));
}
console.log('Local MediaPipe runtime assets are ready.');
