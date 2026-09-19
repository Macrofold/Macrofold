import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { Macrofold } from '../../sdk/typescript/src/index';
import { matchRoute, validateBody } from '../../packages/core/src/http-contract';
import { modelPolicy } from '../../packages/core/src/model-policy';
import { examples } from '../../apps/web/components/journeys/examples';
import { publicConnectors } from '../../apps/web/lib/docs/connectors';
import snapshot from '../../packages/providers/data/connector-catalog.json';

it('runs and streams the displayed new-run example through the public SDK and API schema', async () => {
  const workspace = 'a527a0ef-609d-4682-8a20-c1987312d142';
  const event = { sequence: '1', type: 'output.delta', data: { text: 'Working prototype' } };
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (init?.method === 'POST') {
      const { operation } = matchRoute(new Request(String(url), { method: 'POST' }));
      validateBody(operation, JSON.parse(String(init.body)), false);
      return Response.json({ run_id: 'fixture-run', session_id: 'fixture-session', status: 'queued' });
    }
    if (path.endsWith('/stream'))
      return new Response(
        `data: ${JSON.stringify(event)}\n\ndata: ${JSON.stringify({ sequence: '2', type: 'run.succeeded', data: {} })}\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      );
    if (path.endsWith('/result'))
      return Response.json({
        run_id: 'fixture-run',
        final: true,
        execution_outcome: 'success',
        persistence_status: 'verified',
      });
    return Response.json({ status: 'succeeded' });
  });
  class FixtureMacrofold extends Macrofold {
    constructor() {
      super({ baseURL: 'https://fixture.invalid', apiKey: 'fixture', fetch: fetcher });
    }
  }
  const write = vi.fn();
  await runInNewContext(
    `(async () => { ${examples.TypeScript.replace("import { Macrofold } from 'macrofold';", '')} })()`,
    { Macrofold: FixtureMacrofold, workspace_id: workspace, process: { stdout: { write } } },
    { timeout: 1000 },
  );
  expect(fetcher).toHaveBeenCalledTimes(4);
  const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
  expect(body).toEqual({
    workspace_id: workspace,
    harness: 'codex',
    model: 'gpt-5.4-mini',
    billing_mode: 'managed',
    prompt: 'Build a working prototype.',
  });
  expect(modelPolicy.find((model) => model.id === body.model)).toMatchObject({
    provider: 'openai',
    harnesses: expect.arrayContaining([body.harness]),
  });
  expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('idempotency-key')).toBeTruthy();
  expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer fixture');
  expect(String(fetcher.mock.calls[1]?.[0])).toBe(
    'https://fixture.invalid/v1/runs/fixture-run/stream?after=0',
  );
  expect(write).toHaveBeenCalledExactlyOnceWith('Working prototype');
});

it('publishes every catalog entry without account readiness, authentication configuration, or secrets', () => {
  expect(publicConnectors.apps.map((x) => x.slug)).toEqual(snapshot.data.map((x) => x.slug));
  expect(new Set(publicConnectors.apps.map((x) => x.slug)).size).toBe(snapshot.data.length);
  for (const entry of publicConnectors.apps)
    expect(Object.keys(entry).sort()).toEqual(['categories', 'description', 'name', 'slug', 'tool_count']);
  expect(publicConnectors.native.map((x) => x.provider)).toEqual([
    'anthropic',
    'openai',
    'openrouter',
    'brave',
    'exa',
    'tavily',
    'parallel',
    'firecrawl',
    'github',
    'mcp_remote',
    'mcp_stdio',
  ]);
});
