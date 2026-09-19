import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { z } from 'zod';
import { encryptModelBody, modelTransport } from '../../contracts/model-transport';

const grantSchema = z.object({
  url: z.url(),
  headers: z.record(z.string(), z.string()),
  token: z.string(),
  encryption_key: z.string(),
});

/** A per-worker loopback bridge leaves native SDK payloads and streaming unchanged.
 * Only the transport changes: large bodies go directly to encrypted object staging.
 * No retries here: ambiguous model calls must retain the gateway's existing accounting behavior. */
export async function startModelTransport(
  gatewayURL: string,
  token: string,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
  current?: () => { gatewayURL: string; toolURL?: string; token: string; signal: AbortSignal } | undefined,
) {
  const http = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url || '/', 'http://127.0.0.1').pathname.slice(1);
      if (
        req.method !== 'POST' ||
        !(
          modelTransport.paths.includes(path as (typeof modelTransport.paths)[number]) ||
          (current && path === 'mcp')
        ) ||
        (req.headers.authorization !== `Bearer ${token}` && req.headers['x-api-key'] !== token)
      ) {
        res.writeHead(403).end();
        return;
      }
      const turn = current ? current() : { gatewayURL, token, signal };
      if (!turn || turn.signal.aborted) {
        res.writeHead(409).end();
        return;
      }
      const controller = new AbortController();
      res.once('close', () => controller.abort());
      const aborted = AbortSignal.any([turn.signal, controller.signal]);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > modelTransport.maximumBytes) {
          res.writeHead(413, { 'Content-Type': 'application/json' }).end(
            JSON.stringify({
              error: {
                code: 'model_request_too_large',
                message:
                  'The full model request exceeds 8 MiB, including conversation history. Start a new conversation or reduce input; no content was truncated.',
              },
            }),
          );
          req.resume();
          return;
        }
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const tools = path === 'mcp';
      if (tools && !turn.toolURL) {
        res.writeHead(403).end();
        return;
      }
      const headers = new Headers({
        Authorization: `Bearer ${turn.token}`,
        'Content-Type': 'application/json',
      });
      for (const name of ['anthropic-version', 'anthropic-beta', 'accept', 'mcp-protocol-version']) {
        const value = req.headers[name];
        if (typeof value === 'string') headers.set(name, value);
      }
      let body: Uint8Array<ArrayBuffer> | undefined = new Uint8Array(bytes);
      if (!tools && size > modelTransport.inlineBytes) {
        const planned = await transport(`${turn.gatewayURL}/${modelTransport.uploadPath}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ size, sha256: createHash('sha256').update(bytes).digest('hex'), path }),
          signal: aborted,
          redirect: 'error',
        });
        if (!planned.ok) {
          res.writeHead(planned.status, { 'Content-Type': 'application/json' }).end(await planned.text());
          return;
        }
        const grant = grantSchema.parse(await planned.json());
        const encrypted = await encryptModelBody(
          body,
          new Uint8Array(Buffer.from(grant.encryption_key, 'base64')),
        );
        const uploaded = await transport(grant.url, {
          method: 'PUT',
          headers: grant.headers,
          body: encrypted,
          signal: aborted,
          redirect: 'error',
        });
        await uploaded.body?.cancel();
        if (!uploaded.ok) {
          res.writeHead(502).end('Model request staging failed before inference.');
          return;
        }
        headers.set(modelTransport.uploadHeader, grant.token);
        body = undefined;
      }
      const response = await transport(tools ? turn.toolURL! : `${turn.gatewayURL}/${path}`, {
        method: 'POST',
        headers,
        body,
        signal: aborted,
        redirect: 'error',
      });
      res.writeHead(response.status, {
        'Content-Type': response.headers.get('content-type') || 'application/json',
        ...(response.headers.has('retry-after')
          ? { 'Retry-After': response.headers.get('retry-after')! }
          : {}),
      });
      const reader = response.body?.getReader();
      try {
        if (reader)
          for (;;) {
            const item = await reader.read();
            if (item.done) break;
            if (!res.write(item.value)) await once(res, 'drain', { signal: aborted });
          }
        res.end();
      } finally {
        await reader?.cancel().catch(() => {});
      }
    })().catch(() => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', resolve);
  });
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Model transport listener unavailable.');
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
