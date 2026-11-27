const find = id => document.getElementById(id);
const form = find('create-invite');
const label = find('invite-label');
const days = find('invite-days');
const create = find('create');
const signOut = find('sign-out');
const newInvite = find('new-invite');
const link = find('invite-link');
const status = find('manager-status');
const list = find('invites');
const empty = find('empty-list');
let currentLink = null;
let loading = false;
let pending = false;
let changes = 0;
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function showStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

async function api(path, body) {
  const post = body !== undefined;
  const response = await fetch('/api/access/' + path, {
    method: post ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(12_000),
    ...(post && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (response.status === 401 || response.status === 403) location.replace('/?ended=1');
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}

function hideLink() {
  link.value = '';
  newInvite.hidden = true;
  currentLink = null;
}

function rowFor(invite) {
  const row = document.createElement('li');
  row.className = 'invite-row';
  const info = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = invite.label;
  const details = document.createElement('div');
  details.className = 'invite-time';
  const times = {
    ready: ['Claim by', invite.claimBy],
    active: ['Ends', invite.expiresAt],
    expired: ['Expired', invite.expiresAt ?? invite.claimBy],
    revoked: ['Revoked', invite.revokedAt],
  };
  const [description, moment] = times[invite.status];
  details.textContent = description + ' ' + date.format(moment);
  info.append(title, details);
  const badge = document.createElement('span');
  badge.className = 'invite-status ' + invite.status;
  badge.textContent = { ready: 'Ready', active: 'Active', expired: 'Expired', revoked: 'Revoked' }[invite.status];
  row.append(info, badge);
  if (invite.status === 'ready' || invite.status === 'active') {
    const revoke = document.createElement('button');
    revoke.type = 'button';
    revoke.className = 'secondary revoke';
    revoke.textContent = 'Revoke';
    revoke.setAttribute('aria-label', 'Revoke invite for ' + invite.label);
    revoke.addEventListener('click', async () => {
      if (pending) return;
      pending = true;
      changes++;
      revoke.disabled = true;
      showStatus('');
      try {
        const data = await api('invites/' + invite.id + '/revoke', {});
        if (currentLink === invite.id) hideLink();
        row.replaceWith(rowFor(data.invite));
        showStatus('Revoked access for ' + invite.label + '.');
      } catch (error) {
        showStatus(error.message, true);
      } finally {
        pending = false;
        revoke.disabled = false;
        void refresh();
      }
    });
    row.append(revoke);
  }
  return row;
}

async function refresh() {
  if (loading || pending) return;
  loading = true;
  const version = changes;
  try {
    const { invites } = await api('invites');
    if (version !== changes) return;
    list.replaceChildren(...invites.map(rowFor));
    list.hidden = !invites.length;
    empty.hidden = Boolean(invites.length);
    empty.textContent = 'No invites yet.';
    if (currentLink && !invites.some(invite => invite.id === currentLink && ['ready', 'active'].includes(invite.status))) hideLink();
  } catch {
    if (!list.childElementCount) empty.textContent = 'Could not load invites. Refresh to try again.';
  } finally {
    loading = false;
    if (version !== changes) void refresh();
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (pending) return;
  pending = true;
  changes++;
  showStatus('');
  create.disabled = true;
  try {
    const data = await api('invites', { label: label.value, days: Number(days.value) });
    currentLink = data.invite.id;
    find('link-label').textContent = 'Guest link for ' + data.invite.label;
    link.value = data.link;
    newInvite.hidden = false;
    list.prepend(rowFor(data.invite));
    list.hidden = false;
    empty.hidden = true;
    label.value = '';
    find('copy').focus();
    showStatus('Invite created.');
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    create.disabled = false;
    pending = false;
    void refresh();
  }
});

find('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(link.value);
    showStatus('Invite link copied.');
  } catch {
    link.select();
    showStatus('Copy the selected link to share it.');
  }
});

signOut.addEventListener('click', async () => {
  signOut.disabled = true;
  try {
    await api('sign-out', {});
    hideLink();
    location.replace('/');
  } catch {
    showStatus('Could not sign out. Try again.', true);
    signOut.disabled = false;
  }
});

await refresh();
setInterval(() => { if (!document.hidden && !list.contains(document.activeElement)) void refresh(); }, 30_000);
window.addEventListener('pageshow', event => { if (event.persisted) void refresh(); });
