import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@platform/core/auth';
import { OAuthConsent } from '../../components/oauth-consent';
export const dynamic = 'force-dynamic';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
      params.append(key, item);
  }
  const query = params.toString();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login?returnTo=' + encodeURIComponent('/consent?' + query));
  if (!session.user.emailVerified) redirect('/verify');
  try {
    // Verify the signature before displaying permissions. The same signed request is
    // submitted to the provider, so an edited URL cannot understate the granted scopes.
    const client = await auth.api.getOAuthClientPublicPrelogin({
      body: { client_id: params.get('client_id') || '', oauth_query: query },
    });
    return (
      <OAuthConsent
        clientName={client.client_name || client.client_id}
        query={query}
        scopes={(params.get('scope') || '').split(' ').filter(Boolean)}
        resources={params.getAll('resource')}
        email={session.user.email}
      />
    );
  } catch {
    return (
      <OAuthConsent error="This authorization request is invalid or has expired. Return to the application and connect again." />
    );
  }
}
