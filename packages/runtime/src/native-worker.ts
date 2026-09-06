import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { CodexAdapter } from './codex';
import { ClaudeAdapter } from './claude';
import { OpenCodeAdapter } from './opencode';
import type { NativeConfiguration, NativeEvent } from './types';

const configuration = JSON.parse(await readFile(process.argv[2], 'utf8')) as NativeConfiguration;
// OpenCode's SDK inherits its parent's environment. Remove it before starting any harness.
const allowed = new Set(['PATH', 'NODE_ENV', 'LANG', 'SSL_CERT_FILE', 'SSL_CERT_DIR']);
for (const key of Object.keys(process.env)) if (!allowed.has(key)) delete process.env[key];
process.env.HOME = configuration.stateHome;
process.env.XDG_CONFIG_HOME = `${configuration.stateHome}/.config`;
process.env.XDG_DATA_HOME = `${configuration.stateHome}/.local/share`;
process.env.XDG_STATE_HOME = `${configuration.stateHome}/.local/state`;
process.env.XDG_CACHE_HOME = `${configuration.stateHome}/.cache`;
process.env.OPENCODE_DISABLE_AUTOUPDATE = 'true';
process.env.OPENCODE_DISABLE_MODELS_FETCH = 'true';
process.chdir(configuration.workspace);
const controller = new AbortController();
process.on('SIGTERM', () => controller.abort());
const answers = new Map<string, (value: Record<string, unknown>) => void>();
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  try {
    const answer = JSON.parse(line);
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
const adapter =
  configuration.harness === 'codex'
    ? new CodexAdapter()
    : configuration.harness === 'claude-code'
      ? new ClaudeAdapter()
      : new OpenCodeAdapter();
try {
  const result = await adapter.run({
    configuration,
    signal: controller.signal,
    emit: (event: NativeEvent) => send({ type: 'event', event }),
    ask: async (id, question, details) => {
      const answer = new Promise<Record<string, unknown>>((resolve) => answers.set(id, resolve));
      await send({ type: 'input', id, question, details });
      return answer;
    },
  });
  await send({ type: 'result', result });
} catch {
  await send({
    type: 'result',
    result: {
      outcome: controller.signal.aborted ? 'cancelled' : 'failure',
      output: '',
      failureCode: 'harness_error',
    },
  });
} finally {
  lines.close();
  process.stdin.destroy();
  process.exit(0);
}
