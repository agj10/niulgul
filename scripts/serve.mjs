import http from 'node:http';
import { access, open } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';

const defaultDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

export function createStaticServer(directory = defaultDirectory) {
  const root = resolve(directory);
  return http.createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400); response.end(); return; }
    const filename = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!filename.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
    let file;
    try {
      file = await open(filename, 'r');
      const stat = await file.stat();
      if (!stat.isFile()) { await file.close(); response.writeHead(404); response.end(); return; }
      response.writeHead(200, {
        'Content-Type': mime[extname(filename).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      if (request.method === 'HEAD') { await file.close(); response.end(); }
      else pipeline(file.createReadStream(), response, () => {});
    } catch (error) {
      await file?.close().catch(() => {});
      if (!response.headersSent) response.writeHead(['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code) ? 404 : 500);
      response.end();
    }
  });
}

export async function startServer({ directory = defaultDirectory, port = Number(process.env.PORT ?? 3002), host = process.env.PORT ? '0.0.0.0' : '127.0.0.1' } = {}) {
  await access(resolve(directory, 'index.html'));
  const server = createStaticServer(directory);
  await new Promise((ready, reject) => { server.once('error', reject); server.listen(port, host, ready); });
  console.log(`Serving niulgul on ${host}:${server.address().port}`);
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const server = await startServer();
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
