import { z } from 'zod';
import type { HostBinding, HostControlRequest } from '../../contracts/host-control';
import { boundedJSON } from '../../core/src/body';
import { assert } from '../../core/src/errors';

/** The provider validates its origin before passing it here. Both transports use
 * the same authenticated, boot-fenced controller protocol and byte/deadline cap. */
export async function hostHttpControl(
  request: typeof fetch,
  origin: string,
  binding: HostBinding,
  secret: string,
  operation: HostControlRequest,
) {
  const body = JSON.stringify({ boot_id: binding.controlBootId, request: operation });
  assert(
    Buffer.byteLength(body) <= 8 * 1024 * 1024,
    413,
    'stage_too_large',
    'Control transfer exceeds its byte limit.',
  );
  const signal = AbortSignal.timeout(operation.action === 'health' ? 5000 : 60000);
  const response = await request(`${origin}/control`, {
    method: 'POST',
    redirect: 'error',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body,
    signal,
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    assert(false, 503, 'host_control_failed', 'The Host did not confirm this operation.');
  }
  return z.object({ value: z.unknown() }).parse(await boundedJSON(response, 8 * 1024 * 1024, signal)).value;
}
