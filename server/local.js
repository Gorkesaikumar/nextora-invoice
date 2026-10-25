import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { getDatabase } from './db.js';
import { createAPI, configuration } from './api.js';

// Local development deliberately mirrors the hosted adapter instead of relaxing
// origin, cookie or CSRF validation.
const config = configuration();
const handler = createAPI(getDatabase(), config);
const server = createServer(async (req, res) => {
  try {
    const request = new Request(new URL(req.url, config.appOrigin), {
      method: req.method,
      headers: req.headers,
      ...(!['GET', 'HEAD'].includes(req.method) ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
    });
    const response = await handler(request, { ip: req.socket.remoteAddress });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Service unavailable', code: 'UNAVAILABLE' }));
  }
});
server.listen(Number(process.env.API_PORT || 8888), '127.0.0.1', () => {
  console.log(`Invoicing API ready on http://127.0.0.1:${process.env.API_PORT || 8888}`);
});
process.on('SIGTERM', () => server.close(async () => { await getDatabase().close(); process.exit(0); }));
