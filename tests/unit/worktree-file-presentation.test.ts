import { describe, expect, it } from 'vitest';
import { markdownTaskLabels } from '../../apps/web/lib/markdown-accessibility';
import {
  compareFileNames,
  fileTreeNavigation,
  visibleFileTreeRows,
  type FileTreeNode,
} from '../../apps/web/components/files/file-tree-model';
import {
  extractMarkdownFrontMatter,
  resolveMarkdownLink,
  worktreeHeadingAnchors,
} from '../../apps/web/components/files/markdown-model';

const nodes: FileTreeNode[] = [
  { path: '10.txt', name: '10.txt', kind: 'file' },
  { path: '2.txt', name: '2.txt', kind: 'file' },
  {
    path: 'docs',
    name: 'docs',
    kind: 'directory',
    children: [
      { path: 'docs/readme.md', name: 'readme.md', kind: 'file' },
      {
        path: 'docs/api',
        name: 'api',
        kind: 'directory',
        children: [{ path: 'docs/api/index.md', name: 'index.md', kind: 'file' }],
      },
    ],
  },
];

describe('worktree file tree', () => {
  it('shows folders before numerically sorted files without reordering the source listing', () => {
    expect(visibleFileTreeRows(nodes, new Set()).map((row) => row.node.path)).toEqual([
      'docs',
      '2.txt',
      '10.txt',
    ]);
    expect(nodes[0]?.name).toBe('10.txt');
    expect(['2', '02', '100', '9'].sort(compareFileNames)).toEqual(['02', '2', '9', '100']);
  });

  it('reveals only expanded descendants and records their accessible hierarchy', () => {
    const rows = visibleFileTreeRows(nodes, new Set(['docs']));
    expect(rows.map((row) => row.node.path)).toEqual([
      'docs',
      'docs/api',
      'docs/readme.md',
      '2.txt',
      '10.txt',
    ]);
    expect(rows[1]).toMatchObject({ depth: 2, parentPath: 'docs', position: 1, siblings: 2 });
    expect(visibleFileTreeRows(nodes, new Set(['docs', 'docs/api']))[2]).toMatchObject({
      node: { path: 'docs/api/index.md' },
      depth: 3,
    });
  });

  it('navigates parent and child boundaries without opening files as a side effect', () => {
    const expanded = new Set(['docs']);
    const rows = visibleFileTreeRows(nodes, expanded);
    expect(fileTreeNavigation('ArrowRight', 0, rows, expanded)).toEqual({ index: 1 });
    expect(fileTreeNavigation('ArrowRight', 1, rows, expanded)).toEqual({ toggle: 'docs/api' });
    expect(fileTreeNavigation('ArrowLeft', 2, rows, expanded)).toEqual({ index: 0 });
    expect(fileTreeNavigation('ArrowLeft', 0, rows, expanded)).toEqual({ toggle: 'docs' });
    expect(fileTreeNavigation('ArrowUp', 0, rows, expanded)).toEqual({ index: 0 });
    expect(fileTreeNavigation('End', 0, rows, expanded)).toEqual({ index: 4 });
    expect(fileTreeNavigation('Home', 4, rows, expanded)).toEqual({ index: 0 });
    expect(fileTreeNavigation('ArrowDown', 4, rows, expanded)).toEqual({ index: 4 });
    expect(fileTreeNavigation('ArrowRight', 4, rows, expanded)).toBeNull();
    expect(fileTreeNavigation('Enter', 4, rows, expanded)).toBeNull();
  });

  it('includes folder pagination and retry actions in the same keyboard hierarchy', () => {
    const expanded = new Set(['docs', 'docs/api']);
    const actions = new Map<string, 'retry' | 'more'>([
      ['docs', 'more'],
      ['docs/api', 'retry'],
    ]);
    const rows = visibleFileTreeRows(nodes, expanded, actions);
    const retry = rows.findIndex((row) => row.action?.path === 'docs/api');
    expect(rows[retry]).toMatchObject({
      action: { kind: 'retry', path: 'docs/api' },
      depth: 3,
      parentPath: 'docs/api',
      position: 2,
      siblings: 2,
    });
    expect(fileTreeNavigation('ArrowDown', retry - 1, rows, expanded)).toEqual({ index: retry });
    expect(fileTreeNavigation('ArrowLeft', retry, rows, expanded)).toEqual({ index: 1 });
    expect(rows.find((row) => row.action?.path === 'docs')).toMatchObject({
      depth: 2,
      position: 3,
      siblings: 3,
    });
    expect(visibleFileTreeRows(nodes, new Set(), actions).some((row) => row.action)).toBe(false);
  });
});

