import { createServer } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { handleApi } from '../../packages/core/src/http';

/** Loopback transport for SDK acceptance; no alternate API or auth implementation. */
export async function fixtureHttpApi(options: { retainBackground?: boolean } = {}) {
  const tasks = new Set<Promise<void>>();
  const failures: unknown[] = [];
  const background = (task: () => Promise<void>) => {
    const pending = Promise.resolve().then(task);
    tasks.add(pending);
    // Keep the producer alive after response detachment and surface failures at
    // fixture teardown instead of creating unhandled rejections or a false pass.
    void pending.then(
      () => tasks.delete(pending),
      (error) => {
        tasks.delete(pending);
        failures.push(error);
      },
    );
  };
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
      const response = await handleApi(request, 'rest', options.retainBackground ? background : undefined);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body)
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
          .on('error', () => outgoing.destroy())
          .pipe(outgoing);
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
      while (tasks.size) await Promise.allSettled([...tasks]);
      if (failures.length) throw new AggregateError(failures, 'Fixture background work failed');
    },
  };
}
