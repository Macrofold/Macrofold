import { handleCustomerMcp } from '@platform/core/customer-mcp';
import { after } from 'next/server';
import { dispatchRuns } from '@/lib/dispatch';
import { scheduleTraceFlush } from '@/lib/trace-flush';
export const runtime = 'nodejs';
export const maxDuration = 300;
const route = (request: Request) => {
  const hostDeadlineAtMs = Date.now() + maxDuration * 1000;
  scheduleTraceFlush();
  return handleCustomerMcp(
    request,
    () => after(dispatchRuns),
    (task) => after(task),
    hostDeadlineAtMs,
  );
};
export const GET = route,
  POST = route,
  DELETE = route;
