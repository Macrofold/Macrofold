// Performance workload, not a unit-test runner. It talks only to loopback model fixtures.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { nativeModelFixture } from '/fixtures/native-model.mjs';

const [harness = 'codex', phase = 'load'] = process.argv.slice(2);
if (!['codex', 'claude-code', 'opencode', 'hermes', 'deepseek', 'pi'].includes(harness) || !['load', 'cold'].includes(phase)) throw new Error('Choose a supported benchmark workload.');
// OpenCode's resident server needs a larger working set than the other fixtures.
const concurrency = harness === 'opencode' ? 2 : 3;
const memoryMiB = harness === 'opencode' ? 2048 : 1024;
const hostMemoryMiB = harness === 'opencode' ? 6144 : 4096;
const secret = `native-load-${randomUUID()}-${randomUUID()}`;
const child = spawn('node', ['/opt/platform/host-control.mjs'], { env: { PATH: process.env.PATH, HOST_CONTROL_SECRET: secret }, stdio: ['ignore', 'inherit', 'inherit'] });
const tokens = new Map();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const measurements = [];
const lag = monitorEventLoopDelay({ resolution: 20 });
let boot;
let active = 0;
let peakActive = 0;
let warmHits = 0;
let successful = 0;
let modelRequests = 0;
let snapshotBytes = 0;
let status = 'failed';
let failure;
const started = performance.now();
const model = createServer(async (req, res) => {
  const token = String(req.headers.authorization || `Bearer ${req.headers['x-api-key'] || ''}`).replace(/^Bearer /, '');
  const entry = tokens.get(token);
  if (!entry || !entry.active) { res.writeHead(401).end(); return; }
  modelRequests++;
  await delay(30);
  try { await entry.fixture.handler(req, res); }
  catch { if (!res.headersSent) res.writeHead(500); res.end(); }
}).listen(8787, '127.0.0.1');

async function control(request) {
  const response = await fetch('http://127.0.0.1:10000/control', { method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ boot_id: boot, request }) });
  const body = await response.json();
  if (!response.ok) throw new Error(`Host ${request.action} failed: ${JSON.stringify(body)}`);
  return body.value;
}
async function until(action, label, seconds = 120) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const value = await action();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`Workload deadline exceeded: ${label}`);
}
async function capture(run) {
  const entries = [];
  let total = 1;
  while (entries.length < total) {
    const page = await control({ action: 'snapshot', ...run, offset: entries.length });
    if (!page.entries.length && page.total > entries.length) throw new Error('Snapshot pagination stalled.');
    entries.push(...page.entries); total = page.total;
    if (total > 50000) throw new Error('Synthetic workload exceeded its file bound.');
  }
  const chunks = [];
  for (const hash of new Set(entries.flatMap(entry => entry.chunks.map(chunk => chunk.hash)))) {
    const { content } = await control({ action: 'chunk', ...run, hash });
    const bytes = Buffer.from(content, 'base64');
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Snapshot chunk failed integrity verification.');
    snapshotBytes += bytes.length;
    if (snapshotBytes > 256 * 1024 * 1024) throw new Error('Synthetic snapshot workload exceeded its byte bound.');
    chunks.push({ path: `chunks/${hash}`, content });
  }
  return { entries, chunks };
}
async function turn(state, index, restored = false) {
  const run = { run_id: randomUUID(), assignment_id: randomUUID() };
  const token = `fixture-${randomUUID()}`;
  const at = performance.now();
  const entry = { fixture: state.fixture, active: true };
  tokens.set(token, entry);
  active++; peakActive = Math.max(peakActive, active);
  try {
    const prepared = await control({ action: 'prepare', ...run,
      worktree_id: state.worktree, session_id: state.session, checkpoint_id: state.checkpoint,
      session_revision: String(index), permission_view: createHash('sha256').update('native-load-authorized-view').digest('hex'),
      compatibility_key: createHash('sha256').update(`native-load-${harness}`).digest('hex'),
      resources: { memory_mib: memoryMiB, cpu_millis: 500 },
      configuration: { runId: run.run_id, harness, provider: harness === 'claude-code' ? 'anthropic' : 'openai',
        model: harness === 'claude-code' ? 'claude-sonnet-4-6' : 'gpt-5.4',
        prompt: index === 0 ? 'Create native.txt with a short note, then finish.' : 'Confirm the prior task is complete.',
        workspace: `/host-data/worktrees/${state.worktree}`, stateHome: '/unused-assigned-home',
        gatewayURL: 'http://127.0.0.1:8787', toolURL: 'http://127.0.0.1:8787/mcp', token,
        deadline: new Date(Date.now() + 90000).toISOString(), resumeId: state.resumeId, toolGrants: false } });
    warmHits += Number(prepared.reused);
    const namespaces = prepared.restoreNamespaces ?? ['workspace', 'home'];
    const entries = state.entries.filter(item => namespaces.includes(item.namespace));
    const hashes = new Set(entries.flatMap(item => item.chunks.map(chunk => chunk.hash)));
    for (const chunk of state.chunks) if (hashes.has(chunk.path.slice(7))) await control({ action: 'stage', ...run, files: [chunk] });
    await control({ action: 'stage', ...run, files: [{ path: 'page-0.json', content: Buffer.from(JSON.stringify(entries)).toString('base64') }] });
    await control({ action: 'restore', ...run });
    await until(async () => {
      const value = await control({ action: 'restored', ...run });
      if (value === 'failure') throw new Error('Native workload restore failed.');
      return value === 'success';
    }, 'restore');
    const before = state.fixture.observed.length;
    await control({ action: 'launch', ...run });
    const result = await until(async () => (await control({ action: 'probe', ...run, offset: 0 })).result, 'native completion');
    if (result.outcome !== 'success' || result.persistence !== 'captured') throw new Error(`Native workload failed: ${JSON.stringify(result)}`);
    if (index > 0 && !state.fixture.observed.slice(before).some(request => request.hasPriorPrompt)) throw new Error('Native continuation lost its previous prompt.');
    const files = await capture(run);
    if (!files.entries.some(item => item.namespace === 'workspace' && item.path === 'native.txt')) throw new Error('Native output did not enter its captured Worktree.');
    if ((await readFile(`/host-data/worktrees/${state.worktree}/native.txt`, 'utf8')) !== 'native tool persisted\n') throw new Error('Native output crossed or lost its Worktree.');
    state.checkpoint = randomUUID(); state.resumeId = result.resumeId; state.entries = files.entries; state.chunks = files.chunks;
    await until(async () => {
      try { await control({ action: 'release', ...run, checkpoint_id: state.checkpoint, session_revision: String(index + 1), persisted: true }); return true; }
      catch (error) { if (!String(error).includes('runtime_not_quiescent')) throw error; return false; }
    }, 'release');
    successful++;
    measurements.push({ duration_ms: Math.round(performance.now() - at), reused_process: prepared.reused,
      restored_namespaces: namespaces, fresh_host: restored, native_state_files: files.entries.filter(item => item.namespace === 'home').length });
  } finally { entry.active = false; tokens.delete(token); active--; }
}

