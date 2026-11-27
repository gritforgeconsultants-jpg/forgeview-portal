import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { accessAssets } from './assets.mjs';
import { createAccessApp } from './app.mjs';
import { openAccessStore } from './store.mjs';

const hosted = process.env.RENDER === 'true' || process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 4193);
const origin = process.env.FORGEVIEW_ACCESS_ORIGIN ?? process.env.RENDER_EXTERNAL_URL ?? `http://127.0.0.1:${port}`;
if (hosted && (!origin.startsWith('https://') || !process.env.DATABASE_URL)) {
  throw new Error('Hosted guest access requires an HTTPS origin and a persistent PostgreSQL database.');
}
const assets = accessAssets({ source: !hosted, keyValue: process.env.FORGEVIEW_BUNDLE_KEY });
const filename = process.env.FORGEVIEW_ACCESS_DB ?? fileURLToPath(new URL('../.preview/guest-access.sqlite', import.meta.url));
if (!process.env.DATABASE_URL && filename !== ':memory:') await mkdir(dirname(filename), { recursive: true });
const store = await openAccessStore({ databaseUrl: process.env.DATABASE_URL, filename });
const app = createAccessApp({ store, assets, ownerDigest: process.env.FORGEVIEW_OWNER_SHA256, origin });
const check = await assets.workspace('index.html', { role: 'owner', scope: 'owner', expiresAt: 0 });
if (!check) throw new Error('Build the ForgeView workspace before starting guest access.');

const server = createServer(async (incoming, outgoing) => {
  try {
    if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) {
      outgoing.writeHead(400).end();
      return;
    }
    const method = incoming.method ?? 'GET';
    const body = method === 'GET' || method === 'HEAD' ? {} : { body: Readable.toWeb(incoming), duplex: 'half' };
    const request = new Request(origin + incoming.url, { method, headers: incoming.headers, ...body });
    const response = await app(request, incoming.socket.remoteAddress);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).on('error', () => outgoing.destroy()).pipe(outgoing);
    else outgoing.end();
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(503, { 'Cache-Control': 'no-store' }).end('ForgeView access is temporarily unavailable.');
    else outgoing.destroy();
  }
});
server.requestTimeout = 15_000;
server.listen(port, hosted ? '0.0.0.0' : '127.0.0.1', () => console.log('ForgeView Guest Access at ' + origin));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close(() => void store.close());
  server.closeIdleConnections();
});
