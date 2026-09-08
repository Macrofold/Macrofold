import { triggerIngress } from '@platform/core/trigger-ingress';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ trigger_id: string }> }) {
  return triggerIngress(request, 'webhook', (await context.params).trigger_id);
}