describe('worktree Markdown navigation', () => {
  it('labels formatted tasks separately from nested tasks and preserves checked state', () => {
    const parent = { tagName: 'input', properties: { type: 'checkbox', checked: true, disabled: true } };
    const child = { tagName: 'input', properties: { type: 'checkbox', checked: false, disabled: true } };
    markdownTaskLabels()({
      tagName: 'li',
      children: [
        parent,
        { value: ' Read ' },
        { tagName: 'strong', children: [{ value: 'a book' }] },
        { tagName: 'ul', children: [{ tagName: 'li', children: [child, { value: ' Pick a title' }] }] },
      ],
    });
    expect(parent.properties).toEqual({
      type: 'checkbox',
      checked: true,
      disabled: true,
      ariaLabel: 'Read a book',
    });
    expect(child.properties).toEqual({
      type: 'checkbox',
      checked: false,
      disabled: true,
      ariaLabel: 'Pick a title',
    });
  });

  it('resolves file links relative to the document and preserves decoded anchors', () => {
    expect(resolveMarkdownLink('../images/diagram%20one.png', 'docs/guide.md')).toEqual({
      kind: 'file',
      path: 'images/diagram one.png',
    });
    expect(resolveMarkdownLink('/README.md#Install%20now', 'docs/guide.md')).toEqual({
      kind: 'file',
      path: 'README.md',
      anchor: 'Install now',
    });
    expect(resolveMarkdownLink('#install', 'docs/guide.md')).toEqual({ kind: 'anchor', anchor: 'install' });
    expect(resolveMarkdownLink('https://example.com/guide')).toEqual({
      kind: 'external',
      href: 'https://example.com/guide',
    });
  });

  it.each([
    '../../secret',
    '%2e%2e/%2e%2e/secret',
    'file:///tmp/secret',
    'javascript:alert(1)',
    'data:text/html,test',
    '//external.test/image',
    '%2f%2fexternal.test/image',
    'java\nscript:alert(1)',
    '%00secret',
    '%5csecret',
    '%E0%A4%A',
  ])('rejects unsafe or malformed navigation: %s', (href) => {
    expect(resolveMarkdownLink(href, 'docs/guide.md')).toEqual({ kind: 'blocked' });
  });

  it('keeps YAML and TOML metadata byte-for-byte while separating the displayed body', () => {
    for (const delimiter of ['---', '+++']) {
      const raw = `${delimiter}\r\ntitle: Example\r\n${delimiter}\r\n`;
      expect(extractMarkdownFrontMatter(`${raw}# Guide`)).toEqual({ raw, body: '# Guide' });
    }
    expect(extractMarkdownFrontMatter('---\nNo closing delimiter')).toBeNull();
  });

  it('gives duplicate formatted headings distinct prefixed anchors', () => {
    const first = {
      type: 'element',
      tagName: 'h2',
      properties: {},
      children: [{ type: 'text', value: 'Install now' }],
    };
    const second = {
      type: 'element',
      tagName: 'h2',
      properties: {},
      children: [{ type: 'element', tagName: 'em', children: [{ type: 'text', value: 'Install now' }] }],
    };
    worktreeHeadingAnchors()({ type: 'root', children: [first, second] });
    expect(first.properties).toMatchObject({
      id: 'worktree-heading-install-now',
      'data-worktree-heading': 'install-now',
    });
    expect(second.properties).toMatchObject({ id: 'worktree-heading-install-now-1' });
  });
});
