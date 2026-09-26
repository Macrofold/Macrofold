import { prepareAttachments, AttachmentError } from './attachments';
import { permissionAdapters } from '../../contracts/permission-adapters';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { CodexAdapter } from './codex';
import { ClaudeAdapter } from './claude';
import { HermesAdapter } from './hermes';
import { DeepSeekAdapter } from './deepseek';
import { PiAdapter } from './pi';
import type { HarnessAdapter, HarnessName } from './types';
import { OpenCodeAdapter } from './opencode';
import type { NativeConfiguration, NativeEvent } from './types';
import { startPermissionFileServer } from './permission-server';
import { startModelTransport } from './model-transport';
import { failureDiagnostic, type RuntimeStage } from './failure-diagnostic';

let configuration = JSON.parse(await readFile(process.argv[2], 'utf8')) as NativeConfiguration;
// OpenCode's SDK inherits its parent's environment. Remove it before starting any harness.
const allowed = new Set(['PATH', 'NODE_ENV', 'LANG', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'TMPDIR', 'USER', 'LOGNAME']);
for (const key of Object.keys(process.env)) if (!allowed.has(key)) delete process.env[key];
process.env.HOME = configuration.stateHome;
process.env.XDG_CONFIG_HOME = `${configuration.stateHome}/.config`;
process.env.XDG_DATA_HOME = `${configuration.stateHome}/.local/share`;
process.env.XDG_STATE_HOME = `${configuration.stateHome}/.local/state`;
process.env.XDG_CACHE_HOME = `${configuration.stateHome}/.cache`;
process.env.PI_OFFLINE = '1';
process.env.OPENCODE_DISABLE_AUTOUPDATE = 'true';
process.env.OPENCODE_DISABLE_MODELS_FETCH = 'true';
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
const adapters: Record<HarnessName, new () => HarnessAdapter> = {
  codex: CodexAdapter,
  'claude-code': ClaudeAdapter,
  opencode: OpenCodeAdapter,
  hermes: HermesAdapter,
  deepseek: DeepSeekAdapter,
  pi: PiAdapter,
};
const adapter = new adapters[configuration.harness]();
let files: Awaited<ReturnType<typeof startPermissionFileServer>> | undefined;
const localToken = randomUUID();
let active: { gatewayURL: string; toolURL?: string; token: string; signal: AbortSignal } | undefined;
let stage: RuntimeStage = 'transport_start';
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
  models = await startModelTransport(
    configuration.gatewayURL,
    localToken,
    controller.signal,
    fetch,
    () => active,
  );
  stage = 'permissions_prepare';
  const permissions = permissionAdapters[configuration.harness];
  const guarded = permissions.translate(configuration.permissions || []).mode === 'guarded';
  if (guarded) process.env.OPENCODE_DISABLE_PROJECT_CONFIG = 'true';
  if (guarded && permissions.fileTools === 'mcp')
    files = await startPermissionFileServer(configuration.workspace, configuration.permissions || []);
  for (;;) {
    controller = new AbortController();
    active = {
      gatewayURL: configuration.gatewayURL,
      toolURL: configuration.toolURL,
      token: configuration.token,
      signal: controller.signal,
    };
    const c = { ...configuration, gatewayURL: models.url, toolURL: `${models.url}/mcp`, token: localToken };

    try {
      stage = 'attachments_prepare';
      const prepared = await prepareAttachments(c, controller.signal);
      c.prompt = prepared.prompt;
      c.instructions = [
        c.instructions,
        'Save user-facing deliverables in outputs/ inside the worktree. Only verified files from that directory are listed as downloadable run outputs.',
      ]
        .filter(Boolean)
        .join('\n\n');
      stage = 'harness_initialize';
      const result = await adapter.run({
        setStage: (value) => {
          stage = value;
        },
        configuration: c,
        images: prepared.images,
        fileTools: files,
        signal: controller.signal,
        emit: (event: NativeEvent) => {
          if (event.type === 'runtime.started') stage = 'turn_execute';
          return send({ type: 'event', event });
        },
        ask: async (id, question, details) => {
          const answer = new Promise<Record<string, unknown>>((resolve) => answers.set(id, resolve));
          await send({ type: 'input', id, question, details });
          return answer;
        },
      });
      const successful = result.outcome === 'success';
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
      const next =
        configuration.warm && successful
          ? new Promise<NativeConfiguration>((resolve) => {
              nextTurn = resolve;
            })
          : undefined;
      await send({ type: 'result', result });
      if (!next) break;
      configuration = await next;
    } catch (error) {
      active = undefined;
      controller.abort();
      await reportFailure(error);
      break;
    }
  }
} catch (error) {
  await reportFailure(error);
} finally {
  active = undefined;
  controller.abort();
  await adapter.close?.();
  await models?.close();
  await files?.close();
  lines.close();
  process.stdin.destroy();
  process.exit(0);
}
