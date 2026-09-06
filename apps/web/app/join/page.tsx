import { headers } from 'next/headers';
import { auth } from '@platform/core/auth';
import { JoinOrganization } from '../../components/team';
export const dynamic = 'force-dynamic';
export const metadata = { referrer: 'no-referrer', robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  return (
    <JoinOrganization token={(await searchParams).token || ''} signedIn={!!session?.user.emailVerified} />
  );
}
