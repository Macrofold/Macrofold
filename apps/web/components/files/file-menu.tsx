'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';
import { Files, FilePlus2, FolderPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { CopyButton } from '../copy-button';
import { useRef } from 'react';

export type FileMenuAction = 'file' | 'folder' | 'duplicate' | 'rename' | 'delete';
/** One menu for pointer and keyboard access. Cloud paths are relative to the worktree root. */
export function FileMenu({
  path,
  directory,
  disabled,
  onAction,
}: {
  path: string;
  directory: boolean;
  disabled: boolean;
  onAction: (action: FileMenuAction) => void;
}) {
  const name = path.split('/').pop() || path;
  const renameAfterClose = useRef(false);
  return (
    <Menu.Root>
      <Menu.Trigger
        className="icon-button workspace-tree-menu"
        aria-label={`Actions for ${name}`}
        onClick={(event) => event.stopPropagation()}
      >
        <MoreHorizontal size={15} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="dropdown-content file-context-menu"
          side="right"
          align="start"
          sideOffset={5}
          onClick={(event) => event.stopPropagation()}
          onCloseAutoFocus={(event) => {
            // Wait for Radix to release its modal focus trap before mounting the input.
            if (renameAfterClose.current) {
              event.preventDefault();
              renameAfterClose.current = false;
              onAction('rename');
            }
          }}
        >
          {directory && (
            <>
              <Menu.Item disabled={disabled} onSelect={() => onAction('file')}>
                <FilePlus2 size={15} />
                New file
              </Menu.Item>
              <Menu.Item disabled={disabled} onSelect={() => onAction('folder')}>
                <FolderPlus size={15} />
                New folder
              </Menu.Item>
              <Menu.Separator />
            </>
          )}
          <Menu.Item asChild onSelect={(event) => event.preventDefault()}>
            <CopyButton variant="plain" text={name} label="Copy name" />
          </Menu.Item>
          <Menu.Item asChild onSelect={(event) => event.preventDefault()}>
            <CopyButton variant="plain" text={path} label="Copy path" />
          </Menu.Item>
          {!directory && (
            <>
              <Menu.Item disabled={disabled} onSelect={() => onAction('duplicate')}>
                <Files size={15} />
                Duplicate
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item
                disabled={disabled}
                onSelect={() => {
                  renameAfterClose.current = true;
                }}
              >
                <Pencil size={15} />
                Rename
              </Menu.Item>
              <Menu.Item className="file-menu-delete" disabled={disabled} onSelect={() => onAction('delete')}>
                <Trash2 size={15} />
                Delete
              </Menu.Item>
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
