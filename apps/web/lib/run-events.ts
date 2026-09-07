import { Client, type Schema } from 'macrofold';

/** Use the same durable stream implementation as terminal/API customers. The
 * dashboard authenticates only with its same-origin cookie, never a browser key. */
export function dashboardRunEvents(
  origin: string,
  runId: string,
  options: { signal: AbortSignal; connected: (value: boolean) => void; fetch?: typeof fetch },
): AsyncGenerator<Schema['Event']> {
  const fetcher = options.fetch || fetch;
  const client = new Client({
    baseURL: origin,
    token: '',
    fetch: async (url, init) => {
      const headers = new Headers(init?.headers);
      headers.delete('Authorization');
      headers.set('X-Client-Type', 'dashboard');
      try {
        const response = await fetcher(url, { ...init, headers, credentials: 'same-origin' });
        if (new URL(String(url)).pathname.endsWith('/stream')) options.connected(response.ok);
        return response;
      } catch (error) {
        options.connected(false);
        throw error;
      }
    },
  });
  return client.stream(runId, { signal: options.signal });
}
