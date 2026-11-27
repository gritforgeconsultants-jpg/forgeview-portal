const access = globalThis.forgeviewAccess;
if (access) {
  const pollMs = 10_000;
  const leaseMs = 25_000;
  let stopped = false;
  let checking = false;
  let signingOut = false;
  let timeout;
  let interval;

  function leave(url) {
    if (stopped) return;
    stopped = true;
    clearTimeout(timeout);
    clearInterval(interval);
    document.body.hidden = true;
    location.replace(url);
  }

  function renew(remaining) {
    clearTimeout(timeout);
    timeout = setTimeout(() => leave('/?ended=1'), Math.min(remaining, leaseMs));
  }

  async function verify() {
    if (stopped || checking || signingOut) return;
    checking = true;
    try {
      const response = await fetch('/api/access/session', { cache: 'no-store', signal: AbortSignal.timeout(5_000) });
      if (stopped || signingOut) return;
      if (response.status === 401) return leave('/?ended=1');
      if (!response.ok) return;
      const session = await response.json();
      if (stopped || signingOut) return;
      if (session.scope !== access.scope || session.role !== access.role || !(session.remainingMs > 0)) return leave('/?ended=1');
      renew(session.remainingMs);
    } catch {
      // The last verified lease remains in force while the connection recovers.
    } finally {
      checking = false;
    }
  }

  document.querySelector('#account-menu a[href*="signout=1"]')?.addEventListener('click', async event => {
    event.preventDefault();
    if (signingOut) return;
    signingOut = true;
    try {
      const response = await fetch('/api/access/sign-out', { method: 'POST', signal: AbortSignal.timeout(5_000) });
      if (response.ok) return leave('/');
    } catch {
      // Stop access after the current lease if the service is unreachable.
    }
    signingOut = false;
    if (!stopped) alert('ForgeView could not sign out. Check your connection and try again.');
  });
  renew(access.remainingMs ?? leaseMs);
  interval = setInterval(verify, pollMs);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void verify(); });
  window.addEventListener('pageshow', verify);
  window.addEventListener('online', verify);
  void verify();
}
