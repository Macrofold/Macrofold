// Qualification fixture only. The immutable runtime image runs without external networking.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { nativeModelFixture } from './native-model.mjs';
import { nativeBroker } from './native-broker.mjs';

const harness = process.argv[2];
const capture = process.env.NATIVE_MEMORY_CAPTURE === '1';
const testCase = process.env.NATIVE_MEMORY_CASE || 'profile';
assert(
  [
    'profile',
    'failure',
    'failure-full',
    'isolation',
    'modules',
    'abort-load',
    'import-failure',
    'warm-toggle',
    'cpu',
    'expiry',
    'forged',
    'checkpoint-failure',
    'memory-checkpoint-failure',
  ].includes(testCase),
  'Unknown memory fixture case.',
);
const failing = ['failure', 'failure-full', 'memory-checkpoint-failure'].includes(testCase);
const checkpointFailure = ['checkpoint-failure', 'memory-checkpoint-failure'].includes(testCase);
const injectedLoader = testCase === 'abort-load' || testCase === 'import-failure';
if (injectedLoader) assert.equal(harness, 'claude-code', 'The injected loader fixture targets only Claude.');
const strict = process.env.NATIVE_MEMORY_EXPECT_DIAGNOSTICS === '1';
function integer(name, fallback, maximum) {
  const value = Number(process.env[name] ?? fallback);
  assert(Number.isSafeInteger(value) && value >= 0 && value <= maximum, `Invalid ${name}`);
  return value;
}
const coldCount = integer('NATIVE_MEMORY_COLD_COUNT', harness === 'opencode' ? 20 : 5, 40);
const warmCount = integer('NATIVE_MEMORY_WARM_COUNT', harness === 'opencode' ? 30 : 10, 60);
const delayMs = integer('NATIVE_MEMORY_DELAY_MS', 2500, 10000);
assert(coldCount > 0, 'A qualification includes its first cold turn.');
const captureId = randomUUID();
const origin = randomUUID();
const secret = 'native-memory-fixture-only-control-secret';
const sdkModules = {
  '@anthropic-ai/claude-agent-sdk': 'claude',
  '@opencode-ai/sdk/client': 'opencode-client-v1',
  '@opencode-ai/sdk/v2/server': 'opencode-server-v2',
  '@opencode-ai/sdk/v2/client': 'opencode-client-v2',
  '@earendil-works/pi-ai': 'pi-ai',
  '@earendil-works/pi-coding-agent': 'pi-coding',
};
if (testCase === 'forged') {
  const worker = '/opt/platform/native-worker.mjs';
  const original = await readFile(worker);
  await writeFile('/opt/platform/native-worker-original.mjs', original, { mode: 0o644, flag: 'wx' });
  await writeFile(
    '/worker-exchange/instrumentation.json',
    JSON.stringify({
      original_worker_sha256: createHash('sha256').update(original).digest('hex'),
      purpose: 'Fixture-only forged diagnostic/result wrapper; original built worker imported unchanged.',
    }),
    { mode: 0o600, flag: 'wx' },
  );
  await writeFile(worker, "await import('/tests/native-memory-forgeries.mjs');\n");
}
if (testCase === 'modules' || injectedLoader) {
  // Synchronous hooks must be registered before dynamic import; static imports
  // would already have evaluated. This instrumentation is excluded from timing.
  // https://nodejs.org/download/release/v24.13.0/docs/api/module.html#moduleregisterhooksoptions
  const worker = '/opt/platform/native-worker.mjs';
  await writeFile('/opt/platform/native-worker-original.mjs', await readFile(worker), {
    mode: 0o644,
    flag: 'wx',
  });
  const stub = injectedLoader
    ? `
    const send = type => new Promise((resolve, reject) => process.stdout.write(
      JSON.stringify({ type: 'event', event: { type, data: {} } }) + '\\n',
      error => error ? reject(error) : resolve()));
    const used = () => { process.stdout.write(JSON.stringify({ type: 'event', event: {
      type: 'fixture.adapter_used', data: {} } }) + '\\n'); throw new Error('Fixture SDK must not execute.'); };
    export { used as query, used as tool, used as createSdkMcpServer };
    ${
      testCase === 'import-failure'
        ? "throw new Error('PRIVATE_IMPORT_FAILURE_FIXTURE');"
        : `
      const aborted = new Promise(resolve => process.once('SIGTERM', resolve));
      await send('fixture.adapter_loading');
      await aborted;
    `
    }
  `
    : undefined;
  const redirect = stub ? `data:text/javascript,${encodeURIComponent(stub)}` : undefined;
  await writeFile(
    worker,
    `
    import { registerHooks } from 'node:module';
    const allowed = ${JSON.stringify(sdkModules)};
    const redirect = ${JSON.stringify(redirect)};
    const seen = new Set();
    registerHooks({ resolve(specifier, context, nextResolve) {
      const result = nextResolve(redirect && specifier === '@anthropic-ai/claude-agent-sdk' ? redirect : specifier, context);
      if (Object.hasOwn(allowed, specifier) && !seen.has(specifier)) {
        seen.add(specifier);
        process.stdout.write(JSON.stringify({ type: 'event', event: {
          type: 'fixture.module_loaded', data: { sdk: allowed[specifier] }
        } }) + '\\n', error => { if (error) process.exitCode = 1; });
      }
      return result;
    } });
    await import('./native-worker-original.mjs');
  `,
  );
}
if (failing) {
  // Replace only the child in this disposable container, never the image or the
  // supervisor under test. This explicitly qualifies supervision, not a harness.
  const worker = '/opt/platform/native-worker.mjs';
  const original = await readFile(worker);
  await writeFile(
    '/worker-exchange/synthetic-child.json',
    JSON.stringify({
      original_worker_sha256: createHash('sha256').update(original).digest('hex'),
      purpose: 'Bounded synthetic child for real built-image guard/truncation qualification.',
    }),
    { mode: 0o600, flag: 'wx' },
  );
  await writeFile(
    worker,
    `
    import { readFile } from 'node:fs/promises';
    const c = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const send = event => new Promise((resolve, reject) =>
      process.stdout.write(JSON.stringify({ type: 'event', event }) + '\\n',
        error => error ? reject(error) : resolve()));
    await send({ type: 'runtime.started', data: { harness: c.harness, reused: false,
      native_session_id: 'synthetic-memory-fixture' } });
    ${
      testCase === 'failure-full'
        ? `
      const padding = 'x'.repeat(60 * 1024);
      for (let index = 0; index < 1200; index++)
        await send({ type: 'runtime.fixture_padding', data: { padding } });
    `
        : ''
    }
    setInterval(() => {}, 1000);
  `,
    { mode: 0o600 },
  );
}
const started = performance.now();
const control = spawn('node', ['/opt/platform/host-control.mjs'], {
  env: { PATH: process.env.PATH, NODE_ENV: 'production', HOST_CONTROL_SECRET: secret, PORT: '10000' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const characters = new Map();
const samples = [];
const cpuBlocks = [];
const unfinished = new Map();
const pendingModels = new Map();
const digest = (value) => createHash('sha256').update(value).digest('hex');
let boot;
let controllerReadyMs;
let failure;
const model = createServer((req, res) => {
  const token = (req.headers.authorization || `Bearer ${req.headers['x-api-key']}`).replace(/^Bearer /, '');
  const character = characters.get(token);
  if (!character) {
    res.writeHead(401).end();
    return;
  }
  if (req.url === '/mcp') {
    character.broker.handle(req, res);
    return;
  }
  // Token-count/discovery requests are setup, not the first actual generation.
  if (!req.url.split('?')[0].endsWith('/count_tokens')) {
    const call = { started_ms: performance.now() - character.run.started };
    character.run.requests.push(call);
    res.once('finish', () => {
      call.duration_ms = performance.now() - character.run.started - call.started_ms;
    });
  }
  const respond = () =>
    character.fixture.handler(req, res).catch((error) => {
      if (req.aborted && error.code === 'ECONNRESET') return;
      failure ||= error;
      res.destroy();
    });
  if (testCase === 'isolation' && !req.url.split('?')[0].endsWith('/count_tokens')) {
    pendingModels.set(character.session, respond);
    if (pendingModels.size === 3) for (const release of pendingModels.values()) release();
  } else respond();
});
await new Promise((resolve) => model.listen(8787, '127.0.0.1', resolve));

async function request(request, expected = 200) {
  const response = await fetch('http://127.0.0.1:10000/control', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ boot_id: boot, request }),
    signal: AbortSignal.timeout(60000),
  });
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify({ action: request.action, result }));
  return result.value;
}
async function until(action, label) {
  const deadline = performance.now() + 120000;
  while (performance.now() < deadline) {
    if (failure) throw failure;
    const result = await action();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
}
const scoped = (run, action, extra = {}) => ({
  action,
  run_id: run.id,
  assignment_id: run.assignment,
  ...extra,
});
function character() {
  const value = {
    worktree: randomUUID(),
    session: randomUUID(),
    revision: '0',
    checkpoint: null,
    resumeId: undefined,
  };
  value.fixture = nativeModelFixture({
    textOnly: true,
    workspace: `/host-data/worktrees/${value.worktree}`,
    streamText: async function* () {
      await new Promise((resolve) => setTimeout(resolve, value.run.upstreamDelay));
      yield 'Native memory fixture completed.';
    },
  });
  value.broker = nativeBroker(() => value.token);
  return value;
}
async function turn(
  value,
  reused,
  retain,
  ordinal,
  { captured = capture, upstreamDelay = delayMs, captureTtlMs = 60000 } = {},
) {
  const run = { id: randomUUID(), assignment: randomUUID(), requests: [], started: 0, upstreamDelay };
  unfinished.set(run.id, { run, reused, ordinal, captured });
  value.token = `synthetic-native-memory-${run.id}`;
  value.run = run;
  characters.set(value.token, value);
  const preparedAt = performance.now();
  const configuration = {
    runId: run.id,
    harness,
    provider: harness === 'claude-code' ? 'anthropic' : 'openai',
    model: harness === 'claude-code' ? 'claude-sonnet-4-6' : 'gpt-5.4',
    modelLimits: { contextTokens: 128000, maxOutputTokens: 65536 },
    prompt: value.resumeId
      ? 'Confirm the prior task is complete.'
      : 'Create native.txt with a short note, then finish.',
    workspace: '/workspace',
    stateHome: '/agent-home',
    gatewayURL: 'http://127.0.0.1:8787',
    toolURL: 'http://127.0.0.1:8787/mcp',
    token: value.token,
    deadline: new Date(Date.now() + 90000).toISOString(),
    toolGrants: false,
    resumeId: value.resumeId,
    ...(captured
      ? {
          performance: {
            capture_id: captureId,
            origin_instance_id: origin,
            sample_rate: 1,
            expires_at_ms: Date.now() + captureTtlMs,
          },
        }
      : {}),
  };
  const prepared = await request(
    scoped(run, 'prepare', {
      configuration,
      worktree_id: value.worktree,
      session_id: value.session,
      permission_view: digest('fixture-permissions'),
      checkpoint_id: value.checkpoint,
      session_revision: value.revision,
      compatibility_key: digest(`fixture-${harness}`),
      resources: { memory_mib: failing ? 256 : testCase === 'isolation' ? 1024 : 1536, cpu_millis: 500 },
    }),
  );
  assert.equal(prepared.reused, reused, 'A warm turn must retain the actual native process.');
  if (!reused) {
    await request(
      scoped(run, 'stage', {
        files: [{ path: 'page-0.json', content: Buffer.from('[]').toString('base64') }],
      }),
    );
    await request(scoped(run, 'restore'));
    await until(async () => {
      const state = await request(scoped(run, 'restored'));
      assert.notEqual(state, 'failure');
      return state === 'success';
    }, 'empty verified restore');
  }
  const root = `/host-data/worktrees/${value.worktree}`;
  if (!reused) {
    await mkdir(root, { recursive: true });
    // A small ordinary file verifies capture on every turn without adding a model/tool cycle.
    await writeFile(`${root}/native.txt`, 'native memory fixture\n');
    // Valid POSIX filename, intentionally rejected by portable snapshot paths.
    if (checkpointFailure)
      await writeFile(`${root}/checkpoint\\failure.txt`, 'fixture-only capture failure\n');
  }
  const uid = (await stat(root)).uid;
  const events = [];
  let allocator;
  let offset = 0;
  let result;
  run.started = performance.now();
  const launchWall = Date.now();
  await request(scoped(run, 'launch'));
  const probe = async () => {
    const probe = await request(scoped(run, 'probe', { offset, wait_ms: 1000 }));
    assert(probe.nextOffset >= offset);
    // Padding exists only to exhaust the real writer. Do not retain its 64 MiB
    // in the fixture or copy it into evidence; keep the actual truncation marker.
    events.push(...probe.events.filter((event) => event.type !== 'runtime.fixture_padding'));
    if (
      !probe.result &&
      probe.events.some(
        (event) => event.type === 'runtime.memory_profile' && event.data.ended_by === 'capture_expired',
      )
    )
      run.expiredWhileRunning = true;
    offset = probe.nextOffset;
    if (probe.result) {
      result = probe.result;
      return true;
    }
    return false;
  };
  if (failing) {
    const expected = testCase === 'failure-full' ? 'runtime.trace_truncated' : 'runtime.started';
    await until(async () => {
      await probe();
      return events.some((event) => event.type === expected);
    }, expected);
    allocator = spawn(
      'node',
      [
        '-e',
        `
      const memory = Buffer.alloc(384 * 1024 * 1024, 1);
      setInterval(() => { memory[0] ^= 1; }, 1000);
      setTimeout(() => process.exit(0), 15000);
    `,
      ],
      { uid, gid: uid, env: { PATH: process.env.PATH }, stdio: 'ignore' },
    );
    allocator.once('error', (error) => {
      failure ||= error;
    });
  } else if (testCase === 'abort-load') {
    await until(async () => {
      await probe();
      return events.some((event) => event.type === 'fixture.adapter_loading');
    }, 'selected SDK loading');
    await request(scoped(run, 'cancel'));
  }
  await until(probe, 'native completion');
  const observedMs = performance.now() - run.started;
  // The result is final only after the supervisor drains its event writer.
  const tail = await request(scoped(run, 'probe', { offset }));
  events.push(...tail.events.filter((event) => event.type !== 'runtime.fixture_padding'));
  assert.equal(
    result.outcome,
    testCase === 'abort-load'
      ? 'cancelled'
      : failing || testCase === 'import-failure'
        ? 'failure'
        : 'success',
    JSON.stringify({ outcome: result.outcome, failureCode: result.failureCode }),
  );
  assert.equal(result.persistence, checkpointFailure ? 'failed' : 'captured');
  if (checkpointFailure) assert.equal(result.persistenceError, 'checkpoint_capture_failed');
  if (failing) {
    assert.equal(result.failureCode, 'memory_limit');
    if (strict) {
      assert(result.memoryFailure, 'Required failure facts survive ordinary event truncation.');
      assert.equal(result.memoryFailure.limit_bytes, 256 * 1024 ** 2);
      assert(result.memoryFailure.observed_rss_bytes > result.memoryFailure.limit_bytes);
      assert(result.memoryFailure.peak_observed_rss_bytes >= result.memoryFailure.observed_rss_bytes);
      assert(result.memoryFailure.largest_processes.length <= 5);
    }
    if (testCase === 'failure-full')
      assert.equal(events.filter((event) => event.type === 'runtime.trace_truncated').length, 1);
    allocator?.kill('SIGKILL');
  } else if (injectedLoader) {
    assert.equal(run.requests.length, 0, 'An interrupted/failed loader must never reach a model.');
    assert(
      !events.some((event) => event.type === 'fixture.adapter_used'),
      'No SDK method runs after an interrupted import.',
    );
    assert(
      !JSON.stringify({ events, result }).includes('PRIVATE_IMPORT_FAILURE_FIXTURE'),
      'Private import errors stay withheld.',
    );
    if (testCase === 'import-failure')
      assert(
        events.some((event) => event.type === 'runtime.failed' && event.data.stage === 'adapter_load'),
        'Import failure identifies its safe stage.',
      );
  } else assert(run.requests.length > 0, 'A native harness must reach the model fixture.');
  const runtimeStarted = events.find((event) => event.type === 'runtime.started');
  if (!injectedLoader) assert.equal(runtimeStarted?.data.reused, reused);
  if (!checkpointFailure) {
    const snapshot = await request(scoped(run, 'snapshot', { offset: 0 }));
    assert(snapshot.entries.some((entry) => entry.namespace === 'workspace' && entry.path === 'native.txt'));
    value.checkpoint = randomUUID();
    value.revision = String(Number(value.revision) + 1);
  }
  value.resumeId = result.resumeId;
  const profiles = events
    .filter((event) => event.type === 'runtime.memory_profile')
    .map((event) => event.data);
  if (strict && ['profile', 'warm-toggle', 'cpu', 'expiry', 'forged'].includes(testCase)) {
    assert.equal(profiles.length, captured ? 1 : 0, 'Only the current sampled turn delivers a profile.');
    if (captured) {
      assert.equal(profiles[0].run_id, run.id);
      assert.equal(profiles[0].reused, reused);
    }
  }
  if (testCase === 'expiry') {
    assert.equal(profiles[0].ended_by, reused ? 'turn_end' : 'capture_expired');
    if (!reused)
      assert(run.expiredWhileRunning, 'Expiration publishes once while the native turn is still running.');
    else
      assert.deepEqual(
        profiles[0].heap_marks.map((mark) => mark.kind),
        ['turn_start', 'turn_end'],
      );
  }
  if (testCase === 'forged') {
    assert.equal(result.memoryFailure, undefined, 'Child-forged resource facts are never trusted.');
    assert.equal(profiles[0].limit_bytes, 1536 * 1024 ** 2);
    assert(
      profiles[0].dropped.frames >= (reused ? 4 : 3),
      'Malformed and wrong/stale identity frames are rejected.',
    );
    assert(profiles[0].heap_marks.every((mark) => mark.rss_bytes < 2 ** 40));
    if (reused)
      assert.deepEqual(
        profiles[0].heap_marks.map((mark) => mark.kind),
        ['turn_start', 'turn_end'],
      );
  }
  if (testCase === 'warm-toggle') {
    const nativeSession = runtimeStarted.data.native_session_id;
    assert.equal(typeof nativeSession, 'string');
    const pid =
      value.retainedIdentity?.pid ||
      profiles[0].largest_processes
        .filter((process) => process.kind === 'node')
        .map((process) => process.pid)
        .sort((a, b) => a - b)[0];
    assert(pid, 'A retained native Node process is observable.');
    const processStat = await readFile(`/proc/${pid}/stat`, 'utf8');
    // Field22 follows the parenthesized command name, which can contain spaces.
    const startTime = processStat
      .slice(processStat.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/)[19];
    const identity = { pid, startTime, nativeSession };
    if (value.retainedIdentity) assert.deepEqual(identity, value.retainedIdentity);
    else value.retainedIdentity = identity;
    if (reused && captured) {
      assert.deepEqual(
        profiles[0].heap_marks.map((mark) => mark.kind),
        ['turn_start', 'turn_end'],
      );
      assert.equal(profiles[0].adapter_load_ms, undefined, 'Cold import marks cannot leak into a warm turn.');
    }
  }
  const modules = events
    .filter((event) => event.type === 'fixture.module_loaded')
    .map((event) => event.data.sdk)
    .toSorted();
  if (testCase === 'modules') {
    run.loadedSdks = modules;
    const expected =
      {
        'claude-code': ['claude'],
        opencode: ['opencode-client-v1', 'opencode-client-v2', 'opencode-server-v2'],
        pi: ['pi-ai', 'pi-coding'],
      }[harness] || [];
    assert(
      expected.every((sdk) => modules.includes(sdk)),
      'The selected SDKs must actually load.',
    );
    if (process.env.NATIVE_MEMORY_EXPECT_LAZY === '1')
      assert.deepEqual(
        modules,
        expected,
        'Unselected exclusive SDKs must remain unloaded in the actual bundle.',
      );
  }
  if (testCase === 'isolation' && strict) {
    assert.equal(profiles.length, 1, 'Each simultaneous allocation yields its own bounded profile.');
    assert.equal(profiles[0].run_id, run.id);
    let checked = 0;
    for (const observed of profiles[0].largest_processes) {
      try {
        const status = await readFile(`/proc/${observed.pid}/status`, 'utf8');
        assert.equal(
          Number(/^Uid:\s+\d+\s+(\d+)/m.exec(status)?.[1]),
          uid,
          'Foreign allocation process leaked into a profile.',
        );
        checked++;
      } catch (error) {
        if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;
      }
    }
    assert(checked > 0, 'At least the frozen resident worker remains observable.');
  }
  await request(
    scoped(run, 'release', {
      checkpoint_id: value.checkpoint,
      session_revision: value.revision,
      persisted: retain,
    }),
  );
  if (reused)
    assert(
      value.fixture.observed.some((item) => item.hasPriorPrompt),
      'The native conversation must survive warm reuse.',
    );
  characters.delete(value.token);
  const firstDelta = events.find((event) => event.type === 'output.delta');
  const sample = {
    run_id: run.id,
    harness,
    uid,
    ordinal,
    mode: reused ? 'warm' : 'cold',
    capture: captured,
    prepare_restore_ms: run.started - preparedAt,
    first_model_request_ms: run.requests[0]?.started_ms ?? null,
    runtime_started_ms: runtimeStarted ? runtimeStarted.emitted_at - launchWall : null,
    first_delta_ms: firstDelta ? firstDelta.emitted_at - launchWall : null,
    completed_ms: Date.parse(result.completedAt) - launchWall,
    result_observed_ms: observedMs,
    requests: run.requests,
    native_profiles: profiles,
    outcome: result.outcome,
    persistence: result.persistence,
    ...(testCase === 'warm-toggle' ? { retained_identity: value.retainedIdentity } : {}),
    ...(testCase === 'expiry' ? { expired_while_running: !!run.expiredWhileRunning } : {}),
    ...(testCase === 'forged' ? { loader_instrumented: true } : {}),
    ...(checkpointFailure
      ? { checkpoint_failure_injected: true, persistence_error: result.persistenceError }
      : {}),
    ...(testCase === 'modules' ? { loaded_sdks: modules, loader_instrumented: true } : {}),
    ...(injectedLoader ? { injected_loader: true, failure_code: result.failureCode } : {}),
    ...(failing
      ? {
          synthetic_child: true,
          memory_failure: result.memoryFailure ?? null,
          trace_truncated: testCase === 'failure-full',
        }
      : {}),
  };
  samples.push(sample);
  unfinished.delete(run.id);
  console.log(
    JSON.stringify({
      harness,
      mode: sample.mode,
      ordinal,
      first_model_ms: sample.first_model_request_ms,
      completed_ms: sample.completed_ms,
      native_profiles: profiles.length,
    }),
  );
}
try {
  boot = (
    await until(async () => {
      try {
        return await request({ action: 'health' });
      } catch {
        return null;
      }
    }, 'Host startup')
  ).boot_id;
  controllerReadyMs = performance.now() - started;
  await request({
    action: 'configure',
    host_id: randomUUID(),
    generation: 1,
    concurrency: testCase === 'isolation' ? 3 : 2,
    isolate_runs: false,
    resources: { memory_mib: 4096, cpu_millis: 2000 },
    warm_memory_mib: 2048,
    warm_idle_seconds: 300,
  });
  if (testCase === 'expiry' || testCase === 'forged') {
    const value = character();
    await turn(
      value,
      false,
      true,
      0,
      testCase === 'expiry' ? { captureTtlMs: 3000, upstreamDelay: 5000 } : {},
    );
    await turn(value, true, false, 0);
  } else if (testCase === 'cpu') {
    // Container-local accounting includes the fixture, host, supervisor and all
    // native children; no production timers/cgroups are added or changed.
    // https://docs.kernel.org/admin-guide/cgroup-v2.html#cpu-interface-files
    const cpuMax = (await readFile('/sys/fs/cgroup/cpu.max', 'utf8')).trim().split(/\s+/).map(Number);
    assert.equal(cpuMax[0] / cpuMax[1], 2);
    assert.equal(Number(await readFile('/sys/fs/cgroup/memory.max', 'utf8')), 4 * 1024 ** 3);
    const cpuStat = async () =>
      Object.fromEntries(
        (await readFile('/sys/fs/cgroup/cpu.stat', 'utf8'))
          .trim()
          .split('\n')
          .map((line) => {
            const [key, value] = line.trim().split(/\s+/);
            return [key, Number(value)];
          }),
      );
    for (let pair = 0; pair < 8; pair++) {
      for (const enabled of pair % 2 ? [true, false] : [false, true]) {
        const value = character();
        // Exclude fresh-process startup and initial JIT/setup from warm blocks.
        await turn(value, false, true, 0, { captured: false, upstreamDelay: 0 });
        for (let ordinal = 0; ordinal < 2; ordinal++)
          await turn(value, true, true, ordinal, { captured: false, upstreamDelay: 0 });
        const firstSample = samples.length;
        const before = await cpuStat();
        const began = performance.now();
        for (let ordinal = 0; ordinal < 100; ordinal++)
          await turn(value, true, ordinal < 99, ordinal, {
            captured: enabled && ordinal === 49,
            upstreamDelay: ordinal === 49 ? delayMs : 0,
          });
        const elapsedMs = performance.now() - began;
        const after = await cpuStat();
        const profiles = samples.slice(firstSample).flatMap((sample) => sample.native_profiles);
        assert.equal(profiles.length, enabled ? 1 : 0);
        if (enabled) {
          assert(profiles[0].samples_seen > 0 && profiles[0].largest_processes.length > 0);
          assert(
            profiles[0].pss || profiles[0].pss_unavailable_reason,
            'The sampled turn attempts bounded PSS enrichment.',
          );
        }
        cpuBlocks.push({
          pair,
          enabled,
          turns: 100,
          capture_ordinal: 49,
          elapsed_ms: elapsedMs,
          before,
          after,
          usage_usec: after.usage_usec - before.usage_usec,
          first_sample: firstSample,
          profile_count: profiles.length,
        });
      }
    }
  } else if (testCase === 'warm-toggle') {
    const value = character();
    await turn(value, false, true, 0, { captured: true });
    await turn(value, true, true, 0, { captured: false });
    await turn(value, true, false, 1, { captured: true });
    assert.equal(new Set(samples.map((sample) => sample.run_id)).size, 3);
  } else if (testCase === 'isolation') {
    await Promise.all(Array.from({ length: 3 }, (_, ordinal) => turn(character(), false, false, ordinal)));
    assert.equal(new Set(samples.map((sample) => sample.uid)).size, 3);
    assert.equal(pendingModels.size, 3, 'All three native model requests overlap.');
  } else if (failing || testCase === 'modules' || injectedLoader || checkpointFailure)
    await turn(character(), false, false, 0);
  else {
    let last;
    for (let ordinal = 0; ordinal < coldCount; ordinal++) {
      last = character();
      await turn(last, false, ordinal === coldCount - 1 && warmCount > 0, ordinal);
    }
    for (let ordinal = 0; ordinal < warmCount; ordinal++)
      await turn(last, true, ordinal < warmCount - 1, ordinal);
  }
  assert.equal((await request({ action: 'health' })).active_assignments, 0);
} catch (error) {
  failure ||= error;
} finally {
  for (const { run, reused, ordinal, captured } of unfinished.values())
    samples.push({
      run_id: run.id,
      harness,
      ordinal,
      mode: reused ? 'warm' : 'cold',
      capture: captured,
      first_model_request_ms: run.requests[0]?.started_ms ?? null,
      result_observed_ms: run.started ? performance.now() - run.started : null,
      outcome: 'fixture_failed',
      requests: run.requests,
      ...(run.loadedSdks ? { loaded_sdks: run.loadedSdks, loader_instrumented: true } : {}),
    });
  try {
    await writeFile(
      '/worker-exchange/measurements.json',
      JSON.stringify(
        {
          harness,
          capture,
          case: testCase,
          cold_count: coldCount,
          warm_count: warmCount,
          upstream_delay_ms: delayMs,
          controller_ready_ms: controllerReadyMs,
          samples,
          ...(testCase === 'cpu'
            ? {
                cpu_blocks: cpuBlocks,
                cpu_scope:
                  'Container fixture/host/supervisor/native children; preselected1/100 native capture, excluding core SHA-selection and cold prewarm.',
              }
            : {}),
          failed: failure ? { name: failure.name, code: failure.code } : null,
          timing:
            'Monotonic fixture launch/receipt clock; event offsets use same-container wall time. Stages overlap and must not be added. runtime.started is not first model dispatch.',
          memory:
            'Allocation diagnostics only when captured; original image does not retain process samples. No whole-container/unique-memory inference.',
        },
        null,
        2,
      ),
      { mode: 0o600, flag: 'wx' },
    );
  } finally {
    control.kill('SIGTERM');
    model.closeAllConnections();
    model.close();
  }
}
if (failure) throw failure;
