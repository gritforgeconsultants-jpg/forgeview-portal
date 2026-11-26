import './access-config.js';
import './access-state.js';

const release = globalThis.forgeviewRelease;
const base = new URL('./', import.meta.url);
const workspace = new URL('workspace/', base);
const form = document.getElementById('access-form');
const code = document.getElementById('access-code');
const unlock = document.getElementById('unlock');
const show = document.getElementById('show-code');
const status = document.getElementById('access-status');
const readonly = !isSecureContext || !('serviceWorker' in navigator);

function showStatus(message, error = false) {
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle('error', error);
}

function busy(running) {
  form.setAttribute('aria-busy', String(running));
  code.disabled = unlock.disabled = show.disabled = running || readonly;
  unlock.textContent = running ? 'Opening ForgeView…' : 'Sign in';
}

show.addEventListener('click', () => {
  const visible = code.type === 'password';
  code.type = visible ? 'text' : 'password';
  show.setAttribute('aria-pressed', String(visible));
  show.setAttribute('aria-label', visible ? 'Hide access code' : 'Show access code');
  code.focus();
});

async function startWorker() {
  const workerUrl = new URL('service-worker.js', base);
  workerUrl.searchParams.set('release', release.id);
  const registration = await navigator.serviceWorker.register(workerUrl, { updateViaCache: 'none' });
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (registration.active?.scriptURL === workerUrl.href && registration.active.state === 'activated') return;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error('Workspace startup timed out.');
}

async function correctCode(text) {
  const match = /^FV-([A-Za-z0-9_-]{43})$/.exec(text.trim());
  if (!match) return null;
  const keyBytes = Uint8Array.from(atob(match[1].replaceAll('-', '+').replaceAll('_', '/') + '='), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  keyBytes.fill(0);
  const file = await fetch(new URL(release.path + '/proof.bin', base), { cache: 'no-store' });
  if (!file.ok) throw new Error('The release could not be loaded.');
  const envelope = new Uint8Array(await file.arrayBuffer());
  try {
    const data = await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: envelope.slice(0, 12),
      additionalData: new TextEncoder().encode(release.id + ':proof'),
    }, key, envelope.slice(12));
    return new TextDecoder().decode(data) === 'ForgeView access' ? key : null;
  } catch (error) {
    if (error.name === 'OperationError') return null;
    throw error;
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const entry = code.value;
  busy(true);
  showStatus('');
  try {
    const key = await correctCode(entry);
    if (!key) {
      showStatus('That access code is incorrect.', true);
      code.value = '';
      return;
    }
    await startWorker();
    await globalThis.accessState.save(key, release.id);
    code.value = '';
    location.replace(workspace);
  } catch {
    showStatus('ForgeView could not open. Check your connection and browser storage, then try again.', true);
  } finally {
    busy(false);
    code.focus();
  }
});

async function resume() {
  if (readonly) {
    busy(false);
    showStatus('Open ForgeView over HTTPS in a current browser.', true);
    return;
  }
  const here = new URL(location.href);
  if (here.searchParams.get('signout') === '1') {
    busy(true);
    try {
      await globalThis.accessState.clear();
      if (typeof BroadcastChannel === 'function') {
        const channel = new BroadcastChannel('forgeview-portal-access');
        channel.postMessage('signed-out');
        channel.close();
      }
      history.replaceState(null, '', base);
    } catch {
      showStatus('The browser could not finish signing out. Reload this page to retry.', true);
    } finally {
      busy(false);
    }
    return;
  }
  try {
    if (await globalThis.accessState.read(release.id)) {
      busy(true);
      await startWorker();
      location.replace(workspace);
    }
  } catch {
    busy(false);
  }
}

void resume();
