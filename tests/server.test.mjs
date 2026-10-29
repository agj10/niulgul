import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { startServer } from '../scripts/serve.mjs';

test('production HTTP server stays reachable on the assigned port', async t => {
  const root = await mkdtemp(join(tmpdir(), 'niulgul-server-'));
  t.after(async () => {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('niulgul-server-'));
    await rm(root, { recursive: true, force: true });
  });
  const html = '<!doctype html><title>niulgul</title>';
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  await Promise.all([
    writeFile(join(root, 'index.html'), html),
    writeFile(join(root, 'engine.wasm'), wasm),
    writeFile(join(root, 'worker.js'), 'export {};'),
  ]);
  const previousPort = process.env.PORT;
  let server;
  try { process.env.PORT = '0'; server = await startServer({ directory: root }); }
  finally { if (previousPort === undefined) delete process.env.PORT; else process.env.PORT = previousPort; }
  t.after(() => new Promise((done, reject) => server.close(error => error ? reject(error) : done())));
  assert.equal(server.address().address, '0.0.0.0');
  assert.notEqual(server.address().port, 3002);
  const base = 'http://127.0.0.1:' + server.address().port;
  const get = (path, options = {}) => fetch(base + path, { signal: AbortSignal.timeout(5000), ...options });

  await t.test('homepage returns HTML', async () => {
    const response = await get('/');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(await response.text(), html);
  });
  await t.test('worker and WASM assets have browser-compatible content types', async () => {
    const engine = await get('/engine.wasm?v=1');
    assert.equal(engine.headers.get('content-type'), 'application/wasm');
    assert.deepEqual(Buffer.from(await engine.arrayBuffer()), wasm);
    const worker = await get('/worker.js');
    assert.equal(worker.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(await worker.text(), 'export {};');
  });
  await t.test('HEAD requests return headers without a body', async () => {
    const response = await get('/', { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(html));
    assert.equal(await response.text(), '');
  });
  await t.test('missing and invalid requests do not serve unrelated files', async () => {
    for (const [path, status] of [['/missing.js', 404], ['/%E0%A4%A', 400], ['/%2e%2e%2fpackage.json', 403]]) {
      const response = await get(path); assert.equal(response.status, status); await response.text();
    }
    const response = await get('/', { method: 'POST' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
  });
});
