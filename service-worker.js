'use strict';

importScripts('./access-config.js', './access-state.js');

const release = globalThis.forgeviewRelease;
const root = new URL(self.registration.scope);
const workspace = new URL('workspace/', root);
const mime = new Map(Object.entries({
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  pdf: 'application/pdf',
  woff2: 'font/woff2',
  wasm: 'application/wasm',
}));

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== root.origin || !url.pathname.startsWith(workspace.pathname)) return;
  event.respondWith(serve(event.request, url));
});

function denied(request) {
  return request.mode === 'navigate' ? Response.redirect(root, 302)
    : new Response('Sign in to ForgeView to access the workspace.', { status: 401 });
}

async function serve(request, url) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
  let key;
  try {
    key = await globalThis.accessState.read(release.id);
  } catch {
    return denied(request);
  }
  if (!key) return denied(request);
  const asset = url.pathname.slice(workspace.pathname.length) || 'index.html';
  if (!asset.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..')) {
    return new Response(null, { status: 404 });
  }
  try {
    // Only sealed release files ship on the static host. The encryption key stays on the device.
    const file = await fetch(new URL(release.path + '/files/' + asset + '.bin', root), { credentials: 'omit' });
    if (!file.ok) return new Response(null, { status: file.status === 404 ? 404 : 502 });
    const envelope = new Uint8Array(await file.arrayBuffer());
    const content = await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: envelope.slice(0, 12),
      additionalData: new TextEncoder().encode(release.id + ':' + asset),
    }, key, envelope.slice(12));
    return new Response(request.method === 'HEAD' ? null : content, {
      headers: {
        'Content-Type': mime.get(asset.split('.').at(-1)) ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch {
    return new Response('Could not load this ForgeView file.', { status: 502 });
  }
}
