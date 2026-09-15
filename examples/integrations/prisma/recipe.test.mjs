import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { prismaNotes } from './recipe.mjs';

test('Prisma queries isolate two customers in a disposable SQLite database', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'customer-prisma-'));
  const env = { ...process.env, EXAMPLE_DATABASE_URL: `file:${path.join(dir, 'fixture.sqlite')}` };
  let prisma;
  try {
    await writeFile(path.join(dir, 'fixture.sqlite'), '');
    const cli = path.resolve('node_modules/prisma/build/index.js');
    execFileSync(process.execPath, [cli, 'generate', '--schema=schema.prisma'], { env, stdio: 'pipe' });
    execFileSync(process.execPath, [cli, 'db', 'push', '--schema=schema.prisma'], { env, stdio: 'pipe' });
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: env.EXAMPLE_DATABASE_URL }) });
    await prisma.customerNote.createMany({
      data: [
        { id: 'alice-note', customerId: 'alice', title: 'Alice', body: 'Quiet hotels' },
        { id: 'bob-note', customerId: 'bob', title: 'Bob', body: 'Mountain walks' },
      ],
    });
    const read = prismaNotes(prisma);
    assert.deepEqual(await read('alice'), [{ id: 'alice-note', title: 'Alice', body: 'Quiet hotels' }]);
    assert.deepEqual(await read('bob'), [{ id: 'bob-note', title: 'Bob', body: 'Mountain walks' }]);
    assert.deepEqual(await read("alice' OR 1=1 --"), []);
    await assert.rejects(read(''));
  } finally {
    await prisma?.$disconnect();
    await rm(dir, { recursive: true, force: true });
  }
});
