import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MemoryService } from '../../packages/providers/src/memory-service';
import { memoryServiceFixture } from '../fixtures/memory-service';

const open: Awaited<ReturnType<typeof memoryServiceFixture>>[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((fixture) => fixture.close()));
});
for (const provider of ['hindsight', 'claude-mem'] as const)
  describe(provider, () => {
    it('uses authenticated real HTTP for namespace setup, committed capture, polling, recall and full purge', async () => {
      const fixture = await memoryServiceFixture(provider);
      open.push(fixture);
      const service = new MemoryService(
        {
          provider,
          baseURL: fixture.baseURL,
          namespace: 'dedicated-fixture',
          headers: { Authorization: 'Bearer fixture-memory-key' },
        },
        fetch,
      );
      await service.initialize();
      const operation = randomUUID();
      const captured = await service.capture(
        'source-fixture',
        'Synthetic preference: concise summaries.',
        operation,
        new Date('2026-11-01T00:00:00Z'),
      );
      expect(captured.state).toBe('pending');
      expect((await service.poll(captured.operation_id!)).state).toBe('complete');
      const recall = await service.recall('preference');
      expect(recall.text).toContain('concise summaries');
      expect(recall.receipt.external_cost_micro_usd).toBe(provider === 'hindsight' ? '17' : null);
      await service.purge();
      expect(fixture.documents.size).toBe(0);
      if (provider === 'claude-mem') {
        const capture = fixture.requests.find((item) => item.path.startsWith('/v1/events?'))!;
        expect(capture.path).toContain('wait=false');
        expect(capture.body).toMatchObject({
          projectId: 'dedicated-fixture',
          sourceType: 'api',
          eventType: 'conversation.completed',
        });
        expect(fixture.requests.at(-1)?.path).toBe('/v1/projects/dedicated-fixture/memory');
      }
    });
    it('preserves authentication failure classification without returning untrusted response text', async () => {
      const fixture = await memoryServiceFixture(provider);
      open.push(fixture);
      const service = new MemoryService(
        {
          provider,
          baseURL: fixture.baseURL,
          namespace: 'dedicated-fixture',
          headers: { Authorization: 'Bearer incorrect-fixture-key' },
        },
        fetch,
      );
      await expect(service.probe()).rejects.toMatchObject({ code: 'memory_service_http_401' });
    });
  });

it('stops reading an oversized provider body and never injects oversized facts', async () => {
  const fixture = await memoryServiceFixture('hindsight');
  open.push(fixture);
  fixture.oversizedRecall();
  const service = new MemoryService(
    {
      provider: 'hindsight',
      baseURL: fixture.baseURL,
      namespace: 'dedicated-fixture',
      headers: { Authorization: 'Bearer fixture-memory-key' },
    },
    fetch,
  );
  await expect(service.recall('fixture')).rejects.toMatchObject({ code: 'body_too_large' });
});

it('performs one capture attempt when Claude-mem loses its acknowledgement', async () => {
  const fixture = await memoryServiceFixture('claude-mem');
  open.push(fixture);
  fixture.loseNextCapture();
  const service = new MemoryService(
    {
      provider: 'claude-mem',
      baseURL: fixture.baseURL,
      namespace: 'dedicated-fixture',
      headers: { Authorization: 'Bearer fixture-memory-key' },
    },
    fetch,
  );
  await expect(service.capture('source', 'Synthetic note.', randomUUID(), new Date())).rejects.toThrow();
  expect(fixture.requests.filter((item) => item.path.startsWith('/v1/events?'))).toHaveLength(1);
});

