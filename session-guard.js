import './access-config.js';
import './access-state.js';

const portal = new URL('./', import.meta.url);
function showSignIn() {
  document.body.hidden = true;
  location.replace(portal);
}

async function checkSession() {
  try {
    if (await globalThis.accessState.read(globalThis.forgeviewRelease.id)) return;
  } catch {
    // The workspace requires a readable, active local session.
  }
  showSignIn();
}

if (typeof BroadcastChannel === 'function') {
  const channel = new BroadcastChannel('forgeview-portal-access');
  channel.addEventListener('message', event => {
    if (event.data === 'signed-out') showSignIn();
  });
}
window.addEventListener('pageshow', checkSession);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void checkSession();
});
setInterval(checkSession, 60 * 1000);
void checkSession();
