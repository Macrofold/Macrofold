import { it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main } from '../../packages/cli/src/index';
import { outcomeExit } from '../../packages/cli/src/stream';
import { limits } from '../../packages/cli/src/context';

it('reports a failed checkpoint as an unsuccessful run even if native execution succeeded', () => {
  expect(
    outcomeExit({ run_id: 'run', final: true, execution_outcome: 'success', persistence_status: 'failed' }),
  ).toBe(1);
  expect(
    outcomeExit({ run_id: 'run', final: true, execution_outcome: 'success', persistence_status: 'verified' }),
  ).toBe(0);
});

it('lets the server choose a runtime within the account cap unless the user specifies one', () => {
  expect(limits({}).timeout_seconds).toBeUndefined();
  expect(limits({ timeout: 60 }).timeout_seconds).toBe(60);
});

it('exposes a lost mutation response identity in the CLI error envelope', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cli-recovery-'));
  const previous = process.cwd();
  let identity: string | null = null;
  let output = '';
  vi.stubEnv('AGENT_API_KEY', 'sk_fixture');
  vi.stubEnv('AGENT_HOST', 'https://agents.example.test');
  vi.stubGlobal('fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    identity = new Headers(init?.headers).get('Idempotency-Key');
    return new Response('{"id":', { status: 201 });
  });
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  try {
    process.chdir(directory);
    expect(await main(['project', 'create', 'Fixture', '--json'])).toBe(7);
    const result = JSON.parse(output);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('transport_unknown');
    expect(result.error.idempotency_key).toBe(identity);
    expect(identity).toBeTruthy();
    expect(output).not.toContain('sk_fixture');
  } finally {
    process.chdir(previous);
    stdout.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});
