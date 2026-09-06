import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@platform/core/auth';
import { DeviceAuthorization } from '../../components/auth-actions';
export default async function Page({ searchParams }: { searchParams: Promise<{ user_code?: string }> }) {
  const { user_code = '' } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user)
    redirect(`/login?returnTo=${encodeURIComponent(`/device?user_code=${encodeURIComponent(user_code)}`)}`);
  if (!session.user.emailVerified) redirect('/verify');
  return <DeviceAuthorization initialCode={user_code} />;
}
