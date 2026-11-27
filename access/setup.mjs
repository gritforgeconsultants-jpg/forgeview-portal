import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hashCredential, jsonBody } from './app.mjs';

const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };
const response = (body, status) => new Response(body, { status, headers });
const setupAAD = Buffer.from('ForgeView access setup v1');

export async function hostedSetup({ store, origin, digest, seal, start }) {
  if (!/^[a-f0-9]{64}$/.test(digest ?? '') || typeof seal !== 'string' || seal.length < 32) {
    throw new Error('Configure the one-time setup hash and server-generated sealing key.');
  }
  const verifier = Buffer.from(digest, 'hex');
  const key = createHash('sha256').update(seal).digest();
  let active = await restore();

  async function restore() {
    const sealed = await store.readSetup();
    if (!sealed) return null;
    const envelope = Buffer.from(sealed, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(0, 12));
    decipher.setAAD(setupAAD);
    decipher.setAuthTag(envelope.subarray(-16));
    const clear = Buffer.concat([decipher.update(envelope.subarray(12, -16)), decipher.final()]);
    try { return await start(JSON.parse(clear.toString('utf8'))); }
    finally { clear.fill(0); }
  }

  return async (request, remote) => {
    try {
      active ??= await restore();
      if (active) return active(request, remote);
      const path = new URL(request.url).pathname;
      if (request.method === 'GET' && path === '/healthz') {
        await store.check();
        return response('Setup pending', 200);
      }
      if (request.method !== 'POST' || path !== '/api/access/initialize') return response('ForgeView setup is in progress.', 503);
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('Authorization') ?? '');
      if (request.headers.get('Origin') !== origin || !match || !timingSafeEqual(verifier, Buffer.from(hashCredential(match[1]), 'hex'))) {
        return response('Page not found.', 404);
      }
      const body = await jsonBody(request);
      const config = { ownerDigest: body?.ownerDigest, bundleKey: body?.bundleKey };
      let app;
      try { app = await start(config); }
      catch { return response('The setup values did not open the ForgeView release.', 400); }
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(setupAAD);
      const payload = Buffer.concat([iv, cipher.update(JSON.stringify(config)), cipher.final(), cipher.getAuthTag()]);
      if (!await store.writeSetupOnce(payload.toString('base64url'))) {
        active = await restore();
        return response('Page not found.', 404);
      }
      active = app;
      return response(null, 204);
    } catch {
      return response('ForgeView access is temporarily unavailable.', 503);
    }
  };
}
