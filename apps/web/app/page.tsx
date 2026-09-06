import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@platform/core/auth';
import { config, isLocal } from '@platform/core/config';
import { Dashboard } from '../components/dashboard';
import { Shell } from '../components/shell';
import { Marketing } from '../components/marketing';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return <Marketing name={config.name} />;
  if (!session.user.emailVerified) redirect('/verify');
  return (
    <Shell
      name={config.name}
      local={isLocal()}
      user={{ name: session.user.name, email: session.user.email }}
      operator={config.operatorEmails.includes(session.user.email.toLowerCase())}
    >
      <Dashboard segments={[]} />
    </Shell>
  );
}
