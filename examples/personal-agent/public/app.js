const $ = (id) => document.getElementById(id);
let session,
  records = [],
  selected,
  revision,
  openedPath,
  pending,
  working = false;
const node = (tag, text) => {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
};
async function api(path, body) {
  const response = await fetch(
    path,
    body
      ? {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrf },
          body: JSON.stringify(body),
        }
      : {},
  );
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error || 'Request failed.'), {
      status: response.status,
      correctable: result.correctable,
    });
  return result;
}
function notice(message, busy = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('shimmer', busy);
}
function setWorking(value) {
  working = value;
  document.querySelectorAll('button, input, select, textarea').forEach((el) => {
    el.disabled = value || (selected?.status !== 'active' && !!el.closest('#chat, #connect, #schedule'));
  });
}
async function load() {
  session = await api('/api/session');
  $('customer').value = session.customer.id;
  $('customer-label').hidden = !session.demo;
  $('mode').textContent =
    `${session.customer.name} · ${session.model} · local demonstration identities, not production sign-in`;
  $('schedule-budget').textContent =
    `Review before enabling: Monday at 9:00 in your timezone. Budget per run: $${(Number(session.budgetMicroUsd) / 1e6).toFixed(2)}. Simulation makes no paid model calls.`;
  records = await api('/api/agents');
  selected =
    records.find((agent) => agent.id === selected?.id) || records.find((agent) => agent.status !== 'deleted');
  $('agents').replaceChildren();
  for (const agent of records.filter((record) => record.status !== 'deleted')) {
    const button = node('button', `${agent.name} · ${agent.status.replaceAll('_', ' ')}`);
    button.className = agent.id === selected?.id ? 'selected' : '';
    button.addEventListener('click', () => {
      selected = agent;
      $('file').hidden = true;
      void load().catch(showError);
    });
    $('agents').append(button);
  }
  $('workspace').hidden = !selected || selected.status === 'deleted';
  if (!selected || selected.status === 'deleted') return;
  $('agent-title').textContent = selected.name;
  $('agent-status').textContent = selected.status.replaceAll('_', ' ');
  $('pause').textContent = selected.status === 'paused' ? 'Resume' : 'Pause';
  const conversation = $('conversations').value;
  $('conversations').replaceChildren(new Option('New conversation', ''));
  selected.conversations.forEach((id, index) =>
    $('conversations').add(new Option(`Conversation ${index + 1}`, id)),
  );
  if (selected.conversations.includes(conversation)) $('conversations').value = conversation;
  $('connect').hidden = !!selected.connectionId;
  $('connection-status').textContent = selected.connectionId
    ? 'Search account saved. Only this project and agent have access.'
    : '';
  $('schedule').hidden = !!selected.triggerId;
  await activity();
  setWorking(working);
}
async function activity() {
  if (!selected || selected.status === 'deleted' || selected.status === 'setting_up') return;
  const agentId = selected.id;
  const data = await api(`/api/agents/${agentId}/activity`);
  if (selected?.id !== agentId) return;
  $('activity').replaceChildren();
  for (const run of data.runs) {
    const article = node('article', '');
    article.append(
      node('p', `${run.status} · persistence: ${run.persistence_status}`),
      node('pre', run.output_text || 'Waiting for the agent…'),
    );
    if (!run.final) article.lastChild.className = 'shimmer';
    $('activity').append(article);
  }
  const path = $('file-path').value;
  const paths = new Set([
    'profile.md',
    'tasks.json',
    'memory/README.md',
    ...data.files.map((file) => file.path).filter((path) => /^memory\/[a-zA-Z0-9_-]+\.md$/.test(path)),
  ]);
  $('file-path').replaceChildren(...[...paths].map((path) => new Option(path, path)));
  if (paths.has(path)) $('file-path').value = path;
  $('schedule-status').textContent = data.schedule
    ? `${data.schedule.enabled ? 'Enabled' : 'Paused'} · ${data.schedule.timezone} · next: ${data.schedule.enabled ? data.schedule.next_fire_at || 'not scheduled' : 'paused'}`
    : '';
}
function showError(error) {
  notice(error.message);
}
async function submit(command) {
  if (working) return;
  if (pending && pending.body.requestId !== command.body.requestId) {
    notice('Retry the pending action before starting another.');
    return;
  }
  setWorking(true);
  pending = command;
  $('retry').hidden = true;
  // Preserve non-secret commands across a refresh. Never put the Exa credential in browser storage.
  const saved = structuredClone(command);
  if (saved.body.action === 'connect') delete saved.body.secret;
  sessionStorage.setItem(`pending:${session.customer.id}`, JSON.stringify(saved));
  try {
    notice('Saving your action…', true);
    const record = await api(`/api/agents/${command.agentId}`, command.body);
    selected = record;
    pending = undefined;
    sessionStorage.removeItem(`pending:${session.customer.id}`);
    notice('Saved.');
    await load();
    if (command.body.action === 'write') {
      const file = await api(`/api/agents/${command.agentId}/memory?path=${encodeURIComponent(openedPath)}`);
      revision = file.revision;
    }
  } catch (error) {
    // These single-file requests were rejected before publication. A new edit needs a fresh revision.
    // Other failures may follow a committed side effect and must keep their original request ID.
    if (error.correctable) {
      pending = undefined;
      sessionStorage.removeItem(`pending:${session.customer.id}`);
      showError(error);
    } else if (['write', 'forget'].includes(command.body.action) && [400, 404, 412].includes(error.status)) {
      pending = undefined;
      sessionStorage.removeItem(`pending:${session.customer.id}`);
      notice(`${error.message} Open the latest file, review your changes, and save again.`);
    } else {
      showError(error);
      $('retry').hidden = false;
    }
  } finally {
    setWorking(false);
  }
}
function bind(id, action) {
  $(id).addEventListener('submit', (event) => {
    event.preventDefault();
    if (!selected || working) return;
    if (pending) {
      notice('Retry the pending action before starting another.');
      return;
    }
    const fields = Object.fromEntries(new FormData(event.target));
    if (fields.conversationId === '') delete fields.conversationId;
    if (action === 'write') Object.assign(fields, { path: openedPath, revision });
    void submit({ agentId: selected.id, body: { action, ...fields, requestId: crypto.randomUUID() } });
    if (action === 'connect') event.target.reset();
  });
}
for (const [id, action] of [
  ['chat', 'chat'],
  ['connect', 'connect'],
  ['schedule', 'schedule'],
  ['delete', 'delete'],
  ['file', 'write'],
])
  bind(id, action);
