import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { withCoverageBuild, withCoverageRun } from '../../scripts/coverage/run';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'coverage-retention-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('replaces completed results without mixing observations or exposing an active collection', async () => {
  const root = await fixture();
  const saved = path.join(root, 'full');
  await withCoverageRun(saved, async (directory) => {
    await writeFile(path.join(directory, 'old.json'), 'old');
  });
  await withCoverageRun(saved, async (directory) => {
    expect(directory).not.toBe(saved);
    expect(await readFile(path.join(saved, 'old.json'), 'utf8')).toBe('old');
    await writeFile(path.join(directory, 'new.json'), 'new');
  });
  expect(await readdir(root)).toEqual(['full']);
  expect((await readdir(saved)).sort()).toEqual(['new.json', 'run.json']);
});

it('publishes failed-run diagnostics and propagates the original failure', async () => {
  const root = await fixture();
  const saved = path.join(root, 'full');
  const failure = new Error('coverage gate failed');
  await expect(
    withCoverageRun(saved, async (directory) => {
      await writeFile(path.join(directory, 'server.log'), 'diagnostic');
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(JSON.parse(await readFile(path.join(saved, 'run.json'), 'utf8')).status).toBe('failed');
  expect(await readdir(root)).toEqual(['full']);
});

it('keeps concurrent collectors isolated and retains the last completion', async () => {
  const root = await fixture();
  const saved = path.join(root, 'full');
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const first = withCoverageRun(saved, async (directory) => {
    await writeFile(path.join(directory, 'first'), 'first');
    started();
    await gate;
    expect(await readFile(path.join(directory, 'first'), 'utf8')).toBe('first');
  });
  await ready;
  await withCoverageRun(saved, async (directory) => {
    await writeFile(path.join(directory, 'second'), 'second');
  });
  expect(await readFile(path.join(saved, 'second'), 'utf8')).toBe('second');
  release();
  await first;
  expect((await readdir(saved)).sort()).toEqual(['first', 'run.json']);
  expect(await readdir(root)).toEqual(['full']);
});

it.each([false, true])('removes only its temporary build after processing (failure=%s)', async (fail) => {
  const root = await fixture();
  await writeFile(path.join(root, 'preview'), 'untouched');
  const operation = withCoverageBuild(root, async (directory) => {
    await writeFile(path.join(directory, 'bundle'), 'source map');
    // Coverage processing still has access to the build until the callback settles.
    expect(await readFile(path.join(directory, 'bundle'), 'utf8')).toBe('source map');
    if (fail) throw new Error('packing failed');
  });
  if (fail) await expect(operation).rejects.toThrow('packing failed');
  else await operation;
  expect(await readdir(path.join(root, '.coverage.builds'))).toEqual([]);
  expect(await readFile(path.join(root, 'preview'), 'utf8')).toBe('untouched');
});

it('restores generated Next types without overwriting a concurrent preview update', async () => {
  const root = await fixture();
  const file = path.join(root, 'next-env.d.ts');
  await writeFile(file, 'preview types');
  await withCoverageBuild(root, async (directory) => {
    await writeFile(file, path.relative(root, directory) + '/dist/types/routes.d.ts');
  });
  expect(await readFile(file, 'utf8')).toBe('preview types');
  await withCoverageBuild(root, async () => {
    await writeFile(file, 'new preview types');
  });
  expect(await readFile(file, 'utf8')).toBe('new preview types');
});

it('serializes simultaneous publications without leaving previous reports behind', async () => {
  const root = await fixture();
  const saved = path.join(root, 'full');
  await Promise.all(
    ['a', 'b', 'c'].map((name) =>
      withCoverageRun(saved, async (directory) => {
        await writeFile(path.join(directory, name), name);
      }),
    ),
  );
  expect(await readdir(root)).toEqual(['full']);
  const files = await readdir(saved);
  expect(files).toHaveLength(2);
  expect(files).toContain('run.json');
});
