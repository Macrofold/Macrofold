import { describe, expect, it, vi } from 'vitest';
import { runpodModelHosting, runpodUsdToMicro } from '../../packages/providers/src/runpod-model-hosting';

const image = `registry.example/macrofold-model@sha256:${'a'.repeat(64)}`;
const endpoint = {
  id: 'endpoint1',
  type: 'LOAD_BALANCER',
  image,
  requestUrls: { base: 'https://endpoint1.api.runpod.ai' },
  env: {
    MF_ATTEMPT_ID: 'attempt1',
    MF_REVISION_ID: 'revision1',
    MF_MODEL_CONFIG: '{}',
    MF_ENDPOINT_SECRET: 'private-endpoint-secret',
    HF_TOKEN: 'private-source-token',
  },
  workers: { min: 1, max: 2, idleTimeout: 10 },
  gpu: { pools: ['ADA_24'], count: 1 },
  scaling: { type: 'REQUEST_COUNT', requestCount: 2 },
  timeout: 240000,
  disk: 40,
};
const worker = {
  id: 'worker1',
  status: 'IDLE',
  isStale: false,
  version: 4,
  gpuCount: 1,
  image,
  gpuTypeId: 'NVIDIA RTX 4090',
  dataCenterId: 'US-KS-2',
  startedAt: '2026-10-22T12:00:00Z',
};

