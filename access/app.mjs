import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const DAY = 86_400_000;
const OWNER_SESSION = DAY / 2;
const CLAIM_WINDOW = 7 * DAY;
const MAX_JSON = 2048;
const guestCode = /^FV-G-[A-Za-z0-9_-]{43}$/;
const ownerCode = /^FV-[A-Za-z0-9_-]{43}$/;
const sessionCode = /^[A-Za-z0-9_-]{43}$/;
const invitePath = /^\/api\/access\/invites\/([a-f0-9-]{36})\/revoke$/;
const bytes = () => randomBytes(32).toString('base64url');
export const hashCredential = value => createHash('sha256').update(value).digest('hex');

const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const secureHeaders = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': csp,
};

function result(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { ...secureHeaders, ...headers } });
}
const json = (value, status = 200, headers) => result(JSON.stringify(value), status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
const denied = () => json({ error: 'Sign in to ForgeView to continue.' }, 401);
const missing = () => result('Page not found.', 404, { 'Content-Type': 'text/plain; charset=utf-8' });
const redirect = location => result(null, 303, { Location: location });

export async function jsonBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return null;
  if (+request.headers.get('Content-Length') > MAX_JSON || !request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch { return null; }
  finally { reader.releaseLock(); }
}

function state(invite, now) {
  if (invite.revokedAt !== null) return 'revoked';
  if ((invite.expiresAt ?? invite.claimBy) <= now) return 'expired';
  return invite.activatedAt == null ? 'ready' : 'active';
}

function rateLimit() {
  const attempts = new Map();
  return (key, now) => {
    for (const [id, entry] of attempts) if (entry.until <= now) attempts.delete(id);
    if (!attempts.has(key)) {
      if (attempts.size >= 2000) return false;
      attempts.set(key, { count: 0, until: now + 60_000 });
    }
    return ++attempts.get(key).count <= 20;
  };
}

export function createAccessApp({ store, assets, ownerDigest, origin, now = Date.now }) {
  const host = new URL(origin);
  const secure = host.protocol === 'https:';
  if ((!secure && !(host.hostname === '127.0.0.1' || host.hostname === 'localhost')) || host.origin !== origin) {
    throw new Error('Configure the HTTPS origin of ForgeView Guest Access.');
  }
  if (!/^[a-f0-9]{64}$/.test(ownerDigest ?? '')) throw new Error('Configure the ForgeView owner verifier.');
  const verifier = Buffer.from(ownerDigest, 'hex');
  const name = secure ? '__Host-fv_guest' : 'fv_guest_local';
  const cookie = (token, maxAge) => `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  const attempt = rateLimit();

  function sessionHash(request) {
    const pair = (request.headers.get('Cookie') ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(name + '='));
    const token = pair?.slice(name.length + 1);
    return sessionCode.test(token ?? '') ? hashCredential(token) : null;
  }

  async function signIn(request, remote) {
    const time = now();
    if (!attempt(remote, time)) return json({ error: 'Too many attempts. Try again in a minute.' }, 429, { 'Retry-After': '60' });
    const body = await jsonBody(request);
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    const hash = hashCredential(code);
    let id = null, expiresAt = time + OWNER_SESSION;
    if (!(ownerCode.test(code) && timingSafeEqual(verifier, Buffer.from(hash, 'hex')))) {
      const guest = guestCode.test(code) ? await store.activate(hash, time, DAY) : null;
      if (!guest) return json({ error: 'This access code is invalid, expired, or revoked.' }, 401);
      id = guest.id;
      expiresAt = guest.expiresAt;
    }
    const token = bytes();
    await store.startSession(hashCredential(token), id, expiresAt, time);
    const prior = sessionHash(request);
    if (prior) await store.endSession(prior);
    return json({ next: id ? '/workspace/' : '/manage/' }, 200, { 'Set-Cookie': cookie(token, Math.ceil((expiresAt - time) / 1000)) });
  }

  return async (request, remote = 'local') => {
    const path = new URL(request.url).pathname;
    const method = request.method;
    try {
      if (method === 'POST' && request.headers.get('Origin') !== origin) return json({ error: 'Open the ForgeView access page to continue.' }, 403);
      if (method === 'GET' && path === '/healthz') {
        await store.check();
        return result('OK');
      }
      if (method === 'POST' && path === '/api/access/sign-in') return await signIn(request, remote);

      const hash = sessionHash(request);
      if (method === 'POST' && path === '/api/access/sign-out') {
        if (hash) await store.endSession(hash);
        return result(null, 204, { 'Set-Cookie': cookie('', 0) });
      }
      const time = now();
      const current = hash ? await store.session(hash, time) : null;
      const session = current && { ...current, remainingMs: current.expiresAt - time };
      if (method === 'GET' && path === '/api/access/session') return session ? json(session) : denied();

      const revoke = invitePath.exec(path);
      if (path === '/api/access/invites' || revoke) {
        if (session?.role !== 'owner') return session ? json({ error: 'Owner access required.' }, 403) : denied();
        if (path === '/api/access/invites' && method === 'GET') {
          const list = await store.inviteList(time);
          return json({ invites: list.map(entry => ({ ...entry, status: state(entry, time) })) });
        }
        if (method !== 'POST') return missing();
        if (revoke) {
          const entry = await store.revoke(revoke[1], time);
          return entry ? json({ invite: { ...entry, status: 'revoked' } }) : missing();
        }
        const body = await jsonBody(request);
        const label = typeof body?.label === 'string' ? body.label.trim() : '';
        const days = body?.days ?? 7;
        if (!label || label.length > 80 || !Number.isInteger(days) || days < 1 || days > 7) {
          return json({ error: 'Enter a label and a duration between one and seven days.' }, 400);
        }
        const code = 'FV-G-' + bytes();
        const invite = await store.createInvite({ id: randomUUID(), hash: hashCredential(code), label, days, now: time, claimBy: time + CLAIM_WINDOW });
        const link = new URL('/', origin);
        link.hash = new URLSearchParams({ invite: code }).toString();
        return json({ invite: { ...invite, status: 'ready' }, link: link.href }, 201);
      }

      if (method !== 'GET' && method !== 'HEAD') return missing();
      if (path.startsWith('/workspace/') || path === '/workspace' || path === '/manage/' || path === '/manage') {
        const workspace = path.startsWith('/workspace');
        if (!session) return (path === '/workspace/' || path === '/workspace' || path.startsWith('/manage')) ? redirect('/') : denied();
        if (!workspace && session.role !== 'owner') return redirect('/workspace/');
        if (path === '/workspace' || path === '/manage') return redirect(path + '/');
        const asset = workspace ? await assets.workspace(path.slice('/workspace/'.length) || 'index.html', session) : await assets.manager();
        return asset ? result(method === 'HEAD' ? null : asset.content, 200, asset.headers) : missing();
      }
      const asset = await assets.public(path);
      return asset ? result(method === 'HEAD' ? null : asset.content, 200, asset.headers) : missing();
    } catch {
      return json({ error: 'ForgeView access is temporarily unavailable.' }, 503);
    }
  };
}
