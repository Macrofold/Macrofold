import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as httpFetch } from 'undici';
import { assert } from '../../core/src/errors';

export async function validatePublicURL(value: string) {
  const url = new URL(value);
  assert(
    url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443'),
    400,
    'unsafe_url',
    'Use a public HTTPS endpoint on port 443 without embedded credentials.',
  );
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(host, { all: true, verbatim: true });
  assert(
    addresses.length > 0 &&
      addresses.every((a) => {
        const parsed = ipaddr.process(a.address);
        return parsed.range() === 'unicast';
      }),
    400,
    'unsafe_url',
    'Private, reserved, or metadata network addresses are not allowed.',
  );
  return { url, addresses };
}
/** Pin the validated DNS result to the actual connection; reject redirects before forwarding credentials. */
export async function safeFetch(input: string | URL | Request, init: RequestInit = {}) {
  if (input instanceof Request)
    init = {
      method: input.method,
      headers: input.headers,
      signal: input.signal,
      ...init,
      ...(!init.body && !['GET', 'HEAD'].includes(init.method || input.method)
        ? { body: await input.arrayBuffer() }
        : {}),
    };
  const urlString = input instanceof Request ? input.url : String(input);
  const { url, addresses } = await validatePublicURL(urlString);
  const address = addresses[0];
  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        if (typeof options === 'object' && options.all)
          callback(null, [{ address: address.address, family: address.family }]);
        else callback(null, address.address, address.family);
      },
    },
  });
  try {
    const response = await httpFetch(url, {
      method: init.method || 'GET',
      headers: init.headers as Record<string, string>,
      body: init.body as string | Uint8Array | undefined,
      signal: AbortSignal.any([AbortSignal.timeout(50000), ...(init.signal ? [init.signal] : [])]),
      redirect: 'manual',
      dispatcher,
    });
    assert(
      response.status < 300 || response.status >= 400,
      400,
      'redirect_not_allowed',
      'The endpoint redirected. Configure its final HTTPS URL.',
    );
    const reader = response.body?.getReader();
    let size = 0;
    if (!reader || [204, 205, 304].includes(response.status)) {
      await response.body?.cancel();
      await dispatcher.close();
      return new Response(null, { status: response.status, headers: Object.fromEntries(response.headers) });
    }
    // MCP may keep its SSE connection open after returning the requested message.
    // Forward frames immediately; closing the MCP client cancels the underlying socket.
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const part = await reader.read();
          if (part.done) {
            controller.close();
            await dispatcher.close();
            return;
          }
          size += part.value.length;
          assert(size <= 16 * 1024 * 1024, 413, 'response_too_large', 'The remote response exceeds 16 MiB.');
          controller.enqueue(part.value);
        } catch (error) {
          controller.error(error);
          await reader.cancel().catch(() => {});
          await dispatcher.destroy();
        }
      },
      async cancel() {
        await reader.cancel().catch(() => {});
        await dispatcher.destroy();
      },
    });
    return new Response(stream, { status: response.status, headers: Object.fromEntries(response.headers) });
  } catch (error) {
    await dispatcher.destroy();
    throw error;
  }
}
