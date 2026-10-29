import { spawn } from 'node:child_process';
import { access, mkdir, open } from 'node:fs/promises';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = 'http://127.0.0.1:3002/';

function probe() {
  return new Promise(resolveProbe => {
    const request = http.get(url, response => {
      let html = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { html += chunk; });
      response.on('end', () => resolveProbe(response.statusCode === 200 && /<title>niulgul/i.test(html) ? 'ready' : 'occupied'));
    });
    request.on('error', error => resolveProbe(error.code === 'ECONNREFUSED' ? 'offline' : 'unavailable'));
    request.setTimeout(2000, () => { request.destroy(); resolveProbe('unavailable'); });
  });
}

try {
  const initial = await probe();
  if (initial === 'ready') {
    console.log(`niulgul is already running: ${url}`);
  } else {
    if (initial !== 'offline') throw new Error('Port 3002 is unavailable or used by another app.');
    await access(resolve(root, 'dist/index.html')).catch(() => { throw new Error('Build the app first: npm run build'); });
    await access(resolve(root, 'node_modules/vite/bin/vite.js')).catch(() => { throw new Error('Install dependencies first: npm ci'); });
    const logs = resolve(root, 'test-results');
    await mkdir(logs, { recursive: true });
    const log = await open(resolve(logs, 'preview-server.log'), 'a');
    const server = spawn(process.execPath, [
      resolve(root, 'node_modules/vite/bin/vite.js'), 'preview',
      '--host', '127.0.0.1', '--port', '3002', '--strictPort',
    ], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
    await new Promise((resolveSpawn, reject) => { server.once('spawn', resolveSpawn); server.once('error', reject); });
    server.unref();
    await log.close();
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (await probe() === 'ready') { ready = true; break; }
      await new Promise(resolveWait => setTimeout(resolveWait, 250));
    }
    if (!ready) throw new Error('Preview did not start. Check test-results/preview-server.log.');
    console.log(`niulgul is ready: ${url}`);
    console.log('The server keeps running after this command exits.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
