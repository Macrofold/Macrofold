import { config } from '@platform/core/config';
import { pages, markdownUrl } from '../../lib/docs/content';
export const dynamic = 'force-static';
export function GET() {
  const sections = [...new Set(pages.map((page) => page.section))];
  const content =
    `# ${config.name} documentation\n\n> Persistent cloud agents: projects, files, Git, APIs, and a terminal CLI.\n\n` +
    sections
      .map(
        (section) =>
          `## ${section}\n\n` +
          pages
            .filter((page) => page.section === section)
            .map(
              (page) => `- [${page.title}](${config.origin}${markdownUrl(page.slug)}): ${page.description}`,
            )
            .join('\n'),
      )
      .join('\n\n') +
    `\n\n## Reference\n\n- [OpenAPI](${config.origin}/openapi.json)\n- [Interactive API reference](${config.origin}/reference)\n- [Complete documentation](${config.origin}/llms-full.txt)\n`;
  return new Response(content, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
