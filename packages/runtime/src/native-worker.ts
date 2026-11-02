import { prepareAttachments, AttachmentError } from './attachments';
import { permissionAdapters } from '../../contracts/permission-adapters';
import { fileAccess, questionsAllowed } from '../../contracts/permissions';
import { worktreeInstructions } from './permission-files';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { harnessAdapters } from './harness-adapters';
import type { HarnessAdapter } from './types';
import type { NativeConfiguration, NativeEvent } from './types';
import { startPermissionFileServer } from './permission-server';
import { startModelTransport } from './model-transport';
import { failureDiagnostic, type RuntimeStage } from './failure-diagnostic';
import { reasoningEvents } from './reasoning-events';
import type { NativeDiagnosticFrame } from '../../contracts/native-diagnostics';

let configuration = JSON.parse(await readFile(process.argv[2], 'utf8')) as NativeConfiguration;
// OpenCode's SDK inherits its parent's environment. Remove it before starting any harness.
const allowed = new Set([
  'PATH',
  'NODE_ENV',
  'LANG',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'TMPDIR',
  'USER',
  'LOGNAME',
]);
for (const key of Object.keys(process.env)) if (!allowed.has(key)) delete process.env[key];
process.env.HOME = configuration.stateHome;
process.env.XDG_CONFIG_HOME = `${configuration.stateHome}/.config`;
process.env.XDG_DATA_HOME = `${configuration.stateHome}/.local/share`;
process.env.XDG_STATE_HOME = `${configuration.stateHome}/.local/state`;
process.env.XDG_CACHE_HOME = `${configuration.stateHome}/.cache`;
process.env.PI_OFFLINE = '1';
process.env.OPENCODE_DISABLE_AUTOUPDATE = 'true';
process.env.OPENCODE_DISABLE_MODELS_FETCH = 'true';
// SDK-hosted OpenCode disables questions by default; our adapter forwards them
// through the existing Run input/answer contract and its permission policy.
process.env.OPENCODE_ENABLE_QUESTION_TOOL = String(questionsAllowed(configuration.permissions || []));
process.chdir(configuration.workspace);
let controller = new AbortController();
process.on('SIGTERM', () => {
  controller.abort();
  process.exitCode = 1;
});
let nextTurn: ((configuration: NativeConfiguration) => void) | undefined;
const answers = new Map<string, (value: Record<string, unknown>) => void>();
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  try {
    const answer = JSON.parse(line);
    if (answer.type === 'turn' && nextTurn) {
      const receive = nextTurn;
      nextTurn = undefined;
      receive(answer.configuration);
      return;
    }
    answers.get(answer.id)?.(answer.answer);
    answers.delete(answer.id);
  } catch {
    /* Invalid control messages never become an answer. */
  }
});
const send = (value: unknown) =>
  new Promise<void>((resolve, reject) =>
    process.stdout.write(`${JSON.stringify(value)}\n`, (error) => (error ? reject(error) : resolve())),
  );
let adapter: HarnessAdapter | undefined;
let files: Awaited<ReturnType<typeof startPermissionFileServer>> | undefined;
const localToken = randomUUID();
let active: { gatewayURL: string; toolURL?: string; token: string; signal: AbortSignal } | undefined;
let stage: RuntimeStage = 'transport_start';
let turnBegan = configuration.performance ? performance.now() : 0;
let captureDeadline = configuration.performance
  ? turnBegan + Math.max(0, Math.min(3_600_000, configuration.performance.expires_at_ms - Date.now()))
  : 0;
