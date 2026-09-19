import { triggerIngress } from '@platform/core/trigger-ingress';
import { scheduleTraceFlush } from '@/lib/trace-flush';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ connection_id: string }> }) {
  scheduleTraceFlush();
  return triggerIngress(request, 'slack', (await context.params).connection_id);
}
