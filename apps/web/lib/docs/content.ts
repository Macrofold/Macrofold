import pages from './generated.json';

export { pages };
export type DocPage = (typeof pages)[number];
export const navigation = pages.map(({ markdown: _markdown, source: _source, ...page }) => page);
export const findPage = (slug = '') => pages.find((page) => page.slug === slug);

/** Match GitHub-style anchors for the controlled Markdown vocabulary used by these guides. */
export function headingId(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, '')
    .replace(/\s/g, '-');
}
export function headings(markdown: string) {
  const counts = new Map<string, number>();
  let fenced = false;
  return markdown.split('\n').flatMap((line, index) => {
    if (/^```/.test(line)) {
      fenced = !fenced;
      return [];
    }
    const match = !fenced && line.match(/^(#{2,3}) (.+)$/);
    if (!match) return [];
    const text = match[2].replace(/[`*_]/g, '');
    const base = headingId(text),
      count = counts.get(base) || 0;
    counts.set(base, count + 1);
    return [{ text, id: base + (count ? `-${count}` : ''), level: match[1].length, line: index + 1 }];
  });
}
export function markdownUrl(slug: string) {
  return `/docs/raw/${slug || 'index'}.md`;
}
export function absoluteMarkdown(page: DocPage, origin: string) {
  return page.markdown.replace(/\]\((\/[^\s)]+)\)/g, (_, target: string) => {
    const [pathname, fragment] = target.split('#');
    const linked = pages.find((entry) => entry.url === pathname);
    return `](${origin}${linked ? markdownUrl(linked.slug) : pathname}${fragment ? '#' + fragment : ''})`;
  });
}
