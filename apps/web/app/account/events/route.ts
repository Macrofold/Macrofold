import { dashboardAccess, readDashboardSnapshot } from '@platform/core/dashboard-freshness';
import { errorBody } from '@platform/core/errors';
import { dashboardStream, DashboardStreamHub } from '../../../lib/dashboard-stream-hub';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const shared = globalThis as typeof globalThis & { dashboardHub?: DashboardStreamHub };
const hub = (shared.dashboardHub ||= new DashboardStreamHub(readDashboardSnapshot));

export async function GET(request: Request) {
  try {
    return dashboardStream(hub, await dashboardAccess(request), request.signal);
  } catch (error) {
    const result = errorBody(error, crypto.randomUUID());
    return Response.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
  }
}
