import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as httpFetch } from 'undici';
import { isLocal } from '../../core/src/config';
import { assert } from '../../core/src/errors';

export function validatePublicURL(value: string) {
  return validateURL(value, false);
}

/** Operator-only local exception; never use this policy for webhooks or client metadata.
 * See docs/features/identity-integrations/tools-security.md#local-mcp-servers. */
export function validateMcpURL(value: string) {
  return validateURL(value, true);
}

function localMcpOrigins() {
  if (!isLocal()) return [];
  return (process.env.LOCAL_MCP_ALLOWED_ORIGINS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const url = URL.parse(entry);
      assert(
        url &&
          ['http:', 'https:'].includes(url.protocol) &&
          !url.hostname.includes('*') &&
          !url.username &&
          !url.password &&
          url.pathname === '/' &&
          !url.search &&
          !url.hash,
        503,
        'invalid_local_mcp_origins',
        'Set LOCAL_MCP_ALLOWED_ORIGINS to comma-separated HTTP(S) origins without credentials, paths, queries or fragments.',
      );
      return url.origin;
    });
}

async function validateURL(value: string, mcp: boolean) {
  const url = new URL(value);
  const local = mcp && localMcpOrigins().includes(url.origin);
  assert(
    !url.username &&
      !url.password &&
      (local || (url.protocol === 'https:' && (!url.port || url.port === '443'))),
    400,
    'unsafe_url',
    mcp
      ? 'Use public HTTPS on port 443, or ask your local operator to allow this origin in LOCAL_MCP_ALLOWED_ORIGINS. Embedded credentials are not allowed.'
      : 'Use a public HTTPS endpoint on port 443 without embedded credentials.',
  );
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(host, { all: true, verbatim: true });
  assert(
    addresses.length > 0 &&
      addresses.every((a) => {
        const parsed = ipaddr.process(a.address);
        return local
          ? ['loopback', 'private', 'uniqueLocal'].includes(parsed.range())
          : parsed.range() === 'unicast';
      }),
    400,
    'unsafe_url',
    local
      ? 'An allowed local MCP origin must resolve only to loopback or private addresses; metadata and reserved addresses are not allowed.'
      : 'Private, reserved, or metadata network addresses are not allowed.',
  );
  return { url, addresses };
}
/** Pin the validated DNS result to the actual connection; reject redirects before forwarding credentials. */
export function safeFetch(input: string | URL | Request, init: RequestInit = {}) {
  return fetchValidated(input, init, validatePublicURL);
}
export function mcpFetch(input: string | URL | Request, init: RequestInit = {}) {
  return fetchValidated(input, init, validateMcpURL);
}
async function fetchValidated(
  input: string | URL | Request,
  init: RequestInit,
  validate: typeof validatePublicURL,
) {
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
  const { url, addresses } = await validate(urlString);
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
      response.status < 300 || response.status >= 400 || response.status === 304,
      400,
      'redirect_not_allowed',
      'The endpoint redirected. Configure its final URL.',
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
