import { pages } from '../../../lib/docs/content';
export const dynamic = 'force-static';
export function GET() {
  return Response.json(
    pages.map((page) => ({
      title: page.title,
      url: page.url,
      section: page.section,
      text: page.markdown
        .replace(/^# .+\n+/, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[`#*_>|]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    })),
    { headers: { 'X-Robots-Tag': 'noindex' } },
  );
}
