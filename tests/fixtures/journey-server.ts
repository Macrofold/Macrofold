import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { nativeModelFixture } from './native-model.mjs';
import { handleApi } from '../../packages/core/src/http';
import { handleModelRequest } from '../../packages/core/src/model-gateway';
import { handleRuntimeMcp } from '../../packages/core/src/tool-broker';
import { config, isLocal } from '../../packages/core/src/config';

if (
  !isLocal() ||
  config.execution !== 'docker' ||
  process.env.DETERMINISTIC_AGENT_JOURNEY !== '1' ||
  !['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY'].every(
    (key) => process.env[key] === 'fixture-never-live',
  )
)
  throw new Error('Native journey fixtures require isolated Docker and synthetic credentials.');
const fixturePaths = ['/v1/responses', '/v1/chat/completions', '/v1/messages'];
const fixtures = new Map(fixturePaths.map((p) => [p, nativeModelFixture({ journey: true })]));
const model = createServer((req, res) => {
  const fixture = fixtures.get(req.url === '/v1/messages/count_tokens' ? '/v1/messages' : req.url || '');
  if (!fixture) {
    res.writeHead(404).end();
    return;
  }
  fixture.handler(req, res);
}).listen(0, '127.0.0.1');
await once(model, 'listening');
const modelPort = (model.address() as import('node:net').AddressInfo).port;
const networkFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== config.origin && url.origin !== `http://127.0.0.1:${modelPort}`)
    throw new Error('Unexpected fixture network request');
  return networkFetch(input, init);
};
const fixtureTransport: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (!['https://api.openai.com', 'https://api.anthropic.com', 'https://openrouter.ai'].includes(url.origin))
    throw new Error('Unreviewed model endpoint');
  const headers = new Headers(init?.headers);
  if (
    ![headers.get('authorization'), headers.get('x-api-key')].some(
      (h) => h === 'Bearer fixture-never-live' || h === 'fixture-never-live',
    )
  )
    throw new Error('Unexpected credential in model fixture');
  return networkFetch(`http://127.0.0.1:${modelPort}${url.pathname.replace(/^\/api\//, '/')}`, {
    ...init,
    redirect: 'error',
  });
};
const server = createServer(async (incoming, outgoing) => {
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
    const pathname = new URL(request.url).pathname;
    const runtime = /^\/runtime\/runs\/([a-f0-9-]+)\/(model\/(.+)|mcp)$/.exec(pathname);
    const response = runtime
      ? runtime[3]
        ? await handleModelRequest(request, runtime[1], runtime[3], fixtureTransport)
        : await handleRuntimeMcp(request, runtime[1])
      : await handleApi(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body)
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream).pipe(outgoing);
    else outgoing.end();
  } catch {
    outgoing.destroy();
  }
}).listen(Number(new URL(config.origin).port), '0.0.0.0');
process.on('SIGTERM', () => {
  server.closeAllConnections();
  server.close();
  model.closeAllConnections();
  model.close();
  process.exit(0);
});
