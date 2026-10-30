import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import ts from 'typescript';

const text = await readFile(new URL('../src/welcome.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { decodeWelcome, WelcomeOnce } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const file = await readFile(new URL('../public/presets/welcome.bin', import.meta.url));
const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
const runtimeText = ts.transpileModule(await readFile(new URL('../src/original-core.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const runtime = await import('data:text/javascript;base64,' + Buffer.from(runtimeText).toString('base64'));
runtime.configureOriginalCore(await readFile(new URL('../public/engine/original.wasm', import.meta.url)));
const preset = decodeWelcome(buffer), settings = runtime.ORIGINAL_SETTINGS;

test('precomputed welcome matches a real solve with the current default settings', () => {
  const core = runtime.instantiateOriginalCore(), side = preset.side;
  core.prepare(side, side, 1, 1);
  new Uint8Array(core.memory.buffer, core.input_source_pointer(), preset.source.length).set(preset.source);
  core.solve(side, runtime.proximityForStrength(settings.strength), settings.tone, 1, 0);
  assert.deepEqual(new Uint32Array(core.memory.buffer, core.assignment_pointer(), side * side), preset.assignment);
});

test('precomputed welcome uses every pixel from the native cat sample exactly once', async () => {
  const image = PNG.sync.read(await readFile(new URL('../public/samples/cat.png', import.meta.url)));
  assert.equal(preset.side, image.width); assert.equal(preset.side, image.height);
  assert.deepEqual([...preset.source], [...image.data]);
  assert.equal(new Set(preset.assignment).size, preset.side ** 2);
  assert.notDeepEqual([...preset.assignment], Array.from({ length: preset.side ** 2 }, (_, i) => i));
});
test('welcome is used only on the first request; manual reruns always recalculate', () => {
  const once = new WelcomeOnce('cat', 'obama', preset);
  assert.equal(once.take('cat', 'obama', 'whole', settings), preset);
  assert.equal(once.take('cat', 'obama', 'whole', settings), undefined);
});
test('changed images, scope or settings cannot reuse the initial welcome result', () => {
  for (const input of [['other', 'obama', 'whole', settings], ['cat', 'other', 'whole', settings], ['cat', 'obama', 'faces', settings], ['cat', 'obama', 'whole', { ...settings, tone: 0 }], ['cat', 'obama', 'whole', { ...settings, strength: 100 }]]) {
    const once = new WelcomeOnce('cat', 'obama', preset);
    assert.equal(once.take(...input), undefined);
    assert.equal(once.take('cat', 'obama', 'whole', settings), undefined);
  }
});
test('an incomplete or invalid preset is rejected so startup can fall back to a real solve', () => {
  assert.throws(() => decodeWelcome(buffer.slice(0, 15)), /Incomplete/);
  assert.throws(() => decodeWelcome(buffer.slice(0, -1)), /dimensions/);
  const invalid = buffer.slice(0), view = new DataView(invalid);
  view.setUint32(16 + preset.source.length + 4, preset.assignment[0], true);
  assert.throws(() => decodeWelcome(invalid), /assignment/);
});
