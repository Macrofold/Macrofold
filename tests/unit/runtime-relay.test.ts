import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { runtimeRelay } from '../fixtures/runtime-relay.mjs';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
it('relays only runtime paths to the fixed fixture API and preserves streaming, authorization, and request bodies', async () => {
  const observations: { path: string; token?: string; body: string }[] = [];
  const upstream = createServer(async (request, response) => {
    let body = '';
    for await (const bytes of request) body += bytes;
    observations.push({ path: request.url!, token: request.headers.authorization, body });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: first\n\n');
    setImmediate(() => response.end('data: second\n\n'));
  });
  const relay = runtimeRelay(await listen(upstream));
  try {
    const origin = await listen(relay);
    const path = '/runtime/runs/11111111-1111-4111-8111-111111111111/model/v1/responses';
    const response = await fetch(origin + path, {
      method: 'POST',
      headers: { authorization: 'Bearer fixture-capability' },
      body: '{"input":"synthetic"}',
    });
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(await response.text()).toBe('data: first\n\ndata: second\n\n');
    expect(observations).toEqual([
      { path, token: 'Bearer fixture-capability', body: '{"input":"synthetic"}' },
    ]);
    for (const route of ['/api/v1/runs', '/runtime/runs/../admin', '//example.com/escape']) {
      const denied = await fetch(origin + route);
      expect(denied.status).toBe(404);
      await denied.text();
    }
    expect(observations).toHaveLength(1);
  } finally {
    await close(relay);
    await close(upstream);
  }
});
