import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { Client, serviceOrigin } from '../sdk/typescript/src/index';
import { agentJourney } from './agent-journey';

// No .env auto-loading: invocation requires explicit consent, destination, customer key and budget.
const settings = z
  .object({
    LIVE_AGENT_TESTS: z.literal('1'),
    AGENT_JOURNEY_ISOLATED: z.literal('1'),
    AGENT_JOURNEY_ENVIRONMENT: z.enum(['docker', 'staging']),
    AGENT_HOST: z.string().transform(serviceOrigin),
    AGENT_API_KEY: z.string().min(20),
    AGENT_HARNESS: z.enum(['codex', 'claude-code', 'opencode']),
    AGENT_MODEL: z.string().min(1),
    AGENT_CONNECTION_ID: z.uuid().optional(),
    AGENT_JOURNEY_BUDGET_MICRO_USD: z.string().regex(/^[1-9]\d{0,8}$/),
    AGENT_RUN_BUDGET_MICRO_USD: z.string().regex(/^[1-9]\d{0,7}$/),
    AGENT_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(300).default(120),
  })
  .safeParse(process.env);
if (!settings.success)
  throw new Error(
    'Live acceptance requires explicit isolation, origin, key, harness/model, timeout and approved budget. See the cloud development guide.',
  );
const s = settings.data;
const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(s.AGENT_HOST).hostname);
if ((s.AGENT_JOURNEY_ENVIRONMENT === 'docker') !== local)
  throw new Error('Docker acceptance requires loopback; staging requires its isolated HTTPS origin.');
const directory = path.resolve('.data/agent-acceptance');
await mkdir(directory, { recursive: true, mode: 0o700 });
const lockPath = path.join(directory, 'budget.lock');
const lock = await open(lockPath, 'wx', 0o600);
// Keep the lock for the entire journey. Never reclaim a possibly live/uncertain attempt automatically.
const journal = await open(path.join(directory, 'attempts.jsonl'), 'a+', 0o600);
try {
  const rows = (await readFile(path.join(directory, 'attempts.jsonl'), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => z.object({ ceiling: z.string().regex(/^\d+$/) }).parse(JSON.parse(line)));
  const used = rows.reduce((sum, row) => sum + BigInt(row.ceiling), 0n);
  const needed = BigInt(s.AGENT_RUN_BUDGET_MICRO_USD) * 2n;
  if (used + needed > BigInt(s.AGENT_JOURNEY_BUDGET_MICRO_USD))
    throw new Error('Approved acceptance budget exhausted. Do not reset the journal without a new approval.');
  const client = new Client({ baseURL: s.AGENT_HOST, token: s.AGENT_API_KEY, retries: 1 });
  const result = await agentJourney(client, {
    harness: s.AGENT_HARNESS,
    model: s.AGENT_MODEL,
    timeoutSeconds: s.AGENT_TIMEOUT_SECONDS,
    runBudget: s.AGENT_RUN_BUDGET_MICRO_USD,
    connectionId: s.AGENT_CONNECTION_ID,
    beforeRun: async (key, body) => {
      await journal.writeFile(
        JSON.stringify({
          at: new Date().toISOString(),
          origin: s.AGENT_HOST,
          harness: s.AGENT_HARNESS,
          model: s.AGENT_MODEL,
          ceiling: s.AGENT_RUN_BUDGET_MICRO_USD,
          key,
          body,
        }) + '\n',
      );
      await journal.sync();
    },
    accepted: async (run) => {
      await journal.writeFile(
        JSON.stringify({
          ceiling: '0',
          runId: run.run_id,
          sessionId: run.session_id,
          workspaceId: run.workspace_id,
        }) + '\n',
      );
      await journal.sync();
    },
  });
  console.log(
    JSON.stringify({
      ...result,
      environment: s.AGENT_JOURNEY_ENVIRONMENT,
      infrastructureBudgetVerified: false,
    }),
  );
} finally {
  await journal.close();
  await lock.close();
  const { unlink } = await import('node:fs/promises');
  await unlink(lockPath);
}
