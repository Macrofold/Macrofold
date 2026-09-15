import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@platform/core/auth';
import { config } from '@platform/core/config';
import { Dashboard } from '../../../components/dashboard';
import { Marketing } from '../../../components/marketing';
import { headline, subtitle } from '../../../components/landing/content';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ page?: string[] }>;
}): Promise<Metadata> {
  if ((await params).page?.length) return {};
  return { title: { absolute: `${headline} · ${config.name}` }, description: subtitle };
}

export default async function Page({ params }: { params: Promise<{ page?: string[] }> }) {
  const segments = (await params).page || [];
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    if (segments.length) redirect('/login');
    return <Marketing name={config.name} />;
  }
  return <Dashboard segments={segments} />;
}
