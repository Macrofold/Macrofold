import { readFile, mkdir, unlink } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
const invocationId = z.uuid().parse(process.argv[2]);
const root = '/platform-control',
  file = `${root}/stdio-${invocationId}.json`;
if (process.platform !== 'linux' || process.getuid?.() !== 0)
  throw new Error('This command requires an isolated root supervisor.');
const input = z
  .object({
    runId: z.uuid(),
    command: z.string().startsWith('/opt/platform/'),
    args: z.array(z.string()),
    environment: z.record(z.string(), z.string()),
    tool: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  })
  .parse(JSON.parse(await readFile(file, 'utf8')));
const configuration = JSON.parse(await readFile(`${root}/config.json`, 'utf8'));
if (configuration.runId !== input.runId || Date.parse(configuration.deadline) <= Date.now())
  throw new Error('Run is no longer available');
try {
  await mkdir(`${root}/stdio-${invocationId}.lock`, { mode: 0o700 });
} catch {
  await unlink(file).catch(() => {});
  throw new Error('This invocation may already have executed');
}
await unlink(file);
// The package and its credentials share the customer's agent UID and filesystem.
// They never run on the API host or receive the root supervisor's access.
for (const key of Object.keys(process.env)) delete process.env[key];
process.env.PATH = '/opt/platform/node_modules/.bin:/usr/local/bin:/usr/bin:/bin';
process.env.HOME = '/agent-home';
process.setgroups!([]);
process.setgid!(10001);
process.setuid!(10001);
process.chdir('/workspace');
const transport = new StdioClientTransport({
  command: input.command,
  args: input.args,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, ...input.environment },
  cwd: '/workspace',
  stderr: 'ignore',
  maxBufferSize: 2 * 1024 * 1024,
});
const client = new Client({ name: 'platform-stdio', version: '0.1.0' });
const timer = setTimeout(
  () => {
    void transport.close().finally(() => process.exit(124));
  },
  Math.min(45000, Date.parse(configuration.deadline) - Date.now()),
);
try {
  await client.connect(transport);
  const result = await client.callTool({ name: input.tool, arguments: input.arguments }, undefined, {
    timeout: 40000,
  });
  const output = JSON.stringify(result);
  if (Buffer.byteLength(output) > 2 * 1024 * 1024) throw new Error('Result too large');
  process.stdout.write(output);
} finally {
  clearTimeout(timer);
  await client.close();
}
