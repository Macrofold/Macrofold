import 'dotenv/config';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { Macrofold } from '../../sdk/typescript/src/index';
import { AgentStore } from './store';
import { PersonalAgents } from './service';
import { demoAuth, exampleServer } from './server';

const env = z
  .object({
    MACROFOLD_API_KEY: z.string().min(1),
    MACROFOLD_BASE_URL: z.string().url().default('http://localhost:3210'),
    EXAMPLE_PORT: z.coerce.number().int().min(0).max(65535).default(3220),
    EXAMPLE_DB: z.string().default('.data/personal-agent.sqlite'),
  })
  .parse(process.env);
const client = new Macrofold({ apiKey: env.MACROFOLD_API_KEY, baseURL: env.MACROFOLD_BASE_URL });
const models = await client.models.list();
// This maintained reference deliberately starts in simulation. Paid adoption is an explicit
// integration change in start.ts: configure a reviewed model, credential, and customer budget.
if (!models.data.some((model) => model.id === 'fixture-model' && model.enabled))
  throw new Error('Start an unpaid local simulator first. See examples/personal-agent/README.md.');
await mkdir(path.dirname(env.EXAMPLE_DB), { recursive: true, mode: 0o700 });
const store = new AgentStore(env.EXAMPLE_DB);
const service = new PersonalAgents(store, client, {
  harness: 'codex',
  model: 'fixture-model',
  billing_mode: 'managed',
  budgetMicroUsd: '2000000',
});
const server = exampleServer(service, demoAuth, true);
server.listen(env.EXAMPLE_PORT, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string')
    console.log(
      `Personal-agent demo: http://127.0.0.1:${address.port} (Alice/Bob demo identities; unpaid simulation)`,
    );
});
process.once('SIGINT', () =>
  server.close(() => {
    store.close();
    process.exit(0);
  }),
);
process.once('SIGTERM', () =>
  server.close(() => {
    store.close();
    process.exit(0);
  }),
);
