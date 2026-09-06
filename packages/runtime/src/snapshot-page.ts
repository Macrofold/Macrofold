import { readFile } from 'node:fs/promises';
import type { SnapshotIndex } from './manifest';
const offset = Number(process.argv[2] || 0);
if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid entry offset');
const index = JSON.parse(await readFile('/platform-control/snapshot/index.json', 'utf8')) as SnapshotIndex;
process.stdout.write(
  JSON.stringify({
    entries: index.entries.slice(offset, offset + 32),
    total: index.entries.length,
    totalBytes: index.totalBytes,
  }),
);
