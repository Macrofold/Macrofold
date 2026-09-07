import { config } from '@platform/core/config';
import { absoluteMarkdown, findPage } from '../../../../lib/docs/content';
export const dynamic = 'force-static';
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const key = (await params).path.join('/');
  const page = key.endsWith('.md') ? findPage(key === 'index.md' ? '' : key.slice(0, -3)) : undefined;
  if (!page) return new Response('Documentation not found', { status: 404 });
  return new Response(absoluteMarkdown(page, config.origin), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
      Link: `<${config.origin}${page.url}>; rel="canonical"`,
    },
  });
}
