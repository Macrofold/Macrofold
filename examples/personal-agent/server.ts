import { createServer, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '../../sdk/typescript/src/index';
import { PersonalAgents } from './service';
import { AppError } from './store';

export type CustomerAuth = {
  /** Production replacement verifies your application's session and returns its stable customer ID. */
  authenticate(request: IncomingMessage): Promise<{ id: string; name: string }>;
};

/** Local UI host, intentionally bound to loopback by start.ts. No platform key reaches the browser. */
export function exampleServer(service: PersonalAgents, auth: CustomerAuth, demo = false) {
  const csrf = randomUUID();
  const server = createServer(async (request, response) => {
    const address = server.address();
    if (!address || typeof address === 'string') return response.writeHead(503).end();
    const origin = `http://127.0.0.1:${address.port}`;
    const reply = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify(body));
    };
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      if (request.headers.host !== new URL(origin).host)
        throw new AppError(403, 'Open the loopback URL printed by the example.');
      const url = new URL(request.url || '/', origin);
      if (request.method === 'GET' && ['/', '/app.js', '/style.css'].includes(url.pathname)) {
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        response.writeHead(200, {
          'content-type': file.endsWith('.js')
            ? 'text/javascript'
            : file.endsWith('.css')
              ? 'text/css'
              : 'text/html',
          'cache-control': 'no-store',
        });
        response.end(await readFile(new URL(`./public/${file}`, import.meta.url)));
        return;
      }
      const customer = await auth.authenticate(request);
      if (request.method === 'GET' && url.pathname === '/api/session')
        return reply(200, {
          customer,
          csrf,
          demo,
          model: service.configuration.model,
          budgetMicroUsd: service.configuration.budgetMicroUsd,
        });
      if (request.method === 'GET' && url.pathname === '/api/agents')
        return reply(200, service.list(customer.id));
      const target = /^\/api\/agents\/([a-f0-9-]+)(?:\/(activity|memory))?$/.exec(url.pathname);
      if (request.method === 'GET' && target?.[2] === 'activity')
        return reply(200, await service.activity(customer.id, target[1]));
      if (request.method === 'GET' && target?.[2] === 'memory')
        return reply(
          200,
          await service.readMemory(customer.id, target[1], url.searchParams.get('path') || 'profile.md'),
        );
      if (request.method !== 'POST') throw new AppError(404, 'Page not found.');
      if (request.headers.origin !== origin || request.headers['x-csrf-token'] !== csrf)
        throw new AppError(403, 'Reload this page before submitting.');
      if (!request.headers['content-type']?.startsWith('application/json'))
        throw new AppError(415, 'Send JSON.');
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 128 * 1024) throw new AppError(413, 'Use a smaller request.');
        chunks.push(chunk);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (demo && url.pathname === '/api/demo/customer') {
        const { id } = z.object({ id: z.enum(['alice', 'bob']) }).parse(body);
        response.setHeader('set-cookie', `demo_customer=${id}; HttpOnly; SameSite=Strict; Path=/`);
        return reply(200, { ok: true });
      }
      if (!target || target[2]) throw new AppError(404, 'Page not found.');
      const { requestId, ...action } = z.object({ requestId: z.uuid() }).passthrough().parse(body);
      return reply(200, await service.act(customer.id, target[1], requestId, action));
    } catch (error) {
      // No request bodies, customer content or provider credentials in logs or error pages.
      if (error instanceof AppError || error instanceof ApiError)
        return reply(error.status, {
          error: error.message,
          correctable: error instanceof AppError && error.correctable,
        });
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return reply(400, {
          error: 'Check the fields and try again. Task files must follow the documented JSON schema.',
        });
      return reply(503, {
        error:
          'The action could not be confirmed. Retry the same action. Its saved request IDs prevent duplicate work.',
      });
    }
  });
  return server;
}

/** Deliberately NOT authentication. Only the explicitly selected loopback demonstration uses this. */
export const demoAuth: CustomerAuth = {
  async authenticate(request) {
    const id = /(?:^|;\s*)demo_customer=bob(?:;|$)/.test(request.headers.cookie || '') ? 'bob' : 'alice';
    return { id, name: id === 'alice' ? 'Alice' : 'Bob' };
  },
};
