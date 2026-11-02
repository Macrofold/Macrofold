import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

/** Real loopback HTTP with the inspected vendor wire shapes. This proves our
 * transport/lifecycle, not an installed vendor server or model quality. */
export async function memoryServiceFixture(provider: 'hindsight' | 'claude-mem') {
  const requests: { path: string; method: string; body: Record<string, unknown> }[] = [];
  const documents = new Map<string, string>();
  const jobs = new Map<string, { status: string }>();
  let recallMetadata: Record<string, unknown> = {};
  let failStatus = 0,
    loseCapture = false,
    recallFailure = false,
    oversized = false,
    recallDelay = 0,
    loseRecall = false;
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== 'Bearer fixture-memory-key') {
      response.writeHead(401).end('fixture denied');
      return;
    }
    let bytes = '';
    for await (const chunk of request) bytes += String(chunk);
    const body = bytes ? (JSON.parse(bytes) as Record<string, unknown>) : {};
    const path = request.url || '/';
    requests.push({ path, method: request.method || 'GET', body });
    if (failStatus) {
      const status = failStatus;
      failStatus = 0;
      response.writeHead(status).end('untrusted error containing Bearer do-not-expose');
      return;
    }
    if (path.includes('recall') || path === '/v1/context') {
      if (recallDelay) await new Promise((resolve) => setTimeout(resolve, recallDelay));
      if (loseRecall) {
        loseRecall = false;
        response.destroy();
        return;
      }
      if (recallFailure) {
        response.writeHead(503).end('fixture unavailable');
        return;
      }
      if (oversized) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ results: [{ id: 'too-large', text: 'x'.repeat(2 * 1024 * 1024) }] }));
        return;
      }
    }
    const json = (value: unknown, status = 200) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    const memories = [...documents.entries()].map(([id, text]) => ({ id, text }));
    if (request.method === 'DELETE') {
      documents.clear();
      jobs.clear();
      json(
        provider === 'claude-mem'
          ? { purged: true, counts: { observations: memories.length, agentEvents: memories.length, jobs: 0 } }
          : { success: true },
      );
      return;
    }
    if (provider === 'hindsight') {
      if (path.endsWith('/memories/recall')) {
        json({
          results: memories.map((memory) => ({ ...memory, document_id: memory.id, ...recallMetadata })),
          usage: { input_tokens: 3, output_tokens: 5, cost_micro_usd: '17' },
        });
        return;
      }
      if (path.endsWith('/memories') && request.method === 'POST') {
        const source = (body.items as { document_id: string; content: string }[])[0];
        documents.set(source.document_id, source.content);
        jobs.set(String(body.operation_id), { status: 'completed' });
        if (loseCapture) {
          loseCapture = false;
          response.destroy();
          return;
        }
        json({ operation_id: body.operation_id, async: true });
        return;
      }
      if (path.includes('/operations/')) {
        const id = path.split('/').at(-1)!;
        const job = jobs.get(id);
        if (!job) {
          response.writeHead(404).end();
          return;
        }
        json({ ...job, usage: { input_tokens: 5, output_tokens: 2 } });
        return;
      }
      if (
        (request.method === 'PUT' && /^\/v1\/default\/banks\/[^/]+$/.test(path)) ||
        path.endsWith('/stats')
      ) {
        json({ bank_id: 'fixture-bank' });
        return;
      }
      response.writeHead(404).end();
      return;
    }
    if (/^\/v1\/projects\/[^/]+\/jobs\?limit=1$/.test(path)) {
      json({ jobs: [], total: 0, limit: 1, offset: 0 });
      return;
    }
    if (path === '/v1/context') {
      json({
        observations: memories.map((item) => ({
          id: item.id,
          content: item.text,
          projectId: body.projectId,
          ...recallMetadata,
        })),
        context: memories.map((item) => item.text).join('\n'),
        count: memories.length,
      });
      return;
    }
    if (path.startsWith('/v1/events?')) {
      const id = randomUUID();
      documents.set(String(body.contentSessionId), JSON.stringify(body.payload));
      jobs.set(id, { status: 'completed' });
      if (loseCapture) {
        loseCapture = false;
        response.destroy();
        return;
      }
      json({ event: { id: randomUUID() }, generationJob: { id, status: 'queued' } }, 201);
      return;
    }
    if (path.startsWith('/v1/jobs/')) {
      const job = jobs.get(path.split('/').at(-1)!);
      if (!job) {
        response.writeHead(404).end();
        return;
      }
      json({ generationJob: { ...job, usage: { input_tokens: 4, output_tokens: 2 } } });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    documents,
    jobs,
    failNext: (status: number) => {
      failStatus = status;
    },
    loseNextCapture: () => {
      loseCapture = true;
    },
    failRecall: (value: boolean) => {
      recallFailure = value;
    },
    setRecallMetadata: (value: Record<string, unknown>) => {
      recallMetadata = value;
    },
    delayRecall: (ms: number) => {
      recallDelay = ms;
    },
    loseNextRecall: () => {
      loseRecall = true;
    },
    oversizedRecall: () => {
      oversized = true;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
