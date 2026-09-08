import { triggerIngress } from '@platform/core/trigger-ingress';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ connection_id: string }> }) {
  return triggerIngress(request, 'slack', (await context.params).connection_id);
}
