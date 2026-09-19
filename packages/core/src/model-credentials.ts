import type { Tx } from '../../db';
import { unseal } from './crypto';
import { assert } from './errors';
import * as resources from './resources';

/** Exact funding binding shared by native and direct requests. Revocation is
 * checked per invocation; a BYOK failure never substitutes a managed key. */
export async function modelCredential(
  tx: Tx,
  userId: string,
  binding: {
    provider: string;
    billing_mode: string;
    provider_connection_id?: string;
  },
) {
  if (binding.billing_mode === 'byok') {
    assert(binding.provider_connection_id, 400, 'connection_required', 'Select a provider connection.');
    const connection = await resources.get(tx, 'connections', binding.provider_connection_id);
    assert(
      connection.provider === binding.provider &&
        connection.status === 'healthy' &&
        connection.owner_subject_id === userId,
      403,
      'credentials_unavailable',
      'The selected provider connection is no longer available.',
    );
    return unseal<string>(String(connection.secret_ciphertext));
  }
  assert(
    binding.billing_mode === 'managed',
    403,
    'funding_method_unavailable',
    'Select managed or BYOK funding.',
  );
  const secret = process.env[`${binding.provider.toUpperCase()}_API_KEY`];
  assert(secret, 503, 'provider_not_configured', 'The managed model provider is not configured.');
  return secret;
}
