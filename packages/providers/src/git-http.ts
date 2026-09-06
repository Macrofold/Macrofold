import type { HttpClient } from 'isomorphic-git';
import { GIT_BYTES } from './git-repository';
import { assert } from '../../core/src/errors';
/** Bind Git transport to a server-verified repository URL. Redirects and config-selected hosts are rejected. */
export function gitTransport(repositoryURL: string, transport: typeof fetch = fetch): HttpClient {
  const trusted = new URL(repositoryURL);
  return {
    request: async (request) => {
      const url = new URL(request.url);
      assert(
        url.origin === trusted.origin &&
          (url.pathname === trusted.pathname + '/info/refs' ||
            url.pathname === trusted.pathname + '/git-upload-pack' ||
            url.pathname === trusted.pathname + '/git-receive-pack'),
        400,
        'git_url_rejected',
        'Git requested an unexpected repository endpoint.',
      );
      const parts: Uint8Array[] = [];
      let size = 0;
      if (request.body)
        for await (const part of request.body) {
          size += part.byteLength;
          assert(size <= GIT_BYTES, 413, 'git_size_limit', 'Git request exceeds the maintenance size limit.');
          parts.push(part);
        }
      const response = await transport(url, {
        method: request.method || 'GET',
        headers: request.headers,
        body: parts.length ? new Uint8Array(Buffer.concat(parts)) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(120000),
      });
      const reader = response.body?.getReader();
      async function* body() {
        let bytes = 0;
        try {
          if (reader)
            while (true) {
              const item = await reader.read();
              if (item.done) break;
              bytes += item.value.byteLength;
              assert(
                bytes <= GIT_BYTES,
                413,
                'git_size_limit',
                'Git response exceeds the maintenance size limit.',
              );
              yield item.value;
            }
        } finally {
          await reader?.cancel();
        }
      }
      return {
        url: response.url || request.url,
        method: request.method,
        statusCode: response.status,
        statusMessage: response.statusText,
        headers: Object.fromEntries(response.headers),
        body: body(),
      };
    },
  };
}
