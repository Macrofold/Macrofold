import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
it.each(['dev', 'worker', 'doctor'])(
  'loads the same explicit Docker overlay for %s without editing either env file',
  async (action) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'platform-mode-'));
    try {
      const base =
        'PLATFORM_MODE=local\nEXECUTION_PROVIDER=simulator\nALLOW_PAID_EXECUTION=false\nORCHESTRATION_BACKEND=workflow\nAPP_ORIGIN=http://localhost:3210\n';
      const overlay = 'EXECUTION_PROVIDER=docker\nORCHESTRATION_BACKEND=poller\nALLOW_PAID_EXECUTION=false\n';
      await writeFile(path.join(directory, '.env'), base);
      await writeFile(path.join(directory, '.env.docker'), overlay);
      await mkdir(path.join(directory, 'bin'));
      await writeFile(
        path.join(directory, 'bin/pnpm'),
        `#!${process.execPath}\nrequire('node:fs').writeFileSync('observed.json',JSON.stringify({args:process.argv.slice(2),execution:process.env.EXECUTION_PROVIDER,paid:process.env.ALLOW_PAID_EXECUTION,origin:process.env.APP_ORIGIN}));`,
        { mode: 0o755 },
      );
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: 'test',
        PATH: `${directory}/bin:${process.env.PATH}`,
        APP_ORIGIN: 'http://localhost:3999',
      };
      await exec(
        process.execPath,
        [
          '--import',
          path.join(root, 'node_modules/tsx/dist/loader.mjs'),
          path.join(root, 'scripts/docker-profile.ts'),
          action,
        ],
        { cwd: directory, env },
      );
      expect(JSON.parse(await readFile(path.join(directory, 'observed.json'), 'utf8'))).toEqual({
        args: ['run', action],
        execution: 'docker',
        paid: 'false',
        origin: 'http://localhost:3999',
      });
      expect(await readFile(path.join(directory, '.env'), 'utf8')).toBe(base);
      expect(await readFile(path.join(directory, '.env.docker'), 'utf8')).toBe(overlay);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
it('refuses a live journey before network access without a separately explicit budget and opt-in', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'platform-live-guard-'));
  try {
    await expect(
      exec(
        process.execPath,
        [
          '--import',
          path.join(root, 'node_modules/tsx/dist/loader.mjs'),
          path.join(root, 'scripts/test-live-journey.ts'),
        ],
        {
          cwd: directory,
          env: {
            NODE_ENV: 'test',
            PATH: process.env.PATH,
            AGENT_API_KEY: 'fixture-key-does-not-authorize-spending',
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('Live acceptance requires explicit'),
    });
    await expect(
      readFile(path.join(directory, '.data/agent-acceptance/attempts.jsonl')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it('counts uncertain prior live attempts against the approved ceiling before creating another run', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'platform-live-budget-'));
  try {
    await mkdir(path.join(directory, '.data/agent-acceptance'), { recursive: true });
    const journal = path.join(directory, '.data/agent-acceptance/attempts.jsonl');
    await writeFile(journal, '{"ceiling":"100"}\n');
    await expect(
      exec(
        process.execPath,
        [
          '--import',
          path.join(root, 'node_modules/tsx/dist/loader.mjs'),
          path.join(root, 'scripts/test-live-journey.ts'),
        ],
        {
          cwd: directory,
          env: {
            NODE_ENV: 'test',
            PATH: process.env.PATH,
            LIVE_AGENT_TESTS: '1',
            AGENT_JOURNEY_ISOLATED: '1',
            AGENT_JOURNEY_ENVIRONMENT: 'docker',
            AGENT_HOST: 'http://127.0.0.1:1',
            AGENT_API_KEY: 'fixture-key-does-not-authorize-spending',
            AGENT_HARNESS: 'codex',
            AGENT_MODEL: 'synthetic-model',
            AGENT_RUN_BUDGET_MICRO_USD: '100',
            AGENT_JOURNEY_BUDGET_MICRO_USD: '250',
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('Approved acceptance budget exhausted'),
    });
    expect(await readFile(journal, 'utf8')).toBe('{"ceiling":"100"}\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
