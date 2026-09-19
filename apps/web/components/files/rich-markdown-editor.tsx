'use client';

import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import {
  Bold,
  Italic,
  Strikethrough,
  Pilcrow,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Link,
  ImageIcon,
  MoreHorizontal,
  Undo2,
  Redo2,
  Code2,
} from 'lucide-react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Field, Loading } from '../ui';
import { extractMarkdownFrontMatter, resolveMarkdownLink } from './markdown-model';
import { MarkdownPreview } from './markdown-preview';
import './rich-markdown.css';

// Preserve Markdown image syntax without fetching user-authored remote URLs on render.
const SafeImage = Image.extend({
  renderHTML({ node }) {
    return [
      'span',
      { class: 'rich-image-reference', 'data-image-path': node.attrs.src },
      `Image: ${node.attrs.alt || node.attrs.src}`,
    ];
  },
  addNodeView() {
    return null;
  },
});
const AccessibleTaskItem = TaskItem.extend({
  addNodeView() {
    const parent = this.parent?.();
    if (!parent) return null;
    return (props) => {
      const view = parent(props);
      const label = (text: string) => {
        if (view.dom instanceof HTMLElement)
          view.dom.querySelector('input')?.setAttribute('aria-label', text || 'Task');
      };
      label(props.node.textContent);
      const update = view.update;
      view.update = (node, decorations, innerDecorations) => {
        const handled = update?.(node, decorations, innerDecorations) ?? false;
        if (handled) label(node.textContent);
        return handled;
      };
      return view;
    };
  },
});
const extensions = [
  StarterKit.configure({
    underline: false,
    link: { openOnClick: false, isAllowedUri: (url) => resolveMarkdownLink(url).kind !== 'blocked' },
  }),
  Markdown,
  TableKit,
  TaskList,
  AccessibleTaskItem.configure({ nested: true }),
  SafeImage,
  Details.configure({ persist: true }),
  DetailsSummary,
  DetailsContent,
];

/** Tiptap owns selection, keyboard commands and Markdown serialization. Front matter
 * stays byte-for-byte intact; unsupported HTML/footnotes remain editable in Source. */
