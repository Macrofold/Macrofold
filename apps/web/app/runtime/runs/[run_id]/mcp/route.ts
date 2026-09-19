import { handleRuntimeMcp } from '@platform/core/tool-broker';
import { scheduleTraceFlush } from '@/lib/trace-flush';
export const runtime = 'nodejs';
export const maxDuration = 60;
const handler = async (request: Request, context: { params: Promise<{ run_id: string }> }) => {
  scheduleTraceFlush();
  return handleRuntimeMcp(request, (await context.params).run_id);
};
export const POST = handler,
  GET = handler,
  DELETE = handler;
