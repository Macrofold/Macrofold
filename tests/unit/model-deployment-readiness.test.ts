import { describe, expect, it, vi } from 'vitest';
import {
  modelReadinessProbeSchema,
  probeModelReadiness,
} from '../../packages/core/src/model-deployment-readiness';
import { AppError } from '../../packages/core/src/errors';
import type { ModelReadinessTarget } from '../../packages/core/src/model-deployment-types';
import type { modelEndpointFetch } from '../../packages/providers/src/network';

const target = (id: string, generation = 'start1'): ModelReadinessTarget => ({
  id,
  generation,
  headers: { 'x-worker-id': `strict ${id}` },
  expected_headers: { 'x-worker-id': id },
});
const input = {
  url: 'https://fixture.api.runpod.ai/v1/models',
  alias: 'revision1',
  protocol: 'systemone',
  headers: { Authorization: 'Bearer synthetic-account', 'x-macrofold-endpoint-secret': 'synthetic-secret' },
  providerReadyReplicas: 0,
};
function answer(id: string, alias = input.alias) {
  return Response.json({ models: [{ name: alias }] }, { headers: { 'x-worker-id': id } });
}

describe('model readiness proofs', () => {
  it.each([
    { status: 401, stage: 'authentication', code: 'model_authentication_failed' },
    { status: 403, stage: 'authentication', code: 'model_authentication_failed' },
    { status: 404, stage: 'response', code: 'model_endpoint_not_found' },
    { status: 429, stage: 'response', code: 'model_rate_limited' },
    { status: 503, stage: 'response', code: 'model_loading' },
    { status: 502, stage: 'response', code: 'model_endpoint_unavailable' },
    { status: 418, stage: 'response', code: 'model_http_error' },
  ])(
    'preserves safe status and stage for HTTP $status without its private body',
    async ({ status, stage, code }) => {
      const result = await probeModelReadiness(
        { ...input, targets: [target('worker1')] },
        async () =>
          new Response('private-provider-error-secret', { status, headers: { 'x-private': 'secret' } }),
      );
      expect(result.readyReplicas).toBe(0);
      expect(result.evidence.last_probe).toEqual({
        checked_at: expect.any(String),
        stage,
        code,
        duration_ms: expect.any(Number),
        http_status: status,
      });
      expect(modelReadinessProbeSchema.safeParse(result.evidence.last_probe).success).toBe(true);
      expect(JSON.stringify(result.evidence)).not.toMatch(/private|secret|Authorization|https:/);
    },
  );

  it.each([
    {
      response: () => answer('wrong-worker'),
      stage: 'worker_identity',
      code: 'model_worker_identity_mismatch',
    },
    {
      response: () => answer('worker1', 'wrong-alias'),
      stage: 'model_identity',
      code: 'model_identity_mismatch',
    },
    {
      response: () =>
        Response.json({ unexpected: 'private-secret' }, { headers: { 'x-worker-id': 'worker1' } }),
      stage: 'response',
      code: 'model_response_invalid',
    },
    {
      response: () => new Response('not json private-secret', { headers: { 'x-worker-id': 'worker1' } }),
      stage: 'response',
      code: 'model_response_invalid',
    },
    {
      response: () => new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'x-worker-id': 'worker1' } }),
      stage: 'response',
      code: 'model_response_too_large',
    },
  ])(
    'distinguishes $code and invalidates contradictory identity evidence',
    async ({ response, stage, code }) => {
      const result = await probeModelReadiness(
        {
          ...input,
          targets: [target('worker1')],
          previous: {
            cursor: 0,
            verified: [{ id: 'worker1', generation: 'start1', checked_at: Date.now() }],
          },
        },
        async () => response(),
      );
      expect(result.readyReplicas).toBe(0);
      expect(result.evidence.verified).toEqual([]);
      expect(result.evidence.last_probe).toMatchObject({ stage, code, http_status: 200 });
      expect(JSON.stringify(result.evidence)).not.toContain('private-secret');
    },
  );

  it('recognizes the network response ceiling as invalid data rather than preserving an old proof', async () => {
    const result = await probeModelReadiness(
      {
        ...input,
        targets: [target('worker1')],
        previous: { cursor: 0, verified: [{ id: 'worker1', generation: 'start1', checked_at: Date.now() }] },
      },
      async () => {
        throw new AppError(413, 'response_too_large', 'private secret');
      },
    );
    expect(result.readyReplicas).toBe(0);
    expect(result.evidence.last_probe).toMatchObject({ stage: 'response', code: 'model_response_too_large' });
    expect(result.evidence.last_probe).not.toHaveProperty('http_status');
  });

  it.each([
    { error: new DOMException('private secret', 'TimeoutError'), code: 'model_readiness_timeout' },
    { error: new Error('private credentials and endpoint'), code: 'model_readiness_unavailable' },
  ])('classifies $code without extending a previous proof', async ({ error, code }) => {
    const checkedAt = Date.now() - 10_000;
    const result = await probeModelReadiness(
      {
        ...input,
        targets: [target('worker1')],
        previous: { cursor: 0, verified: [{ id: 'worker1', generation: 'start1', checked_at: checkedAt }] },
      },
      async () => {
        throw error;
      },
    );
    expect(result.readyReplicas).toBe(1);
    expect(result.evidence.verified[0].checked_at).toBe(checkedAt);
    expect(result.evidence.last_probe).toMatchObject({ stage: 'transport', code });
    expect(JSON.stringify(result.evidence)).not.toMatch(/private|secret|credentials|endpoint/);
  });

  it('records waiting for a worker without pretending an authenticated endpoint was probed', async () => {
    const fetch = vi.fn<typeof modelEndpointFetch>();
    const result = await probeModelReadiness({ ...input, targets: [] }, fetch);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.evidence.last_probe).toMatchObject({
      stage: 'worker',
      code: 'model_waiting_for_worker',
      duration_ms: 0,
    });
    expect(result.evidence.last_probe).not.toHaveProperty('http_status');
  });

  it.each(['model_downloading_failed', 'model_loading_failed'])(
    'retains the protected wrapper startup code %s without its message',
    async (code) => {
      const result = await probeModelReadiness({ ...input, targets: [target('worker1')] }, async () =>
        Response.json({ error: { code, message: 'private secret and URL' } }, { status: 503 }),
      );
      expect(result.evidence.last_probe).toMatchObject({ stage: 'response', code, http_status: 503 });
      expect(result.failureCode).toBe('model_loading');
      expect(JSON.stringify(result.evidence)).not.toMatch(/private|secret|URL/);
    },
  );

  it.each([
    JSON.stringify({ error: { code: 'private-secret-provider-code', message: 'private-secret' } }),
    'not JSON private-secret',
    JSON.stringify({ error: { code: 'model_loading_failed', message: 'x'.repeat(16 * 1024) } }),
  ])('keeps HTTP 503 as the fallback for an untrusted or invalid error body', async (body) => {
    const result = await probeModelReadiness(
      { ...input, targets: [target('worker1')] },
      async () => new Response(body, { status: 503 }),
    );
    expect(result.evidence.last_probe).toMatchObject({
      stage: 'response',
      code: 'model_loading',
      http_status: 503,
    });
    expect(JSON.stringify(result.evidence)).not.toContain('private-secret');
  });

  it('bounds loading-error body reads and preserves the observed HTTP 503 on timeout', async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error('private timeout information')), milliseconds);
      return controller.signal;
    });
    try {
      const pending = probeModelReadiness(
        { ...input, targets: [target('worker1')] },
        async () => new Response(new ReadableStream({ start() {} }), { status: 503 }),
      );
      await vi.advanceTimersByTimeAsync(10_001);
      const result = await pending;
      expect(result.readyReplicas).toBe(0);
      expect(result.evidence.last_probe).toMatchObject({
        stage: 'response',
        code: 'model_loading',
        http_status: 503,
        duration_ms: 10_000,
      });
    } finally {
      timeout.mockRestore();
      vi.useRealTimers();
    }
  });

  it('replaces an old failure with a positive current authenticated model proof', async () => {
    const failed = await probeModelReadiness(
      { ...input, targets: [target('worker1')] },
      async () => new Response(null, { status: 401 }),
    );
    const fetch = vi.fn<typeof modelEndpointFetch>();
    const vanished = await probeModelReadiness({ ...input, targets: [], previous: failed.evidence }, fetch);
    expect(fetch).not.toHaveBeenCalled();
    expect(vanished.readyReplicas).toBe(0);
    expect(vanished.evidence.last_probe).toEqual(failed.evidence.last_probe);
    const ready = await probeModelReadiness(
      { ...input, targets: [target('worker1')], previous: vanished.evidence },
      async () => answer('worker1'),
    );
    expect(ready.readyReplicas).toBe(1);
    expect(ready.evidence.last_probe).toMatchObject({
      stage: 'model_identity',
      code: 'model_ready',
      http_status: 200,
    });
  });

  it.each([true, false])(
    'keeps the actionable failure regardless of authentication completing first: %s',
    async (authFirst) => {
      let finishAuthentication!: (response: Response) => void;
      let finishNetwork!: (response: Response) => void;
      const auth = new Promise<Response>((resolve) => {
        finishAuthentication = resolve;
      });
      const network = new Promise<Response>((resolve) => {
        finishNetwork = resolve;
      });
      const pending = probeModelReadiness(
        { ...input, targets: [target('auth-worker'), target('network-worker')] },
        async (_url, options) =>
          new Headers(options.headers).get('x-worker-id') === 'strict auth-worker' ? auth : network,
      );
      if (authFirst) {
        finishAuthentication(new Response(null, { status: 401 }));
        await Promise.resolve();
        finishNetwork(new Response(null, { status: 503 }));
      } else {
        finishNetwork(new Response(null, { status: 503 }));
        await Promise.resolve();
        finishAuthentication(new Response(null, { status: 401 }));
      }
      const result = await pending;
      expect(result.failureCode).toBe('model_authentication_failed');
      expect(result.evidence.last_probe).toMatchObject({
        stage: 'authentication',
        code: 'model_authentication_failed',
        http_status: 401,
      });
    },
  );

  it('rejects arbitrary diagnostic properties and provider-supplied codes at projection validation', () => {
    const safe = {
      checked_at: new Date().toISOString(),
      stage: 'transport',
      code: 'model_readiness_timeout',
      duration_ms: 10,
    };
    expect(modelReadinessProbeSchema.safeParse(safe).success).toBe(true);
    expect(modelReadinessProbeSchema.safeParse({ ...safe, secret: 'private' }).success).toBe(false);
    expect(modelReadinessProbeSchema.safeParse({ ...safe, code: 'private-provider-code' }).success).toBe(
      false,
    );
    expect(modelReadinessProbeSchema.safeParse({ ...safe, duration_ms: -1 }).success).toBe(false);
  });

  it('proves each worker and model identity rather than multiplying one load-balancer success', async () => {
    const fetch = vi.fn<typeof modelEndpointFetch>(async (_url, options) => {
      const headers = new Headers(options.headers);
      expect(headers.get('authorization')).toBe('Bearer synthetic-account');
      expect(options.method).toBe('GET');
      return answer('worker1');
    });
    const result = await probeModelReadiness(
      { ...input, targets: [target('worker1'), target('worker2')] },
      fetch,
    );
    expect(result.readyReplicas).toBe(1);
    expect(result.failureCode).toBe('model_identity_mismatch');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.evidence?.verified.map((proof) => proof.id)).toEqual(['worker1']);
  });

  it('rejects wrong aliases, authentication, loading and unavailable workers without requests to inference', async () => {
    for (const [response, code] of [
      [() => answer('worker1', 'wrong'), 'model_identity_mismatch'],
      [() => new Response(null, { status: 401 }), 'model_authentication_failed'],
      [() => new Response(null, { status: 503 }), 'model_loading'],
      [
        () => {
          throw new Error('private provider text');
        },
        'model_readiness_unavailable',
      ],
    ] as const) {
      const fetch = vi.fn<typeof modelEndpointFetch>(async () => response());
      const result = await probeModelReadiness({ ...input, targets: [target('worker1')] }, fetch);
      expect(result).toMatchObject({ readyReplicas: 0, failureCode: code });
      expect(fetch.mock.calls.every(([url]) => String(url).endsWith('/v1/models'))).toBe(true);
    }
  });

  it('rotates bounded background probes and retains only current, recent generation proofs', async () => {
    const targets = Array.from({ length: 40 }, (_, index) => target(`worker${index}`));
    const fetch = vi.fn<typeof modelEndpointFetch>(async (_url, options) =>
      answer(new Headers(options.headers).get('x-worker-id')?.slice(7) || ''),
    );
    const first = await probeModelReadiness({ ...input, targets }, fetch);
    expect(first.readyReplicas).toBe(16);
    const next = await probeModelReadiness({ ...input, targets, previous: first.evidence }, fetch);
    expect(next.readyReplicas).toBe(32);
    expect(next.evidence?.cursor).toBe(32);
    const changed = targets.map((value, index) => (index === 0 ? target(value.id, 'restarted') : value));
    const last = await probeModelReadiness({ ...input, targets: changed, previous: next.evidence }, fetch);
    expect(last.readyReplicas).toBe(40);
    expect(last.evidence?.verified.find((proof) => proof.id === 'worker0')?.generation).toBe('restarted');
    const expired = {
      cursor: 0,
      verified: last.evidence?.verified.map((proof) => ({ ...proof, checked_at: Date.now() - 61_000 })),
    };
    const expiredResult = await probeModelReadiness({ ...input, targets, previous: expired }, fetch);
    expect(expiredResult.readyReplicas).toBe(16);
    expect(fetch).toHaveBeenCalledTimes(64);
  });

  it('drops stale or restarted worker proofs before another worker answers', async () => {
    const previous = {
      cursor: 0,
      verified: [
        { id: 'gone', generation: 'old', checked_at: Date.now() },
        { id: 'worker1', generation: 'start1', checked_at: Date.now() },
      ],
    };
    const result = await probeModelReadiness(
      { ...input, previous, targets: [target('worker1', 'restarted')] },
      async () => new Response(null, { status: 503 }),
    );
    expect(result.readyReplicas).toBe(0);
    expect(result.evidence?.verified).toEqual([]);
  });

  it('does not reuse a proof when the provider cannot identify the worker incarnation', async () => {
    const targets = Array.from({ length: 40 }, (_, index) => target(`worker${index}`, index ? 'start1' : ''));
    const fetch: typeof modelEndpointFetch = async (_url, options) =>
      answer(new Headers(options.headers).get('x-worker-id')?.slice(7) || '');
    const first = await probeModelReadiness({ ...input, targets }, fetch);
    expect(first.readyReplicas).toBe(16);
    const next = await probeModelReadiness({ ...input, targets, previous: first.evidence }, fetch);
    expect(next.readyReplicas).toBe(31);
    expect(next.evidence?.verified.some((proof) => proof.id === 'worker0')).toBe(false);
  });

  it('retains a fresh current-worker proof during transport silence without extending its expiry', async () => {
    const checkedAt = Date.now() - 10_000;
    const previous = {
      cursor: 0,
      verified: [{ id: 'worker1', generation: 'start1', checked_at: checkedAt }],
    };
    const fetch: typeof modelEndpointFetch = async () => {
      throw new Error('Synthetic transport timeout behind busy inference');
    };
    const first = await probeModelReadiness({ ...input, targets: [target('worker1')], previous }, fetch);
    expect(first.readyReplicas).toBe(1);
    expect(first.evidence?.verified[0].checked_at).toBe(checkedAt);
    const expired = { ...previous, verified: [{ ...previous.verified[0], checked_at: Date.now() - 61_000 }] };
    expect(
      (await probeModelReadiness({ ...input, targets: [target('worker1')], previous: expired }, fetch))
        .readyReplicas,
    ).toBe(0);
    for (const response of [
      new Response(null, { status: 503 }),
      new Response(null, { status: 401 }),
      new Response(null, { status: 404 }),
      answer('wrong-worker'),
      answer('worker1', 'wrong-model'),
      Response.json({ unexpected: 'shape' }),
    ]) {
      const invalid = await probeModelReadiness(
        { ...input, targets: [target('worker1')], previous },
        async () => response,
      );
      expect(invalid.readyReplicas).toBe(0);
    }
  });

  it('shares one ten-second deadline, bounds concurrency and stops launching after expiry', async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error('synthetic deadline')), milliseconds);
      return controller.signal;
    });
    try {
      let active = 0,
        maximum = 0;
      const signals = new Set<AbortSignal>();
      const fetch = vi.fn<typeof modelEndpointFetch>(async (_url, options) => {
        const signal = options.signal;
        if (!signal) throw new Error('Missing deadline');
        signals.add(signal);
        active++;
        maximum = Math.max(maximum, active);
        try {
          await new Promise<void>((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
          );
        } finally {
          active--;
        }
        return answer('unreachable');
      });
      const pending = probeModelReadiness(
        { ...input, targets: Array.from({ length: 40 }, (_, index) => target(`w${index}`)) },
        fetch,
      );
      await vi.advanceTimersByTimeAsync(10_001);
      const result = await pending;
      expect(result.readyReplicas).toBe(0);
      expect(result.evidence.last_probe).toMatchObject({
        stage: 'transport',
        code: 'model_readiness_timeout',
        duration_ms: 10_000,
      });
      expect(maximum).toBe(16);
      expect(fetch).toHaveBeenCalledTimes(16);
      expect(signals.size).toBe(1);
      expect(result.evidence?.cursor).toBe(16);
    } finally {
      timeout.mockRestore();
      vi.useRealTimers();
    }
  });

  it('qualifies all 1000 healthy workers in three bounded passes within the proof window', async () => {
    const targets = Array.from({ length: 1000 }, (_, index) => target(`worker${index}`));
    let now = Date.now(),
      active = 0,
      maximum = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetch = vi.fn<typeof modelEndpointFetch>(async (_url, options) => {
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active--;
      return answer(new Headers(options.headers).get('x-worker-id')?.slice(7) || '');
    });
    try {
      let previous;
      for (const expected of [334, 668, 1000]) {
        const result = await probeModelReadiness({ ...input, targets, previous }, fetch);
        expect(result.readyReplicas).toBe(expected);
        previous = result.evidence;
        now += 10_000;
      }
      expect(fetch).toHaveBeenCalledTimes(1002);
      expect(maximum).toBe(16);
    } finally {
      clock.mockRestore();
    }
  });

  it('does not multiply duplicate identities or let affinity replace authorization', async () => {
    const candidate = target('worker1');
    candidate.headers.authorization = 'Bearer untrusted';
    const fetch = vi.fn<typeof modelEndpointFetch>(async (_url, options) => {
      expect(new Headers(options.headers).get('authorization')).toBe('Bearer synthetic-account');
      return answer('worker1');
    });
    const result = await probeModelReadiness({ ...input, targets: [candidate, candidate] }, fetch);
    expect(result.readyReplicas).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    candidate.expected_headers = {};
    expect((await probeModelReadiness({ ...input, targets: [candidate] }, fetch)).readyReplicas).toBe(0);
  });
});
