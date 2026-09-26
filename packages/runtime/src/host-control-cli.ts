import { readFile, unlink } from 'node:fs/promises';
import { z } from 'zod';
const file = process.argv[2];
if (!/^\/platform-control\/request-[a-f0-9-]{36}\.json$/.test(file)) throw new Error('Invalid control request');
const body = await readFile(file, 'utf8');
await unlink(file);
if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw new Error('Control request exceeds limit');
const secret = (await readFile('/platform-control/control-secret', 'utf8')).trim();
const response = await fetch('http://127.0.0.1:10000/control', {
  method: 'POST', redirect: 'error',
  headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
  body, signal: AbortSignal.timeout(55000),
});
if (!response.ok) {
  const failure = z.object({ error: z.string().regex(/^[a-z_]+$/) }).safeParse(await response.json());
  throw new Error(failure.success ? failure.data.error : 'host_control_failed');
}
process.stdout.write(await response.text());
