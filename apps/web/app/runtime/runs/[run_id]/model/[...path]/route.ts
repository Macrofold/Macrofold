import { handleModelRequest } from '@platform/core/model-gateway';
import { scheduleTraceFlush } from '@/lib/trace-flush';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ run_id: string; path: string[] }> },
) {
  scheduleTraceFlush();
  const value = await params;
  return handleModelRequest(request, value.run_id, value.path.join('/'));
}
export const PUT = POST;
