import type { Tx } from '../../db';
import type { QueryResult } from 'pg';
import { unseal } from './crypto';
import { assert } from './errors';

type ModelCredentialBinding = {
  provider: string;
  billing_mode: string;
  provider_connection_id?: string;
};

/** Current credentials may share an ordered guard group after its locks. Only
 * the exact credential fields cross the wire, never tool catalogs or settings. */
export function modelCredentialQuery(binding: ModelCredentialBinding) {
  if (binding.billing_mode !== 'byok') return;
  assert(binding.provider_connection_id, 400, 'connection_required', 'Select a provider connection.');
  return {
    text: `SELECT id,data->>'provider' AS provider,data->>'status' AS status,
      data->>'owner_subject_id' AS owner_subject_id,data->>'secret_ciphertext' AS secret_ciphertext
      FROM connections WHERE id=$1`,
    values: [binding.provider_connection_id],
  };
}

export function modelCredentialFromResult(
  userId: string,
  binding: ModelCredentialBinding,
  result?: QueryResult<Record<string, unknown>>,
) {
  if (binding.billing_mode === 'byok') {
    assert(binding.provider_connection_id, 400, 'connection_required', 'Select a provider connection.');
    const connection = result?.rows[0];
    assert(connection, 404, 'not_found', 'Resource not found.');
    assert(
      // PostgreSQL projects UUIDs in lower case; public UUID selectors accept both.
      connection.id === binding.provider_connection_id.toLowerCase() &&
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

/** Exact funding binding shared by native and direct requests. Revocation is
 * checked per invocation; a BYOK failure never substitutes a managed key. */
export async function modelCredential(tx: Tx, userId: string, binding: ModelCredentialBinding) {
  const query = modelCredentialQuery(binding);
  return modelCredentialFromResult(userId, binding, query ? await tx.query(query) : undefined);
}