try {
  lag.enable();
  boot = (await until(async () => {
    try { return await control({ action: 'health' }); } catch { return false; }
  }, 'Host startup', 30)).boot_id;
  await control({ action: 'configure', host_id: randomUUID(), generation: 1, resources: { memory_mib: hostMemoryMiB, cpu_millis: 2000 },
    concurrency, isolate_runs: false, warm_memory_mib: Math.floor(hostMemoryMiB / 3), warm_idle_seconds: 120 });
  if (phase === 'cold') {
    const saved = JSON.parse(await readFile(`/exchange/${harness}-continuation.json`, 'utf8'));
    saved.fixture = nativeModelFixture({ workspace: `/host-data/worktrees/${saved.worktree}` });
    await turn(saved, 2, true);
  } else {
    const states = Array.from({ length: 6 }, () => {
      const worktree = randomUUID();
      return { worktree, session: randomUUID(), checkpoint: null, entries: [], chunks: [],
        fixture: nativeModelFixture({ workspace: `/host-data/worktrees/${worktree}` }) };
    });
    let next = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (next < states.length) {
        const state = states[next++];
        await turn(state, 0); await turn(state, 1);
      }
    }));
    const { fixture: _fixture, ...saved } = states[0];
    await writeFile(`/exchange/${harness}-continuation.json`, JSON.stringify(saved));
  }
  status = 'passed';
} catch (error) { failure = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
  lag.disable();
  const sorted = measurements.map(item => item.duration_ms).sort((a, b) => a - b);
  const report = { status, failure, harness, phase, memory_mib_per_run: memoryMiB, host_memory_mib: hostMemoryMiB, successful_runs: successful, peak_concurrent_runs: peakActive,
    warm_hits: warmHits, fixture_model_requests: modelRequests, paid_api_calls: 0, captured_bytes: snapshotBytes,
    elapsed_ms: Math.round(performance.now() - started), p95_ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? null,
    event_loop_p99_ms: Math.round(lag.percentile(99) / 10000) / 100, measurements };
  await writeFile(`/exchange/${harness}-${phase}.json`, JSON.stringify(report, null, 2) + '\n');
  console.log('NATIVE_WORKER_LOAD', JSON.stringify(report));
  child.kill('SIGTERM'); model.closeAllConnections(); model.close();
}
