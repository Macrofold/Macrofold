import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@platform/core/auth';
import { config } from '@platform/core/config';
import { Dashboard } from '../../../components/dashboard';
import { Marketing } from '../../../components/marketing';

export default async function Page({ params }: { params: Promise<{ page?: string[] }> }) {
  const segments = (await params).page || [];
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    if (segments.length) redirect('/login');
    return <Marketing name={config.name} />;
  }
  return <Dashboard segments={segments} />;
}
