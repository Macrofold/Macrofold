import { dispatchMaintenance } from '@platform/core/git-jobs';
import { dispatchRuns } from '@/lib/dispatch';
import { sameSecret } from '@platform/core/crypto';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !sameSecret(request.headers.get('authorization') || '', `Bearer ${secret}`))
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.json({ ...(await dispatchRuns()), ...(await dispatchMaintenance()) });
}
