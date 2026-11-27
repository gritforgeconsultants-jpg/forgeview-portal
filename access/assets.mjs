import { createDecipheriv, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
}));
const publicFiles = new Map(Object.entries({
  '/': 'access/public/index.html', '/access.js': 'access/public/access.js', '/manager.js': 'access/public/manager.js',
  '/access-session.js': 'access/public/access-session.js', '/guest.css': 'access/public/guest.css',
  '/access.css': 'standalone/access.css', '/forgeview.svg': 'dist/forgeview.svg', '/favicon.ico': 'dist/forgeview.svg',
  '/inter.woff2': 'dist/vendor/fonts/inter.woff2', '/barlow.woff2': 'dist/vendor/fonts/barlow.woff2',
}));

const validPath = path => path.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..');

function response(path, content, headers) {
  return { content, headers: { 'Content-Type': types.get(extname(path)) ?? 'application/octet-stream', ...headers } };
}

function workspacePage(html, session) {
  const original = '<script type="module" src="./app.mjs"></script>';
  if (!html.includes(original)) throw new Error('Invalid workspace page.');
  let page = html.replace('</head>', '<script src="./access-context.js"></script>\n</head>')
    .replace(original, original + '\n  <script type="module" src="/access-session.js"></script>');
  if (session.role === 'guest') {
    page = page.replace(/<script type="importmap">[\s\S]*?<\/script>/, '')
      .replace('id="models-tab"', 'id="models-tab" hidden');
  }
  const importMap = /<script type="importmap">([\s\S]*?)<\/script>/.exec(page)?.[1];
  const digest = importMap ? ` 'sha256-${createHash('sha256').update(importMap).digest('base64')}'` : '';
  const policy = `default-src 'none'; script-src 'self' 'wasm-unsafe-eval' blob:${digest}; style-src 'self' 'unsafe-inline';`
    + " img-src 'self' blob: data:; font-src 'self' blob: data:; connect-src 'self' blob: data:; worker-src 'self' blob:;"
    + " base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  return response('index.html', page, { 'Content-Security-Policy': policy });
}

export const assetAAD = path => Buffer.from('forgeview-guest:v1:' + path);

export function accessAssets({ source = false, keyValue, sealedDirectory = join(root, 'access', 'sealed') }) {
  const key = typeof keyValue === 'string' && /^[A-Za-z0-9_-]{43}$/.test(keyValue) ? Buffer.from(keyValue, 'base64url') : null;
  if (!source && !key) throw new Error('Configure the ForgeView guest bundle key.');

  async function localAsset(relative) {
    try { return response(relative, await readFile(join(root, relative))); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'EISDIR') return null; throw error; }
  }

  async function workspaceFile(path) {
    if (source || path.startsWith('vendor/')) return localAsset('dist/' + path);
    let envelope;
    try { envelope = await readFile(join(sealedDirectory, path + '.bin')); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'EISDIR') return null; throw error; }
    const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(0, 12));
    decipher.setAAD(assetAAD(path));
    decipher.setAuthTag(envelope.subarray(-16));
    return response(path, Buffer.concat([decipher.update(envelope.subarray(12, -16)), decipher.final()]));
  }

  return {
    async public(path) { return publicFiles.has(path) ? localAsset(publicFiles.get(path)) : null; },
    manager: () => localAsset('access/public/manage.html'),
    async workspace(path, session) {
      if (path === 'access-context.js') return response('access-context.js', `globalThis.forgeviewAccess = Object.freeze(${JSON.stringify(session)});`);
      if (!validPath(path)) return null;
      if (session.role === 'guest' && (/^models?[-.]/.test(path) || path.endsWith('.fv3d') || /^vendor\/(ifc|three|ocr)\//.test(path)
        || /^(review-scan|symbols-worker)\.mjs$/.test(path))) return null;
      const asset = await workspaceFile(path);
      if (asset && path === 'index.html') return workspacePage(asset.content.toString('utf8'), session);
      return asset;
    },
  };
}
