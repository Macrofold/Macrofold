import { config } from '@platform/core/config';
import { pages, absoluteMarkdown } from '../../lib/docs/content';
export const dynamic = 'force-static';
export function GET() {
  return new Response(
    pages
      .map((page) => `Source: ${config.origin}${page.url}\n\n${absoluteMarkdown(page, config.origin)}`)
      .join('\n\n---\n\n'),
    {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex' },
    },
  );
}
