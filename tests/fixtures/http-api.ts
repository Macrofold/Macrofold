import { createServer } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { handleApi } from '../../packages/core/src/http';

/** Loopback transport for SDK acceptance; no alternate API or auth implementation. */
export async function fixtureHttpApi() {
  const server = createServer(async (incoming, outgoing) => {
    const abort = new AbortController();
    outgoing.on('close', () => abort.abort());
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers))
        if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      const request = new Request(`http://127.0.0.1${incoming.url}`, {
        method: incoming.method,
        headers,
        signal: abort.signal,
        ...(['GET', 'HEAD'].includes(incoming.method || 'GET')
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
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    origin: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`,
    close: async () => {
      const closed = once(server, 'close');
      server.closeAllConnections();
      server.close();
      await closed;
    },
  };
}
