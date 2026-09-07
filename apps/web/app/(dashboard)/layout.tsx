import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@platform/core/auth';
import { config, isLocal } from '@platform/core/config';
import { Shell } from '../../components/shell';
export const dynamic = 'force-dynamic';
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  // The index also serves the public landing page. The catch-all page protects
  // authenticated routes; sharing this layout keeps the shell mounted at / too.
  if (!session) return children;
  if (!session.user.emailVerified) redirect('/verify');
  return (
    <Shell
      name={config.name}
      local={isLocal()}
      user={{ name: session.user.name, email: session.user.email }}
      operator={config.operatorEmails.includes(session.user.email.toLowerCase())}
    >
      {children}
    </Shell>
  );
}
