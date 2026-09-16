import { z } from 'zod';
import { boundedBody } from '@platform/core/body';
import { config } from '@platform/core/config';
import { assert, errorBody } from '@platform/core/errors';
import {
  consentHeaders,
  describeCustomerConsent,
  startCustomerConsent,
} from '@platform/core/customer-connect';
import { composioCustomerConsent } from '@platform/providers/composio-consent';
export const runtime = 'nodejs';
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('describe'), ticket: z.string().min(20).max(4096) }).strict(),
  z
    .object({
      action: z.literal('start'),
      ticket: z.string().min(20).max(4096),
      capability_ids: z.array(z.string().max(100)).max(12),
    })
    .strict(),
]);
export async function POST(request: Request) {
  try {
    assert(
      request.headers.get('origin') === config.origin,
      403,
      'invalid_origin',
      'Open the connection link in your browser.',
    );
    let body: unknown;
    try {
      body = JSON.parse((await boundedBody(request.body, 8192)).toString());
    } catch {
      assert(false, 400, 'invalid_request', 'Use a valid connection request.');
    }
    const parsed = bodySchema.safeParse(body);
    assert(parsed.success, 400, 'invalid_request', 'Use a valid connection request.');
    const value = parsed.data;
    return value.action === 'describe'
      ? Response.json(await describeCustomerConsent(value.ticket), { headers: consentHeaders })
      : await startCustomerConsent(value.ticket, value.capability_ids, composioCustomerConsent);
  } catch (e) {
    const error = errorBody(e, crypto.randomUUID());
    return Response.json(error.body, { status: error.status, headers: consentHeaders });
  }
}
