import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { Client } from '../../sdk/typescript/src/client';
import { examples } from '../../apps/web/components/homepages/examples';

const accepted = { run_id: 'fixture-run', session_id: 'fixture-session', status: 'queued' };

describe('homepage examples at the public SDK boundary', () => {
  it('submits the displayed minimal new-run example and uses the returned session for continuation', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(accepted));
    class FixtureClient extends Client {
      constructor(options: ConstructorParameters<typeof Client>[0]) {
        super({ ...options, baseURL: 'https://fixture.invalid', apiKey: 'fixture-key', fetch: fetcher });
      }
    }
    const source = examples.TypeScript.Run.replace("import { Macrofold } from 'macrofold';", '');
    const result = await runInNewContext(
      `(async () => { ${source}\n${examples.TypeScript.Continue}\nreturn { run, next }; })()`,
      {
        Macrofold: FixtureClient,
        baseURL: 'https://fixture.invalid',
        token: 'fixture-key',
        project_id: 'fixture-project',
        model: 'gpt-5.4-mini',
      },
      { timeout: 1000 },
    );
    expect(result).toEqual({ run: accepted, next: accepted });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const calls = fetcher.mock.calls;
    expect(calls.map(([url]) => String(url))).toEqual([
      'https://fixture.invalid/v1/runs',
      'https://fixture.invalid/v1/runs',
    ]);
    expect(calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      {
        project_id: 'fixture-project',
        harness: 'codex',
        model: 'gpt-5.4-mini',
        billing_mode: 'managed',
        prompt: 'Build a working prototype.',
      },
      { session_id: 'fixture-session', prompt: 'Add tests for the prototype.' },
    ]);
    const keys = calls.map(([, init]) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer fixture-key');
      expect(init?.method).toBe('POST');
      return headers.get('idempotency-key');
    });
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBeTruthy();
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('streams the accepted run through the displayed example until its terminal event', async () => {
    const event = { sequence: '1', type: 'output.delta', data: { text: 'fixture result' } };
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/result')
        ? Response.json({
            run_id: accepted.run_id,
            final: true,
            execution_outcome: 'success',
            persistence_status: 'verified',
          })
        : !String(url).includes('/stream')
          ? Response.json({ status: 'succeeded' })
          : new Response(
              `data: ${JSON.stringify(event)}\n\ndata: ${JSON.stringify({ sequence: '2', type: 'run.succeeded', data: {} })}\n\n`,
              {
                headers: { 'content-type': 'text/event-stream' },
              },
            ),
    );
    const log = vi.fn();
    const client = new Client({ baseURL: 'https://fixture.invalid', token: 'fixture', fetch: fetcher });
    await runInNewContext(`(async () => { ${examples.TypeScript.Stream} })()`, {
      macrofold: client,
      run: accepted,
      process: { stdout: { write: log } },
    });
    expect(log).toHaveBeenCalledExactlyOnceWith('fixture result');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'https://fixture.invalid/v1/runs/fixture-run/stream?after=0',
    );
  });
});
