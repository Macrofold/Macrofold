type MarkdownNode = {
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
};

/** GFM emits disabled checkboxes without labels. Use each task's own text, excluding nested lists. */
export function markdownTaskLabels() {
  const taskText = (node: MarkdownNode): string =>
    node.tagName === 'ul' || node.tagName === 'ol'
      ? ''
      : (node.value ?? node.children?.map(taskText).join('') ?? '');
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode, task = '') => {
      const label = node.tagName === 'li' ? taskText(node).trim() : task;
      if (node.tagName === 'input' && node.properties?.type === 'checkbox')
        node.properties = { ...node.properties, ariaLabel: label || 'Task' };
      node.children?.forEach((child) => visit(child, label));
    };
    visit(tree);
  };
}