export default function RichMarkdownEditor({
  content,
  editable,
  onChange,
  filePath,
  onOpenFile,
  initialAnchor,
}: {
  content: string;
  editable: boolean;
  onChange: (text: string) => void;
  filePath: string;
  onOpenFile: (path: string, anchor?: string) => void;
  initialAnchor?: string;
}) {
  const parts = extractMarkdownFrontMatter(content);
  const raw = parts?.raw ?? '',
    body = parts?.body ?? content;
  const unsupported = /<\/?[a-z][^>]*>|^\[\^[^\]]+\]:/im.test(
    body.replace(/```[^]*?```|`[^`]*`|<br\s*\/?\s*>/gi, ''),
  );
  const current = useRef({ raw, onChange });
  current.current = { raw, onChange };
  const emitted = useRef(content);
  const editor = useEditor({
    extensions,
    content: body,
    contentType: 'markdown',
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editable: editable && !unsupported,
    editorProps: {
      attributes: {
        class: 'worktree-markdown-body rich-markdown-body',
        'aria-label': 'Rich Markdown editor',
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor }) => {
      emitted.current = current.current.raw + editor.getMarkdown();
      current.current.onChange(emitted.current);
    },
  });
  useEffect(() => {
    // Permission/save-state changes are not document edits. Tiptap emits an update
    // by default here, which would normalize and autosave untouched Markdown.
    editor?.setEditable(editable && !unsupported, false);
  }, [editor, editable, unsupported]);
  useEffect(() => {
    if (!editor || content === emitted.current) return;
    editor.commands.setContent(body, { contentType: 'markdown', emitUpdate: false });
    emitted.current = content;
  }, [editor, content, body]);
  if (!editor) return <Loading />;
  return (
    <div className="rich-markdown-editor">
      <RichToolbar editor={editor} disabled={!editable || unsupported} />
      {unsupported ? (
        <>
          <p className="rich-editor-note">
            This document contains HTML or footnotes. Use Source to preserve that syntax while editing.
          </p>
          <MarkdownPreview
            content={content}
            filePath={filePath}
            onOpenFile={onOpenFile}
            initialAnchor={initialAnchor}
          />
        </>
      ) : (
        <>
          {raw && (
            <details className="rich-frontmatter">
              <summary>Document metadata</summary>
              <pre>{raw}</pre>
            </details>
          )}
          <EditorContent editor={editor} className="rich-editor-surface" />
        </>
      )}
    </div>
  );
}

// Control grouping follows Orca's MIT RichMarkdownToolbar (see ORCA-LICENSE.txt).
function RichToolbar({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const [insert, setInsert] = useState<'link' | 'image' | null>(null);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const button = (title: string, icon: ReactNode, action: () => void, active = false) => (
    <button
      key={title}
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action}
    >
      {icon}
    </button>
  );
  const chain = () => editor.chain().focus();
  return (
    <>
      <div className="rich-markdown-toolbar" role="toolbar" aria-label="Markdown formatting">
        {button(
          'Body text',
          <Pilcrow size={15} />,
          () => chain().setParagraph().run(),
          editor.isActive('paragraph'),
        )}
        {([1, 2, 3] as const).map((level, index) =>
          button(
            `Heading ${level}`,
            [
              <Heading1 key="h1" size={15} />,
              <Heading2 key="h2" size={15} />,
              <Heading3 key="h3" size={15} />,
            ][index],
            () => chain().toggleHeading({ level }).run(),
            editor.isActive('heading', { level }),
          ),
        )}
        <span className="rich-toolbar-divider" />
        {button('Bold', <Bold size={15} />, () => chain().toggleBold().run(), editor.isActive('bold'))}
        {button(
          'Italic',
          <Italic size={15} />,
          () => chain().toggleItalic().run(),
          editor.isActive('italic'),
        )}
        {button(
          'Strike',
          <Strikethrough size={15} />,
          () => chain().toggleStrike().run(),
          editor.isActive('strike'),
        )}
        <span className="rich-toolbar-divider" />
        {button(
          'Bullet list',
          <List size={15} />,
          () => chain().toggleBulletList().run(),
          editor.isActive('bulletList'),
        )}
        {button(
          'Numbered list',
          <ListOrdered size={15} />,
          () => chain().toggleOrderedList().run(),
          editor.isActive('orderedList'),
        )}
        {button(
          'Checklist',
          <ListTodo size={15} />,
          () => chain().toggleTaskList().run(),
          editor.isActive('taskList'),
        )}
        {button(
          'Quote',
          <Quote size={15} />,
          () => chain().toggleBlockquote().run(),
          editor.isActive('blockquote'),
        )}
        {button(
          'Code block',
          <Code2 size={15} />,
          () => chain().toggleCodeBlock().run(),
          editor.isActive('codeBlock'),
        )}
        {button(
          'Link',
          <Link size={15} />,
          () => {
            setUrl(editor.getAttributes('link').href || '');
            setInsert('link');
          },
          editor.isActive('link'),
        )}
        {button('Image', <ImageIcon size={15} />, () => {
          setUrl('');
          setLabel('');
          setInsert('image');
        })}
        <Menu.Root>
          <Menu.Trigger type="button" disabled={disabled} aria-label="More formatting">
            <MoreHorizontal size={15} />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              className="dropdown-content file-context-menu"
              sideOffset={5}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                editor.commands.focus();
              }}
            >
              {([4, 5, 6] as const).map((level) => (
                <Menu.Item key={level} onSelect={() => chain().toggleHeading({ level }).run()}>
                  Heading {level}
                </Menu.Item>
              ))}
              <Menu.Item
                disabled={editor.isActive('table') || !editor.can().setDetails()}
                onSelect={() => chain().setDetails().run()}
              >
                Collapsible section
              </Menu.Item>
              <Menu.Item
                onSelect={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
              >
                Insert table
              </Menu.Item>
              {editor.isActive('table') && (
                <>
                  <Menu.Item onSelect={() => chain().addRowAfter().run()}>Add row</Menu.Item>
                  <Menu.Item onSelect={() => chain().addColumnAfter().run()}>Add column</Menu.Item>
                  <Menu.Item onSelect={() => chain().deleteRow().run()}>Delete row</Menu.Item>
                  <Menu.Item onSelect={() => chain().deleteColumn().run()}>Delete column</Menu.Item>
                  <Menu.Item onSelect={() => chain().deleteTable().run()}>Delete table</Menu.Item>
                </>
              )}
              <Menu.Item onSelect={() => chain().setHorizontalRule().run()}>Divider</Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
        <span className="rich-toolbar-divider" />
        {button('Undo', <Undo2 size={15} />, () => chain().undo().run())}
        {button('Redo', <Redo2 size={15} />, () => chain().redo().run())}
      </div>
      {insert && (
        <form
          className="rich-insert-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (url && resolveMarkdownLink(url).kind === 'blocked') return;
            if (insert === 'image') chain().setImage({ src: url, alt: label }).run();
            else if (url) chain().extendMarkRange('link').setLink({ href: url }).run();
            else chain().extendMarkRange('link').unsetLink().run();
            setInsert(null);
          }}
        >
          <Field label={insert === 'image' ? 'Image path or URL' : 'Link URL'}>
            <input autoFocus value={url} onChange={(event) => setUrl(event.target.value)} />
          </Field>
          {insert === 'image' && (
            <Field label="Image description">
              <input value={label} onChange={(event) => setLabel(event.target.value)} />
            </Field>
          )}
          <Button
            type="submit"
            disabled={
              Boolean(url && resolveMarkdownLink(url).kind === 'blocked') || (insert === 'image' && !url)
            }
          >
            Apply
          </Button>
          <Button type="button" variant="ghost" onClick={() => setInsert(null)}>
            Cancel
          </Button>
        </form>
      )}
    </>
  );
}
