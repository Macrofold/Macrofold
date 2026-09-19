// Adapted from MIT-licensed stablyai/orca; see ORCA-LICENSE.txt.
export type FileTreeNode = {
  path: string;
  name: string;
  kind: 'directory' | 'file' | 'symlink';
  children?: FileTreeNode[];
};

const fileNameCollator = new Intl.Collator('en', { numeric: true });

export function compareFileNames(a: string, b: string): number {
  const compared = fileNameCollator.compare(a, b);
  return compared || (a < b ? -1 : a > b ? 1 : 0);
}

export function compareFileTreeNodes(a: FileTreeNode, b: FileTreeNode): number {
  if ((a.kind === 'directory') !== (b.kind === 'directory')) return a.kind === 'directory' ? -1 : 1;
  return compareFileNames(a.name, b.name);
}

export type FileTreeRow = {
  node: FileTreeNode;
  depth: number;
  parentPath: string | null;
  position: number;
  siblings: number;
  action?: { kind: 'retry' | 'more'; path: string };
};

export function visibleFileTreeRows(
  nodes: FileTreeNode[],
  expanded: ReadonlySet<string>,
  actions?: ReadonlyMap<string, 'retry' | 'more'>,
): FileTreeRow[] {
  const rows: FileTreeRow[] = [];
  const visit = (children: FileTreeNode[], depth: number, parentPath: string | null) => {
    const sorted = [...children].sort(compareFileTreeNodes);
    const action = parentPath === null ? undefined : actions?.get(parentPath);
    const siblings = sorted.length + Number(Boolean(action));
    sorted.forEach((node, index) => {
      rows.push({ node, depth, parentPath, position: index + 1, siblings });
      if (node.kind === 'directory' && expanded.has(node.path))
        visit(node.children ?? [], depth + 1, node.path);
    });
    if (action && parentPath !== null)
      rows.push({
        // NUL cannot occur in a worktree path; auxiliary rows retain stable focus keys.
        node: {
          path: `\0action:${parentPath}`,
          name: action === 'retry' ? 'Retry loading folder' : 'Load more',
          kind: 'file',
        },
        depth,
        parentPath,
        position: siblings,
        siblings,
        action: { kind: action, path: parentPath },
      });
  };
  visit(nodes, 1, null);
  return rows;
}

export function fileTreeNavigation(
  key: string,
  index: number,
  rows: FileTreeRow[],
  expanded: ReadonlySet<string>,
): { index: number } | { toggle: string } | null {
  const row = rows[index];
  if (!row) return null;
  switch (key) {
    case 'ArrowDown':
      return { index: Math.min(rows.length - 1, index + 1) };
    case 'ArrowUp':
      return { index: Math.max(0, index - 1) };
    case 'Home':
      return { index: 0 };
    case 'End':
      return { index: rows.length - 1 };
    case 'ArrowRight':
      if (row.node.kind !== 'directory') return null;
      if (!expanded.has(row.node.path)) return { toggle: row.node.path };
      return rows[index + 1]?.parentPath === row.node.path ? { index: index + 1 } : null;
    case 'ArrowLeft':
      if (row.node.kind === 'directory' && expanded.has(row.node.path)) return { toggle: row.node.path };
      if (row.parentPath === null) return null;
      return { index: rows.findIndex((candidate) => candidate.node.path === row.parentPath) };
    default:
      return null;
  }
}

/** Suggest a sibling name; the server still enforces create-only semantics atomically. */
export function duplicateFilePath(path: string, occupied: ReadonlySet<string>) {
  const slash = path.lastIndexOf('/'),
    dot = path.lastIndexOf('.');
  const split = dot > slash + 1 ? dot : path.length;
  const stem = path.slice(0, split),
    extension = path.slice(split);
  let candidate = `${stem} copy${extension}`;
  for (let n = 2; occupied.has(candidate); n++) candidate = `${stem} copy ${n}${extension}`;
  return candidate;
}
