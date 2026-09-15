import { createHash } from 'node:crypto';
import { z } from 'zod';

export const noteSchema = z.object({ id: z.string(), title: z.string(), body: z.string() });
export type Note = z.infer<typeof noteSchema>;
export type CustomerNotes = (verifiedCustomerId: string) => Promise<Note[]>;
const notes = z.array(noteSchema).max(20);
const origin = (value: string) => {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Configure an HTTPS service origin on the server.');
  return url.origin;
};
async function json(response: Response): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Data service request failed (${response.status}).`);
  }
  // Responses are bounded independently of Content-Length and never echoed into errors.
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing data response.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 1024 * 1024) throw new Error('Data response exceeds 1 MiB.');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Use the authenticated customer's short-lived Supabase access token, never service_role.
 * The SQL recipe enforces auth.uid() even if the application omits a filter. */
export function supabaseNotes(
  config: { url: string; publishableKey: string; customerToken: (customerId: string) => Promise<string> },
  transport: typeof fetch = fetch,
): CustomerNotes {
  const base = origin(config.url);
  return async (customerId) => {
    const token = z
      .string()
      .min(1)
      .parse(await config.customerToken(customerId));
    const url = new URL('/rest/v1/customer_notes', base);
    url.search = new URLSearchParams({
      select: 'id,title,body',
      customer_id: `eq.${z.uuid().parse(customerId)}`,
      order: 'id.asc',
      limit: '20',
    }).toString();
    return notes.parse(
      await json(
        await transport(url, {
          headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}` },
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
        }),
      ),
    );
  };
}

/** Namespace identity is derived from trusted application identity and reused on upsert/delete.
 * A provider API key spans namespaces, so keep this adapter behind authenticated server routes. */
export const customerNamespace = (verifiedCustomerId: string) =>
  `customer-${createHash('sha256').update(z.string().min(1).parse(verifiedCustomerId)).digest('hex')}`;
export function pineconeSearch(
  config: { indexHost: string; apiKey: string; dimensions: number },
  transport: typeof fetch = fetch,
) {
  const base = origin(config.indexHost);
  z.number().int().min(1).max(20000).parse(config.dimensions);
  return async (verifiedCustomerId: string, vector: number[]) => {
    z.array(z.number().finite()).length(config.dimensions).parse(vector);
    const payload = {
      namespace: customerNamespace(verifiedCustomerId),
      vector,
      topK: 5,
      includeMetadata: true,
      includeValues: false,
    };
    return z
      .object({
        matches: z
          .array(
            z.object({
              id: z.string(),
              score: z.number().optional(),
              metadata: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .max(5),
      })
      .parse(
        await json(
          await transport(new URL('/query', base), {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'Api-Key': config.apiKey,
              'X-Pinecone-Api-Version': '2025-10',
            },
            body: JSON.stringify(payload),
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
          }),
        ),
      );
  };
}
