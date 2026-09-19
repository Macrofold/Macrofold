import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { startModelTransport } from '../../packages/runtime/src/model-transport';
import { encryptModelBody, decryptModelBody, modelTransport } from '../../packages/contracts/model-transport';

const servers: Awaited<ReturnType<typeof startModelTransport>>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
const signal = () => new AbortController().signal;
async function start(transport: typeof fetch) {
  const server = await startModelTransport(
    'https://gateway.example.test/runtime/runs/fixture/model',
    'fixture-token',
    signal(),
    transport,
  );
  servers.push(server);
  return server;
}
const post = (url: string, body: string, headers: Record<string, string> = {}) =>
  fetch(url, { method: 'POST', body, headers: { authorization: 'Bearer fixture-token', ...headers } });
describe('model request transport', () => {
  it('encrypts before staging and fails closed on a wrong key or tampered payload', async () => {
    const bytes = new TextEncoder().encode('private fixture prompt'),
      key = new Uint8Array(randomBytes(32));
    const encrypted = await encryptModelBody(bytes, key);
    expect(encrypted.length).toBe(bytes.length + modelTransport.encryptedOverhead);
    expect(Buffer.from(encrypted).includes('private fixture')).toBe(false);
    expect(await decryptModelBody(encrypted, key)).toEqual(bytes);
    await expect(decryptModelBody(encrypted, new Uint8Array(randomBytes(32)))).rejects.toThrow();
    encrypted[15] ^= 1;
    await expect(decryptModelBody(encrypted, key)).rejects.toThrow();
  });
  it('forwards small requests and provider streaming, including Claude query strings', async () => {
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe('https://gateway.example.test/runtime/runs/fixture/model/v1/messages');
      expect(new Headers(init?.headers).get('anthropic-beta')).toBe('fixture');
      expect(Buffer.from(init?.body as Uint8Array).toString()).toBe('{"messages":[]}');
      return new Response('data: {"type":"message_stop"}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    const server = await start(transport);
    const response = await post(`${server.url}/v1/messages?beta=true`, '{"messages":[]}', {
      'anthropic-beta': 'fixture',
    });
    expect(await response.text()).toContain('message_stop');
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('moves a >4.5 MB body directly to encrypted storage and sends only a bound reference through the gateway', async () => {
    const body = JSON.stringify({ input: randomBytes(4 * 1024 * 1024).toString('base64') });
    const key = randomBytes(32);
    let encrypted: Uint8Array<ArrayBuffer> | undefined;
    const observations: string[] = [];
    const transport: typeof fetch = async (url, init) => {
      observations.push(String(url));
      if (String(url).endsWith('/_uploads')) {
        expect(Buffer.byteLength(String(init?.body))).toBeLessThan(1024);
        expect(JSON.parse(String(init?.body))).toEqual({
          size: Buffer.byteLength(body),
          sha256: createHash('sha256').update(body).digest('hex'),
          path: 'v1/responses',
        });
        return Response.json({
          url: 'https://objects.example.test/fixture',
          headers: { 'Content-Type': 'application/octet-stream' },
          token: 'opaque-fixture-claim',
          encryption_key: key.toString('base64'),
        });
      }
      if (String(url).startsWith('https://objects.')) {
        expect(init?.method).toBe('PUT');
        expect(new Headers(init?.headers).has('authorization')).toBe(false);
        encrypted = init?.body as Uint8Array<ArrayBuffer>;
        expect(Buffer.from(await decryptModelBody(encrypted, new Uint8Array(key))).toString()).toBe(body);
        return new Response(null, { status: 204 });
      }
      expect(encrypted).toBeDefined();
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).get(modelTransport.uploadHeader)).toBe('opaque-fixture-claim');
      return Response.json({ output: 'accepted' });
    };
    const server = await start(transport);
    expect(await (await post(`${server.url}/v1/responses`, body)).json()).toEqual({ output: 'accepted' });
    expect(observations).toHaveLength(3);
  });
  it('rejects oversized full context before any network request and does not retry failed staging', async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json({ error: 'denied' }, { status: 403 }));
    const server = await start(transport);
    const response = await post(`${server.url}/v1/responses`, 'x'.repeat(modelTransport.maximumBytes + 1));
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe('model_request_too_large');
    expect(transport).not.toHaveBeenCalled();
    expect(
      (await post(`${server.url}/v1/responses`, 'x'.repeat(modelTransport.inlineBytes + 1))).status,
    ).toBe(403);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects arbitrary paths and missing capabilities without opening an upstream request', async () => {
    const transport = vi.fn<typeof fetch>();
    const server = await start(transport);
    expect((await post(`${server.url}/https://attacker.invalid`, '{}')).status).toBe(403);
    expect((await fetch(`${server.url}/v1/responses`, { method: 'POST', body: '{}' })).status).toBe(403);
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('resident worker transport authority', () => {
  it('uses the current run capability for models and tools, and rejects idle requests', async () => {
    let active: { gatewayURL: string; toolURL: string; token: string; signal: AbortSignal } | undefined;
    const seen: { url: string; token: string | null }[] = [];
    const transport: typeof fetch = async (url, init) => {
      seen.push({ url: String(url), token: new Headers(init?.headers).get('authorization') });
      return Response.json({ ok: true });
    };
    const server = await startModelTransport(
      'https://unused.test',
      'fixture-token',
      signal(),
      transport,
      () => active,
    );
    servers.push(server);
    expect((await post(`${server.url}/v1/responses`, '{}')).status).toBe(409);
    for (const turn of ['first', 'second']) {
      const abort = new AbortController();
      active = {
        gatewayURL: `https://gateway.test/${turn}`,
        toolURL: `https://tools.test/${turn}`,
        token: turn,
        signal: abort.signal,
      };
      expect((await post(`${server.url}/v1/responses`, '{}')).status).toBe(200);
      expect((await post(`${server.url}/mcp`, '{}')).status).toBe(200);
      abort.abort();
      expect((await post(`${server.url}/mcp`, '{}')).status).toBe(409);
      active = undefined;
    }
    expect(seen).toEqual([
      { url: 'https://gateway.test/first/v1/responses', token: 'Bearer first' },
      { url: 'https://tools.test/first', token: 'Bearer first' },
      { url: 'https://gateway.test/second/v1/responses', token: 'Bearer second' },
      { url: 'https://tools.test/second', token: 'Bearer second' },
    ]);
  });
  it('aborts an in-flight old request without retrying it under the next run', async () => {
    const first = new AbortController(),
      second = new AbortController();
    let active = { gatewayURL: 'https://gateway.test/first', token: 'first', signal: first.signal };
    let onEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      onEntered = resolve;
    });
    const transport = vi.fn<typeof fetch>(async (_url, init) => {
      onEntered();
      return new Promise((_resolve, reject) =>
        init!.signal!.addEventListener('abort', () => reject(new Error('ended')), { once: true }),
      );
    });
    const server = await startModelTransport(
      'https://unused.test',
      'fixture-token',
      signal(),
      transport,
      () => active,
    );
    servers.push(server);
    const pending = post(`${server.url}/v1/responses`, '{}');
    await entered;
    first.abort();
    active = { gatewayURL: 'https://gateway.test/second', token: 'second', signal: second.signal };
    expect((await pending).status).toBe(502);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(String(transport.mock.calls[0][0])).toBe('https://gateway.test/first/v1/responses');
  });
});
