import {
  Archive,
  Braces,
  File,
  FileCode2,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  FolderOpen,
  Link2,
  Music,
  Settings,
} from 'lucide-react';
import type { FileTreeNode } from './file-tree-model';

export function FileIcon({
  path,
  kind = 'file',
  expanded = false,
  size = 16,
}: {
  path: string;
  kind?: FileTreeNode['kind'];
  expanded?: boolean;
  size?: number;
}) {
  const name = path.split('/').pop() ?? path;
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  let Icon = File;
  let tone = 'neutral';
  if (kind === 'directory') {
    Icon = expanded ? FolderOpen : Folder;
    tone = 'folder';
  } else if (kind === 'symlink') Icon = Link2;
  else if (/^(md|mdx|markdown|txt|rst|rtf|pdf)$/.test(extension)) {
    Icon = FileText;
    tone = 'document';
  } else if (
    /^(js|jsx|ts|tsx|py|rb|go|rs|java|c|h|cpp|cs|php|sh|bash|sql|html|css|scss|vue|svelte)$/.test(extension)
  ) {
    Icon = FileCode2;
    tone = 'code';
  } else if (/^(json|jsonc|jsonl)$/.test(extension)) {
    Icon = FileJson;
    tone = 'data';
  } else if (/^(csv|tsv|xlsx?|parquet)$/.test(extension)) {
    Icon = FileSpreadsheet;
    tone = 'data';
  } else if (/^(png|jpe?g|gif|webp|svg|avif|ico|bmp)$/.test(extension)) {
    Icon = FileImage;
    tone = 'image';
  } else if (/^(mp4|webm|mov|mkv)$/.test(extension)) Icon = Film;
  else if (/^(mp3|wav|ogg|flac|m4a)$/.test(extension)) Icon = Music;
  else if (/^(zip|gz|tar|tgz|7z|rar)$/.test(extension)) Icon = Archive;
  else if (/^(yaml|yml|toml|ini|conf|env)$/.test(extension) || name.startsWith('.env')) Icon = Settings;
  else if (/^(xml|graphql)$/.test(extension)) Icon = Braces;
  return <Icon size={size} aria-hidden="true" className={`worktree-file-icon file-icon-${tone}`} />;
}
