// Explicit Playwright preload only. No product route or environment bypass.
// Reuses the application's process-wide proxy; never opens the SQLite files.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dispatchD1 } from './d1-rpc.mjs';
const token = readFileSync('.wrangler/e2e-db-token', 'utf8');
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST' || request.url !== '/__test/d1' ||
      request.headers.host !== '127.0.0.1:3002' ||
      request.headers.authorization !== `Bearer ${token}` || request.headers.origin) {
    response.writeHead(403).end(); return;
  }
  try {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 65536) throw new Error('Test payload too large');
    }
    // Application requests initialize this singleton. A harness must not create
    // an additional database owner, even if called before the first request.
    if (!globalThis.__shisuiLocalD1) throw new Error('Application D1 not initialized');
    const { env } = await globalThis.__shisuiLocalD1;
    const result = await dispatchD1(env.DB, JSON.parse(body));
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(result));
  } catch {
    response.writeHead(500).end('Test D1 operation failed');
  }
});
server.listen(3002, '127.0.0.1');
server.unref();
