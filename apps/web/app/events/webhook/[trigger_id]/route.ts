import { triggerIngress } from '@platform/core/trigger-ingress';
import { scheduleTraceFlush } from '@/lib/trace-flush';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ trigger_id: string }> }) {
  scheduleTraceFlush();
  return triggerIngress(request, 'webhook', (await context.params).trigger_id);
}
