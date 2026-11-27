const form = document.querySelector('#sign-in');
const field = document.querySelector('#code');
const submit = document.querySelector('#open');
const status = document.querySelector('#sign-in-status');
const continueLink = document.querySelector('#continue');
const invite = new URLSearchParams(location.hash.slice(1)).get('invite');
const guest = invite !== null;
const ended = new URLSearchParams(location.search).has('ended');
if (location.hash || ended) history.replaceState(null, '', '/');

function showStatus(message) {
  status.textContent = message;
  status.classList.toggle('error', Boolean(message));
}

if (guest) {
  document.title = 'Guest takeoff · ForgeView';
  document.querySelector('#title').textContent = 'Open guest takeoff';
  document.querySelector('#intro').textContent = 'Open drawings, measure and count, and export your takeoff. ForgeView saves your work in this browser.';
  document.querySelector('#code-field').hidden = true;
  field.disabled = true;
  submit.textContent = 'Open takeoff workspace';
} else if (ended) {
  document.querySelector('#title').textContent = 'ForgeView access ended';
  document.querySelector('#intro').textContent = 'Open a current invite or sign in again to continue.';
} else {
  fetch('/api/access/session', { cache: 'no-store' }).then(async response => {
    if (!response.ok || field.value || submit.disabled) return;
    const session = await response.json();
    if (field.value || submit.disabled) return;
    const owner = session.role === 'owner';
    continueLink.href = owner ? '/manage/' : '/workspace/';
    continueLink.textContent = owner ? 'Manage guest access' : 'Open takeoff workspace';
    continueLink.hidden = false;
  }).catch(() => {});
}

document.querySelector('#show-code').addEventListener('click', event => {
  const show = field.type === 'password';
  field.type = show ? 'text' : 'password';
  event.currentTarget.setAttribute('aria-pressed', String(show));
  event.currentTarget.setAttribute('aria-label', show ? 'Hide access code' : 'Show access code');
  field.focus();
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  submit.disabled = true;
  showStatus('');
  const label = submit.textContent;
  submit.textContent = 'Opening…';
  try {
    const response = await fetch('/api/access/sign-in', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: guest ? invite : field.value }),
      signal: AbortSignal.timeout(12_000),
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(response.status === 401 && guest ? 'This invite is invalid, expired, or revoked. Ask the owner for a current link.' : data.error);
      return;
    }
    field.value = '';
    location.replace(data.next === '/manage/' ? '/manage/' : '/workspace/');
  } catch {
    showStatus('ForgeView is taking longer to respond. Try again.');
  } finally {
    submit.textContent = label;
    submit.disabled = false;
  }
});
