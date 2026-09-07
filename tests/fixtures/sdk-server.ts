import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { handleApi } from '../../packages/core/src/http';
import { config, isLocal } from '../../packages/core/src/config';

// The actual API boundary on loopback, with a separately running simulator worker.
if (!isLocal() || config.allowPaid || config.execution !== 'simulator')
  throw new Error('SDK acceptance requires unpaid simulation.');
createServer(async (incoming, outgoing) => {
  const abort = new AbortController();
  outgoing.on('close', () => abort.abort());
  try {
    if (incoming.url === '/health') {
      outgoing.end('ready');
      return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers))
      if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    const request = new Request(new URL(incoming.url!, config.origin), {
      method: incoming.method,
      headers,
      signal: abort.signal,
      ...(incoming.method === 'GET' || incoming.method === 'HEAD'
        ? {}
        : { body: Readable.toWeb(incoming), duplex: 'half' }),
    } as RequestInit);
    const response = await handleApi(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body)
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream).pipe(outgoing);
    else outgoing.end();
  } catch {
    outgoing.destroy();
  }
}).listen(Number(new URL(config.origin).port), '127.0.0.1');
