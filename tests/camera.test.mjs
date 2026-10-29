import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/camera.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { replaceCamera, capture } = await import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'));
function media(facing, events = []) {
  const track = { stops: 0, stop() { this.stops++; events.push('stop:' + facing); }, getSettings() { return facing ? { facingMode: facing } : {}; } };
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}

test('initial camera request prefers the front camera and never requests audio', async () => {
  const front = media('user'); let constraints;
  const result = await replaceCamera({ async getUserMedia(value) { constraints = value; return front; } }, 'user');
  assert.deepEqual(constraints.video.facingMode, { ideal: 'user' });
  assert.equal(constraints.audio, false);
  assert.equal(result.stream, front); assert.equal(result.facing, 'user');
});

test('front and rear switches release the old device before requesting the other one', async () => {
  const events = [], front = media('user', events), rear = media('environment', events), restored = media('user', events);
  const devices = { async getUserMedia(constraints) {
    const facing = constraints.video.facingMode.exact; events.push('request:' + facing);
    return facing === 'environment' ? rear : restored;
  } };
  const back = await replaceCamera(devices, 'environment', { stream: front, facing: 'user' });
  const next = await replaceCamera(devices, 'user', back);
  assert.equal(back.facing, 'environment'); assert.equal(next.facing, 'user');
  assert.deepEqual(events, ['stop:user', 'request:environment', 'stop:environment', 'request:user']);
  assert.equal(restored.track.stops, 0);
});

test('an unavailable rear camera restores the previous front camera', async () => {
  const previous = media('user'), restored = media('user'), calls = [];
  const result = await replaceCamera({ async getUserMedia(constraints) {
    calls.push(constraints.video.facingMode);
    if (calls.length === 1) throw new DOMException('No rear device', 'OverconstrainedError');
    return restored;
  } }, 'environment', { stream: previous, facing: 'user' });
  assert.equal(previous.track.stops, 1); assert.equal(result.stream, restored);
  assert.equal(result.facing, 'user'); assert.match(result.warning, /후면/);
  assert.deepEqual(calls, [{ exact: 'environment' }, { ideal: 'user' }]);
});

test('a browser returning the wrong camera does not silently relabel it', async () => {
  const previous = media('user'), wrong = media('user'), restored = media('user'); let calls = 0;
  const result = await replaceCamera({ async getUserMedia() { return ++calls === 1 ? wrong : restored; } }, 'environment', { stream: previous, facing: 'user' });
  assert.equal(wrong.track.stops, 1); assert.equal(result.stream, restored);
  assert.equal(result.facing, 'user'); assert.match(result.warning, /후면/);
});

test('permission denial does not restart a camera automatically', async () => {
  const denied = new DOMException('Denied', 'NotAllowedError'); let calls = 0;
  await assert.rejects(replaceCamera({ async getUserMedia() { calls++; throw denied; } }, 'environment', { stream: media('user'), facing: 'user' }), error => error === denied);
  assert.equal(calls, 1);
});

test('leaving camera mode prevents a late failure from opening a fallback camera', async () => {
  let reject, calls = 0, current = true;
  const request = replaceCamera({ getUserMedia() { calls++; return new Promise((_, fail) => { reject = fail; }); } }, 'environment', { stream: media('user'), facing: 'user' }, () => current);
  current = false; reject(new DOMException('No rear device', 'OverconstrainedError'));
  await assert.rejects(request, { name: 'OverconstrainedError' }); assert.equal(calls, 1);
});

test('initial selection reports the actual camera on rear-only devices', async () => {
  const result = await replaceCamera({ async getUserMedia() { return media('environment'); } }, 'user');
  assert.equal(result.facing, 'environment');
});

test('front captures are mirrored while rear captures keep their real orientation', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document'), frames = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() {
    const operations = [], frame = { width: 0, height: 0, operations, getContext() { return {
      translate: (...args) => operations.push(['translate', ...args]),
      scale: (...args) => operations.push(['scale', ...args]),
      drawImage: (...args) => operations.push(['drawImage', ...args]),
    }; } }; frames.push(frame); return frame;
  } } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'document', original); else delete globalThis.document; });
  const video = { videoWidth: 1280, videoHeight: 720 };
  const front = capture(video, 'user'), rear = capture(video, 'environment');
  assert.deepEqual([front.width, front.height, rear.width, rear.height], [640, 360, 640, 360]);
  assert.deepEqual(front.operations.slice(0, 2), [['translate', 640, 0], ['scale', -1, 1]]);
  assert.deepEqual(rear.operations, [['drawImage', video, 0, 0, 640, 360]]);
  assert.notEqual(front, rear); assert.equal(frames.length, 2);
});
