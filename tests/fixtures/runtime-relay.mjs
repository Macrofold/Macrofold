import { createServer, request } from 'node:http';

/** Test-only bridge: internal containers can reach runtime capabilities, never arbitrary upstream URLs. */
export function runtimeRelay(origin) {
  const target = new URL(origin);
  if (target.protocol !== 'http:') throw new Error('Fixture relay requires a local HTTP origin');
  return createServer((incoming, outgoing) => {
    if (incoming.url === '/health') {
      outgoing.end('ready');
      return;
    }
    if (!/^\/runtime\/runs\/[a-f0-9-]{36}\/(?:model\/[a-zA-Z0-9/_-]+|mcp)$/.test(incoming.url || '')) {
      outgoing.writeHead(404).end();
      incoming.resume();
      return;
    }
    const upstream = request(new URL(incoming.url, target), {
      method: incoming.method,
      headers: { ...incoming.headers, host: target.host },
    });
    upstream.setTimeout(60_000, () => upstream.destroy());
    outgoing.on('close', () => upstream.destroy());
    incoming.on('error', () => upstream.destroy());
    upstream.on('error', () => outgoing.destroy());
    upstream.on('response', (response) => {
      outgoing.writeHead(response.statusCode, response.headers);
      response.on('error', () => outgoing.destroy());
      response.pipe(outgoing);
    });
    incoming.pipe(upstream);
  });
}