type DiagnosticBody<T> = T extends NativeDiagnosticFrame ? Omit<T, 'run_id' | 'capture_id'> : never;
const diagnostic = (data: DiagnosticBody<NativeDiagnosticFrame>) => {
  const capture = configuration.performance;
  if (
    !capture ||
    performance.now() >= captureDeadline ||
    process.stdout.writableNeedDrain ||
    process.stdout.destroyed
  )
    return;
  const value = {
    type: 'diagnostic',
    data: { ...data, run_id: configuration.runId, capture_id: capture.capture_id },
  };
  // Optional frames have no second queue and never wait for stdout backpressure.
  try {
    process.stdout.write(`${JSON.stringify(value)}\n`, () => {});
  } catch {
    /* optional */
  }
};
const setStage = (value: RuntimeStage) => {
  stage = value;
  if (!configuration.performance) return;
  diagnostic({ kind: 'stage', stage: value, worker_offset_ms: performance.now() - turnBegan });
};
const heapMark = (
  mark: 'before_adapter_load' | 'after_adapter_load' | 'turn_start' | 'turn_end',
  adapterLoad?: number,
) => {
  if (!configuration.performance || performance.now() >= captureDeadline) return;
  const memory = process.memoryUsage();
  diagnostic({
    kind: 'heap',
    mark,
    worker_offset_ms: performance.now() - turnBegan,
    rss_bytes: memory.rss,
    heap_used_bytes: memory.heapUsed,
    heap_total_bytes: memory.heapTotal,
    external_bytes: memory.external,
    array_buffers_bytes: memory.arrayBuffers,
    ...(adapterLoad === undefined ? {} : { adapter_load_ms: adapterLoad }),
  });
};
let models: Awaited<ReturnType<typeof startModelTransport>> | undefined;
const reportFailure = async (error: unknown) => {
  await send({
    type: 'event',
    event: {
      type: 'runtime.failed',
      data: { harness: configuration.harness, ...failureDiagnostic(error, stage) },
    },
  });
  await send({
    type: 'result',
    result: {
      outcome: 'failure',
      output: '',
      failureCode: error instanceof AttachmentError ? error.code : 'harness_error',
    },
  });
};
try {
  setStage('adapter_load');
  heapMark('before_adapter_load');
  const loadedAt = configuration.performance ? performance.now() : 0;
  adapter = await harnessAdapters[configuration.harness]();
  if (configuration.performance) heapMark('after_adapter_load', performance.now() - loadedAt);
  controller.signal.throwIfAborted();
  setStage('transport_start');
  models = await startModelTransport(
    configuration.gatewayURL,
    localToken,
    controller.signal,
    fetch,
    () => active,
  );
  setStage('permissions_prepare');
  const permissions = permissionAdapters[configuration.harness];
  const guarded = permissions.translate(configuration.permissions || []).mode === 'guarded';
  if (guarded) process.env.OPENCODE_DISABLE_PROJECT_CONFIG = 'true';
  if (guarded && fileAccess(configuration.permissions || []).read && permissions.fileTools === 'mcp')
    files = await startPermissionFileServer(configuration.workspace, configuration.permissions || []);
  for (;;) {
    active = {
      gatewayURL: configuration.gatewayURL,
      toolURL: configuration.toolURL,
      token: configuration.token,
      signal: controller.signal,
    };
    const c = { ...configuration, gatewayURL: models.url, toolURL: `${models.url}/mcp`, token: localToken };

    const reasoning = reasoningEvents((event) => send({ type: 'event', event }));
    try {
      setStage('attachments_prepare');
      const prepared = await prepareAttachments(c, controller.signal);
      c.prompt = prepared.prompt;
      c.instructions = [worktreeInstructions(c.workspace, c.permissions || []), c.instructions]
        .filter(Boolean)
        .join('\n\n');
      controller.signal.throwIfAborted();
      setStage('harness_initialize');
      const result = await adapter.run({
        setStage,
        configuration: c,
        images: prepared.images,
        fileTools: files,
        signal: controller.signal,
        emit: (event: NativeEvent) => {
          if (event.type === 'runtime.started') setStage('turn_execute');
          return reasoning.write(event);
        },
        ask: async (id, question, details) => {
          if (!questionsAllowed(c.permissions || []))
            throw new Error('Native questions are denied by policy.');
          const answer = new Promise<Record<string, unknown>>((resolve) => answers.set(id, resolve));
          await send({ type: 'input', id, question, details });
          return answer;
        },
      });
      const successful = result.outcome === 'success';
      await reasoning.close(successful ? 'completed' : 'interrupted');
      if (result.outcome === 'failure')
        await send({
          type: 'event',
          event: {
            type: 'runtime.failed',
            data: {
              harness: configuration.harness,
              stage,
              code: 'harness_reported_failure',
              message: 'The harness reported an unsuccessful turn.',
            },
          },
        });
      // Disable and abort outgoing requests before publishing the turn boundary.
      active = undefined;
      controller.abort();
      heapMark('turn_end');
      const next =
        configuration.warm && successful
          ? new Promise<NativeConfiguration>((resolve) => {
              nextTurn = resolve;
            })
          : undefined;
      await send({ type: 'result', result });
      if (!next) break;
      configuration = await next;
      controller = new AbortController();
      turnBegan = configuration.performance ? performance.now() : 0;
      captureDeadline = configuration.performance
        ? turnBegan + Math.max(0, Math.min(3_600_000, configuration.performance.expires_at_ms - Date.now()))
        : 0;
      heapMark('turn_start');
    } catch (error) {
      await reasoning.close('interrupted');
      active = undefined;
      controller.abort();
      heapMark('turn_end');
      await reportFailure(error);
      break;
    }
  }
} catch (error) {
  heapMark('turn_end');
  await reportFailure(error);
} finally {
  active = undefined;
  controller.abort();
  await adapter?.close?.();
  await models?.close();
  await files?.close();
  lines.close();
  process.stdin.destroy();
  process.exit(0);
}
