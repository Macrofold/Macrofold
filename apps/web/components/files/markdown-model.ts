// Front matter extraction adapted from MIT-licensed Orca; see ORCA-LICENSE.txt.
const frontMatterPattern = /^(---|\+\+\+)\r?\n(?:[\s\S]*?\r?\n)?\1(?:\r?\n|$)/;

export function extractMarkdownFrontMatter(content: string) {
  const match = content.match(frontMatterPattern);
  return match ? { raw: match[0], body: content.slice(match[0].length) } : null;
}

export type MarkdownLink =
  | { kind: 'external'; href: string }
  | { kind: 'file'; path: string; anchor?: string }
  | { kind: 'anchor'; anchor: string }
  | { kind: 'blocked' };

export function resolveMarkdownLink(href: string, filePath = ''): MarkdownLink {
  if (!href || /[\u0000-\u0020\u007f\\]/.test(href)) return { kind: 'blocked' };
  if (/^(https?:|mailto:)/i.test(href)) return { kind: 'external', href };
  if (/^[\w+.-]+:/.test(href) || href.startsWith('//')) return { kind: 'blocked' };
  const hashIndex = href.indexOf('#');
  let anchor: string | undefined;
  let target: string;
  try {
    anchor = hashIndex >= 0 ? decodeURIComponent(href.slice(hashIndex + 1)) : undefined;
    target = decodeURIComponent((hashIndex >= 0 ? href.slice(0, hashIndex) : href).split('?')[0] ?? '');
  } catch {
    return { kind: 'blocked' };
  }
  if (!target) return anchor ? { kind: 'anchor', anchor } : { kind: 'blocked' };
  if (/[\u0000-\u001f\u007f\\]/.test(target) || target.startsWith('//') || /^[\w+.-]+:/.test(target))
    return { kind: 'blocked' };
  const parts = target.startsWith('/') ? [] : filePath.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return { kind: 'blocked' };
      parts.pop();
    } else parts.push(part);
  }
  const path = parts.join('/');
  return path ? { kind: 'file', path, ...(anchor ? { anchor } : {}) } : { kind: 'blocked' };
}

type MarkdownNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
};

function nodeText(node: MarkdownNode): string {
  return node.value ?? node.children?.map(nodeText).join('') ?? '';
}

/** Prefix IDs so customer headings cannot shadow document/browser properties. */
export function workspaceHeadingAnchors() {
  return (tree: MarkdownNode) => {
    const slugs = new Map<string, number>();
    const visit = (node: MarkdownNode) => {
      if (node.tagName && /^h[1-6]$/.test(node.tagName)) {
        const base =
          nodeText(node)
            .trim()
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s_-]/gu, '')
            .replace(/\s/g, '-') || 'section';
        const count = slugs.get(base) ?? 0;
        slugs.set(base, count + 1);
        const slug = count ? `${base}-${count}` : base;
        node.properties = {
          ...node.properties,
          id: `workspace-heading-${slug}`,
          'data-workspace-heading': slug,
        };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