describe('RunPod Serverless Load Balancer REST v2', () => {
  it.each([
    [0, '0'],
    [0.69, '690000'],
    [2.72, '2720000'],
    [0.0000001, '1'],
    [1.0000001, '1000001'],
    [1e-20, '1'],
    [1e5, '100000000000'],
  ])('converts decimal USD %j conservatively to %s', (input, expected) => {
    expect(runpodUsdToMicro(input)).toBe(expected);
  });

  it.each([-1, Infinity, NaN, 1e100])('rejects invalid or unrepresentable money %j', (input) => {
    expect(() => runpodUsdToMicro(input)).toThrow();
  });

  it('uses pool rates per single GPU and preserves unknown rates and all GPU alternatives', async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({
        gpus: [
          {
            id: 'gpu1',
            name: '4090',
            pool: 'ADA_24',
            memory: 24,
            price: { serverless: 1.1 },
            dataCenters: [{ id: 'US-KS-2' }],
          },
          { id: 'gpu2', name: 'L4', pool: 'ADA_24', memory: 24, price: { serverless: 0.69 } },
          { id: 'gpu3', name: 'Unknown', pool: 'AMPERE_80', memory: 80, price: {} },
          { id: 'pod-only', name: 'Pod only', pool: null, memory: 24, price: {} },
        ],
      }),
    );
    const result = await runpodModelHosting(transport).catalog('account-secret');
    expect(result).toEqual([
      {
        id: 'gpu1',
        name: '4090',
        pool: 'ADA_24',
        memory_bytes: '25769803776',
        hourly_micro_usd: '1100000',
        region_ids: ['US-KS-2'],
      },
      {
        id: 'gpu2',
        name: 'L4',
        pool: 'ADA_24',
        memory_bytes: '25769803776',
        hourly_micro_usd: '690000',
        region_ids: [],
      },
      {
        id: 'gpu3',
        name: 'Unknown',
        pool: 'AMPERE_80',
        memory_bytes: '85899345920',
        hourly_micro_usd: null,
        region_ids: [],
      },
    ]);
    expect(transport.mock.calls[0][0]).toBe(
      'https://api.runpod.io/v2/catalog/gpus?include=AVAILABILITY&product=SERVERLESS',
    );
    expect(transport.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      headers: { authorization: 'Bearer account-secret' },
    });
  });

  it('creates exactly once through the owned immutable load-balancer configuration', async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json(endpoint, { status: 201 }));
    const provider = runpodModelHosting(transport);
    const input = {
      name: 'fixture',
      type: 'LOAD_BALANCER',
      image,
      env: { MF_ATTEMPT_ID: 'attempt1' },
      cmd: ['python3', '/opt/macrofold-model/server.py'],
      workers: { min: 1, max: 2 },
      gpu: { pools: ['ADA_24'], count: 1 },
    };
    expect(await provider.create('account-secret', input)).toEqual({
      id: 'endpoint1',
      endpoint_url: 'https://endpoint1.api.runpod.ai',
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1]?.method).toBe('POST');
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual(input);
    await expect(provider.create('account-secret', { ...input, templateId: 'shared' })).rejects.toThrow();
    await expect(provider.create('account-secret', { ...input, image: 'mutable:latest' })).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('never retries a create whose acknowledgment was lost', async () => {
    const transport = vi.fn<typeof fetch>(async () => {
      throw new Error('lost acknowledgement');
    });
    await expect(
      runpodModelHosting(transport).create('account-secret', { type: 'LOAD_BALANCER', image }),
    ).rejects.toThrow('lost acknowledgement');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rejects serving origins outside the exact provider endpoint and does not leak secrets in failures', async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({ ...endpoint, requestUrls: { base: 'https://attacker.invalid' } }, { status: 201 }),
    );
    await expect(
      runpodModelHosting(transport).create('secret', { type: 'LOAD_BALANCER', image }),
    ).rejects.toThrow('invalid serving origin');
    const failed = vi.fn<typeof fetch>(async () =>
      Response.json({ env: { HF_TOKEN: 'DO NOT LOG' } }, { status: 403 }),
    );
    await expect(runpodModelHosting(failed).catalog('secret')).rejects.toThrow(
      'RunPod management request failed (403).',
    );
  });

  it('counts only current compatible healthy workers and projects no source/endpoint secrets', async () => {
    const transport = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/workers')
        ? Response.json({
            endpointVersion: 4,
            workers: [
              worker,
              { ...worker, id: 'stale', isStale: true },
              { ...worker, id: 'wrongimage', image: 'different-image' },
              { ...worker, id: 'oldversion', version: 3 },
              { ...worker, id: 'initializing', status: 'INITIALIZING' },
              { ...worker, id: 'unhealthy', status: 'UNHEALTHY' },
              { ...worker, id: 'wronggpu', gpuCount: 2 },
            ],
          })
        : Response.json(endpoint),
    );
    const result = await runpodModelHosting(transport).inspect('secret', 'endpoint1');
    expect(result?.ready_replicas).toBe(1);
    expect(result?.workers[0]).toEqual({
      id: 'worker1',
      pool: null,
      started_at: worker.startedAt,
      stopped_at: null,
    });
    expect(result?.config.env).toEqual({
      MF_ATTEMPT_ID: 'attempt1',
      MF_REVISION_ID: 'revision1',
      MF_MODEL_CONFIG: '{}',
    });
    expect(JSON.stringify(result)).not.toContain('private-');
  });

  it('only a real endpoint 404 establishes absence; permission and provider failures remain unknown', async () => {
    for (const status of [403, 429, 503]) {
      const transport = vi.fn<typeof fetch>(async () => new Response(null, { status }));
      await expect(runpodModelHosting(transport).inspect('secret', 'endpoint1')).rejects.toThrow();
    }
    const missing = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    expect(await runpodModelHosting(missing).inspect('secret', 'endpoint1')).toBeNull();
    expect(missing).toHaveBeenCalledTimes(1);
  });

  it('reconciles every bounded inventory page by exact attempt correlation, retaining duplicate matches', async () => {
    const transport = vi.fn<typeof fetch>(async (url) =>
      String(url).includes('cursor=next')
        ? Response.json({
            endpoints: [
              { ...endpoint, id: 'endpoint2', requestUrls: { base: 'https://endpoint2.api.runpod.ai' } },
            ],
            pagination: { nextCursor: null, hasNextPage: false },
          })
        : Response.json({
            endpoints: [{ id: 'unrelated', type: 'QUEUE', env: { MF_ATTEMPT_ID: 'unrelated' } }, endpoint],
            pagination: { nextCursor: 'next', hasNextPage: true },
          }),
    );
    expect(await runpodModelHosting(transport).findAttempt('secret', 'attempt1')).toEqual([
      { id: 'endpoint1', endpoint_url: 'https://endpoint1.api.runpod.ai' },
      { id: 'endpoint2', endpoint_url: 'https://endpoint2.api.runpod.ai' },
    ]);
    expect(transport).toHaveBeenCalledTimes(2);
    const empty = vi.fn<typeof fetch>(async () =>
      Response.json({ endpoints: [], pagination: { nextCursor: null, hasNextPage: false } }),
    );
    expect(await runpodModelHosting(empty).findAttempt('secret', 'attempt1')).toEqual([]);
    expect(empty).toHaveBeenCalledTimes(1);
  });

  it('rejects incomplete inventory pagination without interpreting it as absence', async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({ endpoints: [], pagination: { nextCursor: 'same', hasNextPage: true } }),
    );
    await expect(runpodModelHosting(transport).findAttempt('secret', 'attempt1')).rejects.toThrow(
      'pagination',
    );
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('permits independent DELETE after failed scale-down and treats DELETE 404 as already removed', async () => {
    const transport = vi.fn<typeof fetch>(
      async (_url, options) => new Response(null, { status: options?.method === 'PATCH' ? 503 : 204 }),
    );
    const provider = runpodModelHosting(transport);
    await expect(provider.update('secret', 'endpoint1', { workers: { min: 0, max: 0 } })).rejects.toThrow();
    await provider.delete('secret', 'endpoint1');
    expect(transport.mock.calls.map((call) => call[1]?.method)).toEqual(['PATCH', 'DELETE']);
    await expect(provider.update('secret', 'endpoint1', { image })).rejects.toThrow('drain');
    const gone = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    await runpodModelHosting(gone).delete('secret', 'endpoint1');
  });

  it('reads resource/hour billing once without adding overlapping metadata or component totals', async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({
        records: [
          {
            serverlessId: 'endpoint1',
            startTime: '2026-10-22T12:00:00Z',
            endTime: '2026-10-22T13:00:00Z',
            totalAmount: 0.6900001,
            gpuAmount: 0.68,
            diskAmount: 0.01,
            cpuAmount: 0,
            feeAmount: 0,
          },
        ],
        metadata: { totals: { totalAmount: 0.6900001 } },
      }),
    );
    expect(
      await runpodModelHosting(transport).costs(
        'secret',
        'endpoint1',
        '2026-10-22T12:00:00Z',
        '2026-10-22T13:00:00Z',
      ),
    ).toEqual([{ start: '2026-10-22T12:00:00Z', end: '2026-10-22T13:00:00Z', micro_usd: '690001' }]);
    const url = new URL(String(transport.mock.calls[0][0]));
    expect(url.searchParams.get('serverlessId')).toBe('endpoint1');
    expect(url.searchParams.get('bucketSize')).toBe('hour');
  });

  it('rejects billing belonging to another resource and duplicate buckets', async () => {
    const record = {
      serverlessId: 'endpoint1',
      startTime: '2026-10-22T12:00:00Z',
      endTime: '2026-10-22T13:00:00Z',
      totalAmount: 1,
    };
    for (const records of [[{ ...record, serverlessId: 'foreign' }], [record, record]]) {
      const transport = vi.fn<typeof fetch>(async () => Response.json({ records }));
      await expect(
        runpodModelHosting(transport).costs('secret', 'endpoint1', record.startTime, record.endTime),
      ).rejects.toThrow('invalid resource or duplicate');
    }
  });
});
