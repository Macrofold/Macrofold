import { readFile, unlink } from 'node:fs/promises';
const file = process.argv[2];
if (!/^\/platform-control\/request-[a-f0-9-]{36}\.json$/.test(file))
  throw new Error('Invalid control request');
const body = await readFile(file, 'utf8');
await unlink(file);
const secret = (await readFile('/platform-control/control-secret', 'utf8')).trim();
const response = await fetch('http://127.0.0.1:10000/control', {
  method: 'POST',
  headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
  body,
  signal: AbortSignal.timeout(55_000),
});
if (!response.ok) throw new Error('Control request failed');
process.stdout.write(await response.text());