it('keeps both roles and the final outcome inside Claude-mem generation bounds', async () => {
  const fixture = await memoryServiceFixture('claude-mem');
  open.push(fixture);
  const service = new MemoryService(
    {
      provider: 'claude-mem',
      baseURL: fixture.baseURL,
      namespace: 'dedicated-fixture',
      headers: { Authorization: 'Bearer fixture-memory-key' },
    },
    fetch,
  );
  await service.capture(
    'source-long-fixture',
    JSON.stringify({
      user: 'User context '.repeat(20000),
      assistant: 'Final outcome: approval was requested.',
    }),
    randomUUID(),
    new Date(),
  );
  const capture = fixture.requests.find((request) => request.path.startsWith('/v1/events?'))!;
  expect(Buffer.byteLength(JSON.stringify(capture.body.payload, null, 2))).toBeLessThanOrEqual(14 * 1024);
  expect(JSON.stringify(capture.body.payload)).toContain('Final outcome: approval was requested.');
  expect(JSON.stringify(capture.body.payload)).toContain('excerpt; full source:');
  expect(JSON.stringify(capture.body.payload)).toContain('source-long-fixture');
});

for (const provider of ['hindsight', 'claude-mem'] as const)
  it(`${provider}: preserves the actual task at the tail of a long recall prompt`, async () => {
    const fixture = await memoryServiceFixture(provider);
    open.push(fixture);
    const service = new MemoryService(
      {
        provider,
        baseURL: fixture.baseURL,
        namespace: 'dedicated-fixture',
        headers: { Authorization: 'Bearer fixture-memory-key' },
      },
      fetch,
    );
    await service.recall(
      'Instructions: prefer evidence. '.repeat(1000) + 'Current task: choose a quick meal.',
    );
    const query = fixture.requests.find(
      (request) => request.path.includes('recall') || request.path === '/v1/context',
    )!.body.query as string;
    expect(query.length).toBeLessThanOrEqual(4096);
    expect(query).toContain('Instructions: prefer evidence.');
    expect(query).toContain('Current task: choose a quick meal.');
    expect(query).toContain('middle omitted');
  });

it('bounds the complete encoded recall envelope, including multibyte content and freshness metadata', async () => {
  const fixture = await memoryServiceFixture('hindsight');
  open.push(fixture);
  for (let i = 0; i < 3; i++) fixture.documents.set(`memory-${i}`, '𐍈'.repeat(2500));
  const service = new MemoryService(
    {
      provider: 'hindsight',
      baseURL: fixture.baseURL,
      namespace: 'dedicated-fixture',
      headers: { Authorization: 'Bearer fixture-memory-key' },
    },
    fetch,
  );
  const result = await service.recall('Synthetic preference');
  expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(16384);
  expect(JSON.parse(result.text).omitted).toBeGreaterThan(0);
  expect(JSON.parse(result.text).capture_freshness).toContain('asynchronous');
});

it('redacts private sections and recognized credentials before either recall projection or capture', async () => {
  const fixture = await memoryServiceFixture('hindsight');
  open.push(fixture);
  const service = new MemoryService(
    {
      provider: 'hindsight',
      baseURL: fixture.baseURL,
      namespace: 'dedicated-fixture',
      headers: { Authorization: 'Bearer fixture-memory-key' },
    },
    fetch,
  );
  await service.recall(
    'Remember confirmed preference. <private>private-fixture-value</private> Bearer synthetic-private-token <private>unfinished-private-tail',
  );
  const query = fixture.requests.find((request) => request.path.includes('recall'))!.body.query as string;
  expect(query).toContain('Remember confirmed preference.');
  expect(query).not.toContain('private-fixture-value');
  expect(query).not.toContain('synthetic-private-token');
  expect(query).not.toContain('unfinished-private-tail');
  expect(query).toContain('[redacted]');
});

