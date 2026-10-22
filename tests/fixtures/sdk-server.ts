import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { handleApi } from '../../packages/core/src/http';
import { serveObject } from '../../packages/core/src/transfers';
import { config, isLocal } from '../../packages/core/src/config';

// The actual API boundary on loopback, with a separately running simulator worker.
if (
  !isLocal() ||
  config.allowPaid ||
  config.execution !== 'simulator' ||
  !new URL(config.databaseUrl).pathname.startsWith('/platform_test_')
)
  throw new Error('SDK acceptance requires unpaid simulation.');
// Exercise the real immediate provider adapter without allowing external I/O.
// This fixture process is isolated from the separately configured simulator worker.
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.href !== 'https://api.anthropic.com/v1/messages')
    throw new Error('Unreviewed outbound request in SDK acceptance.');
  const request = JSON.parse(String(init?.body));
  const message = {
    id: 'sdk-provider-fixture',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'text', text: 'Hello from the SDK fixture.' }],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 100,
      output_tokens: 10,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  };
  if (!request.stream) return Response.json(message);
  const events = [
    {
      type: 'message_start',
      message: { ...message, content: [], usage: { ...message.usage, output_tokens: 0 } },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: message.content[0].text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } },
    { type: 'message_stop' },
  ];
  return new Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    {
      headers: { 'content-type': 'text/event-stream' },
    },
  );
};
config.allowPaid = true; // Safe only after installing the closed fixture transport above.
process.env.ANTHROPIC_API_KEY = 'sdk-fixture-not-a-provider-key';
let backgroundFailed = false;
const deploymentCalls: Record<string, number> = {};
const background = (task: () => Promise<void>) => {
  void Promise.resolve()
    .then(task)
    .catch(() => {
      backgroundFailed = true;
    });
};
createServer(async (incoming, outgoing) => {
  const abort = new AbortController();
  outgoing.on('close', () => abort.abort());
  try {
    if (incoming.url === '/health') {
      outgoing.statusCode = backgroundFailed ? 500 : 200;
      outgoing.end('ready');
      return;
    }
    // A real loopback OpenAI transport exercises the deployment adapter's
    // DNS-to-socket boundary. It never forwards to an external provider.
    if (incoming.url?.startsWith('/model-fixture/')) {
      if (incoming.headers.authorization !== 'Bearer sdk-external-fixture-not-a-provider-key') {
        outgoing.writeHead(401).end();
        return;
      }
      outgoing.setHeader('Content-Type', 'application/json');
      if (incoming.url === '/model-fixture/observations') {
        outgoing.end(JSON.stringify(deploymentCalls));
        return;
      }
      if (incoming.url === '/model-fixture/v1/models') {
        outgoing.end(
          JSON.stringify({
            data: ['typescript', 'python', 'go', 'rust', 'java'].map((language) => ({
              id: `fixture-model-${language}`,
            })),
          }),
        );
        return;
      }
      if (incoming.url !== '/model-fixture/v1/chat/completions' || incoming.method !== 'POST') {
        outgoing.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const input = JSON.parse(Buffer.concat(chunks).toString()) as { model?: unknown; stream?: unknown };
      if (
        typeof input.model !== 'string' ||
        !/^fixture-model-(typescript|python|go|rust|java)$/.test(input.model)
      ) {
        outgoing.writeHead(400).end();
        return;
      }
      deploymentCalls[input.model] = (deploymentCalls[input.model] ?? 0) + 1;
      const value = {
        id: 'sdk-deployment-completion',
        object: 'chat.completion',
        model: input.model,
        provider_native_extra: { retained: true },
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello from the deployment SDK fixture.',
              annotations: [],
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
      };
      if (!input.stream) {
        outgoing.end(JSON.stringify(value));
        return;
      }
      outgoing.setHeader('Content-Type', 'text/event-stream');
      outgoing.end(
        [
          {
            id: value.id,
            model: value.model,
            choices: [{ index: 0, delta: value.choices[0].message, finish_reason: null }],
          },
          {
            id: value.id,
            model: value.model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: value.usage,
          },
        ]
          .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
          .join('') + 'data: [DONE]\n\n',
      );
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
    // Exercise signed downloads through the same boundary as the web application's /objects route.
    const object = new URL(request.url).pathname.match(/^\/objects\/([^/]+)$/);
    const response = object
      ? await serveObject(request, decodeURIComponent(object[1]))
      : await handleApi(request, 'rest', background);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body)
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
        .on('error', () => outgoing.destroy())
        .pipe(outgoing);
    else outgoing.end();
  } catch {
    outgoing.destroy();
  }
}).listen(Number(new URL(config.origin).port), '127.0.0.1');