$('create').addEventListener('submit', (event) => {
  event.preventDefault();
  if (pending) {
    notice('Retry the pending action before starting another.');
    return;
  }
  void submit({
    agentId: crypto.randomUUID(),
    body: { action: 'setup', name: new FormData(event.target).get('name'), requestId: crypto.randomUUID() },
  });
});
$('pause').addEventListener(
  'click',
  () =>
    void submit({
      agentId: selected.id,
      body: { action: selected.status === 'paused' ? 'resume' : 'pause', requestId: crypto.randomUUID() },
    }),
);
$('forget').addEventListener('click', () => {
  if (confirm(`Forget the current ${openedPath}? This does not erase retained checkpoints.`)) {
    $('file').hidden = true;
    void submit({
      agentId: selected.id,
      body: { action: 'forget', path: openedPath, revision, requestId: crypto.randomUUID() },
    });
  }
});
$('open-file').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (working) return;
  try {
    const agentId = selected.id;
    openedPath = $('file-path').value;
    const file = await api(`/api/agents/${agentId}/memory?path=${encodeURIComponent(openedPath)}`);
    if (selected?.id !== agentId) return;
    revision = file.revision;
    $('file-content').value = file.content;
    $('file').hidden = false;
    notice('File opened.');
  } catch (error) {
    showError(error);
  }
});
$('customer').addEventListener('change', async () => {
  try {
    await api('/api/demo/customer', { id: $('customer').value });
    selected = undefined;
    pending = undefined;
    $('retry').hidden = true;
    $('file').hidden = true;
    await load();
    restorePending();
  } catch (error) {
    showError(error);
  }
});
$('refresh').addEventListener('click', () => void load().catch(showError));
$('retry').addEventListener('click', () => {
  if (!pending) return;
  if (pending.body.action === 'connect' && !pending.body.secret) {
    const key = $('connect').elements.secret.value.trim();
    if (!key) {
      notice('Re-enter the same Exa key, then click Retry. Credentials are never saved in browser storage.');
      return;
    }
    pending.body.secret = key;
    $('connect').reset();
  }
  void submit(pending);
});
function restorePending() {
  const saved = sessionStorage.getItem(`pending:${session.customer.id}`);
  if (saved) {
    pending = JSON.parse(saved);
    $('retry').hidden = false;
    notice('An action was not confirmed. Retry it with its original request ID.');
  }
}
await load().then(restorePending).catch(showError);
setInterval(() => {
  if (!working && !document.hidden) void activity().catch(showError);
}, 2500);
