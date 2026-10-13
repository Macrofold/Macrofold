import { afterEach, expect, it, vi } from 'vitest';
import { createServer, type ServerResponse } from 'node:http';
import { createOpencodeServer } from '@opencode-ai/sdk/v2/server';
import { OpenCodeAdapter } from '../../packages/runtime/src/opencode';
import { failureDiagnostic } from '../../packages/runtime/src/failure-diagnostic';
import type { NativeConfiguration } from '../../packages/runtime/src/types';
vi.mock('@opencode-ai/sdk/v2/server', () => ({ createOpencodeServer: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it.each(['success', 'session-error', 'message-error', 'closed', 'cancel'])(
  'submits once without a held prompt request and handles %s via the real SDK event transport',
  async (mode) => {
    let feed: ServerResponse | undefined;
    const paths: string[] = [];
    const abort = new AbortController();
    const event = (type: string, properties: Record<string, unknown>) =>
      feed!.write(`data: ${JSON.stringify({ type, properties })}\n\n`);
    const server = createServer(async (req, res) => {
      paths.push(`${req.method} ${req.url}`);
      if (req.url === '/event') {
        feed = res;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        event('server.connected', {});
        event('session.idle', { sessionID: 's' });
      } else if (req.url === '/session/s/prompt_async') {
        for await (const _ of req) {
          /* Drain the accepted prompt. */
        }
        res.writeHead(204).end();
        setImmediate(() => {
          if (mode === 'cancel') {
            abort.abort();
            return;
          }
          if (mode === 'closed') {
            feed!.end();
            return;
          }
          event('message.updated', { info: { id: 'u', sessionID: 's', role: 'user' } });
          if (mode === 'session-error') {
            event('session.error', { sessionID: 's', error: { message: 'private upstream text' } });
            return;
          }
          event('message.updated', {
            info: {
              id: 'a',
              sessionID: 's',
              role: 'assistant',
              parentID: 'u',
              ...(mode === 'message-error' ? { error: { message: 'private' } } : {}),
            },
          });
          event('message.part.updated', { part: { id: 'p', sessionID: 's', type: 'text' } });
          event('message.part.delta', { sessionID: 's', partID: 'p', field: 'text', delta: 'streamed' });
          event('session.idle', { sessionID: 'other' });
          event('session.idle', { sessionID: 's' });
        });
      } else if (req.url === '/session/s/message/a') {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            info: { id: 'a', sessionID: 's', role: 'assistant' },
            parts: [{ type: 'text', text: 'final response' }],
          }),
        );
      } else if (req.url === '/session/s/abort') res.end('true');
      else res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    vi.mocked(createOpencodeServer).mockResolvedValue({
      url: `http://127.0.0.1:${address.port}`,
      close: () => {},
    });
    const configuration: NativeConfiguration = {
      runId: 'fixture',
      harness: 'opencode',
      provider: 'openai',
      model: 'fixture',
      prompt: 'fixture',
      resumeId: 's',
      workspace: '/workspace',
      stateHome: '/home',
      gatewayURL: 'http://127.0.0.1:1',
      toolURL: 'http://127.0.0.1:1',
      token: 'fixture',
      deadline: new Date(Date.now() + 10000).toISOString(),
      toolGrants: false,
      permissions: [{ version: 1, files: { read: { include: [] }, write: { include: [] } }, shell: 'deny' }],
    };
    const emit = vi.fn();
    try {
      const result = new OpenCodeAdapter().run({ configuration, signal: abort.signal, emit, ask: vi.fn() });
      if (mode === 'success') {
        await expect(result).resolves.toMatchObject({
          outcome: 'success',
          output: 'final response',
          resumeId: 's',
        });
        expect(emit).toHaveBeenCalledWith({ type: 'output.delta', data: { text: 'streamed' } });
        expect(paths).toContain('GET /session/s/message/a');
      } else await expect(result).rejects.toThrow();
      expect(paths.filter((value) => value.includes('prompt_async'))).toHaveLength(1);
      expect(paths).not.toContain('POST /session/s/message');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
it('classifies nested HTTP timeout causes without leaking upstream text', () => {
  const error = new TypeError('private request', {
    cause: Object.assign(new Error('private headers'), { code: 'UND_ERR_HEADERS_TIMEOUT' }),
  });
  expect(failureDiagnostic(error, 'turn_execute')).toMatchObject({
    code: 'UND_ERR_HEADERS_TIMEOUT',
    stage: 'turn_execute',
  });
  expect(JSON.stringify(failureDiagnostic(error, 'turn_execute'))).not.toContain('private');
});