it('keeps Unicode engineering outcomes and provenance within the full encoded provider payload budget', async () => {
  const fixture = await memoryServiceFixture('claude-mem');
  open.push(fixture);
  const service = new MemoryService(
    {
      provider: 'claude-mem',
      baseURL: fixture.baseURL,
      namespace: 'dedicated-fixture',
      headers: { Authorization: 'Bearer fixture-memory-key' },
    },
    fetch,
  );
  const source = {
    kind: 'engineering-history',
    source_run_id: 'synthetic-run',
    user: '世界'.repeat(12000),
    assistant: 'Final outcome: cancelled before Apply.',
    run_outcome: { status: 'cancelled', partial: true },
    provenance: { verified_checkpoint_id: null, git_commit: null },
    tool_outcomes: Array.from({ length: 32 }, (_, i) => ({
      source_event_id: String(i),
      name: 'validate_recipe',
      reported_outcome: 'unknown',
      effect_verified: false,
    })),
  };
  await service.capture('synthetic-source', JSON.stringify(source), randomUUID(), new Date());
  const payload = fixture.requests.find((request) => request.path.startsWith('/v1/events?'))!.body.payload;
  expect(Buffer.byteLength(JSON.stringify(payload, null, 2))).toBeLessThanOrEqual(14 * 1024);
  expect(JSON.stringify(payload)).toContain('cancelled before Apply');
  expect(payload).toMatchObject({
    engineering: { run_outcome: { status: 'cancelled', partial: true }, provider_tool_outcomes_omitted: 24 },
  });
});

it('preserves bounded Hindsight source/time references without arbitrary metadata or false execution proof', async () => {
  const fixture = await memoryServiceFixture('hindsight');
  open.push(fixture);
  fixture.documents.set('derived-fact', 'Confirmed fact. <private>private-recalled-fixture</private>');
  fixture.setRecallMetadata({
    document_id: '12345678-1234-4234-9234-123456789abc',
    chunk_id: 'chunk-1',
    type: 'world',
    occurred_start: '2026-11-01T00:00:00Z',
    occurred_end: null,
    mentioned_at: '2026-11-01T01:00:00Z',
    source_fact_ids: Array.from({ length: 12 }, (_, i) => `source-${i}`),
    metadata: { secret: 'metadata-must-not-transfer' },
  });
  const service = new MemoryService(
    {
      provider: 'hindsight',
      baseURL: fixture.baseURL,
      namespace: 'dedicated-fixture',
      headers: { Authorization: 'Bearer fixture-memory-key' },
    },
    fetch,
  );
  const result = await service.recall('fact');
  const memory = JSON.parse(result.text).memories[0];
  expect(memory.provenance).toMatchObject({
    provider_reported: true,
    document_id: '12345678-1234-4234-9234-123456789abc',
    chunk_id: 'chunk-1',
    occurred_start: '2026-11-01T00:00:00.000Z',
    occurred_end: null,
    source_fact_ids_omitted: 4,
  });
  expect(memory.provenance.source_fact_ids).toHaveLength(8);
  expect(result.text).not.toContain('metadata-must-not-transfer');
  expect(result.text).not.toContain('private-recalled-fixture');
});

it('retains available hosted Claude observation/session dates and explicit unknown source event', async () => {
  const fixture = await memoryServiceFixture('claude-mem');
  open.push(fixture);
  fixture.documents.set('observation-1', 'Confirmed observation');
  fixture.setRecallMetadata({
    projectId: 'dedicated-fixture',
    serverSessionId: 'server-session',
    contentSessionId: 'capture-source',
    kind: 'discovery',
    createdAtEpoch: 1793491200000,
    updatedAtEpoch: 'not-a-time',
    metadata: { source_run_id: 'untrusted-claimed-run' },
  });
  const service = new MemoryService(
    {
      provider: 'claude-mem',
      baseURL: fixture.baseURL,
      namespace: 'dedicated-fixture',
      headers: { Authorization: 'Bearer fixture-memory-key' },
    },
    fetch,
  );
  const result = await service.recall('fact');
  const memory = JSON.parse(result.text).memories[0];
  expect(memory.provenance).toMatchObject({
    provider_reported: true,
    project_id: 'dedicated-fixture',
    server_session_id: 'server-session',
    content_session_id: 'capture-source',
    created_at: new Date(1793491200000).toISOString(),
    updated_at: null,
    source_event_id: null,
  });
  expect(result.text).not.toContain('untrusted-claimed-run');
  fixture.setRecallMetadata({ projectId: 'other-project' });
  await expect(service.recall('fact')).rejects.toMatchObject({ code: 'memory_service_response_invalid' });
});
