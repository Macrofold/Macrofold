import { describe, expect, it, vi } from 'vitest';
import { probeModelReadiness } from '../../packages/core/src/model-deployment-readiness';
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
