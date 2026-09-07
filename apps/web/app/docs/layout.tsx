import { config } from '@platform/core/config';
import { DocsShell } from '../../components/docs-shell';
import { navigation } from '../../lib/docs/content';
import './docs.css';
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <DocsShell name={config.name} items={navigation}>
      {children}
    </DocsShell>
  );
}
