import type { components } from '../../contracts/api';
import type { Tx } from '../../db';
import type { Principal } from './auth';
import { assert } from './errors';
import * as resources from './resources';

type Fallback = components['schemas']['ClaudeApiFallback'];

// Deliberately not an environment flag. Native login, credential isolation and
// vendor permission must be reviewed together before this release gate opens.
export function requireClaudeSubscriptionExecution(): never {
  assert(
    false,
    503,
    'claude_subscription_unavailable',
    'Claude subscription authentication is not available. Hosted use requires provider approval and a validated isolated authentication runtime. Use an Anthropic API-key connection meanwhile.',
  );
}

export async function validateClaudeFallback(tx: Tx, p: Principal, fallback?: Fallback | null) {
  if (!fallback?.enabled) return { enabled: false };
  assert(
    fallback.connection_id &&
      typeof fallback.max_cost_micro_usd === 'string' &&
      /^\d{1,12}$/.test(fallback.max_cost_micro_usd) &&
      BigInt(fallback.max_cost_micro_usd) > 0n,
    400,
    'invalid_fallback_budget',
    'An API fallback requires an explicit positive per-run spending limit.',
  );
  const backup = await resources.get(tx, 'connections', fallback.connection_id, p);
  assert(backup.owner_subject_id === p.userId, 403, 'forbidden', 'The backup API key must belong to you.');
  assert(
    backup.kind === 'model' &&
      backup.provider === 'anthropic' &&
      backup.status === 'healthy' &&
      backup.secret_ciphertext,
    400,
    'credentials_incompatible',
    'Choose an available Anthropic API-key connection as the backup.',
  );
  return { enabled: true, connection_id: backup.id, max_cost_micro_usd: fallback.max_cost_micro_usd };
}

/** A provider quota response is evidence; an error string or an empty usage
 * response is not. Never replay a launched prompt to change funding. */
export function claudeFallbackDecision(input: {
  quota: 'exhausted' | 'available' | 'unknown';
  execution: 'not_started' | 'started' | 'uncertain';
  fallback: Fallback | null;
  requestedMicroUsd: bigint;
  spentMicroUsd: bigint;
  reservedMicroUsd: bigint;
}) {
  if (input.quota !== 'exhausted') return 'subscription' as const;
  if (input.execution !== 'not_started') return 'continuation_required' as const;
  if (!input.fallback?.enabled) return 'quota_exhausted' as const;
  const { requestedMicroUsd: requested, spentMicroUsd: spent, reservedMicroUsd: reserved } = input;
  if (
    requested <= 0n ||
    spent < 0n ||
    reserved < 0n ||
    !input.fallback.connection_id ||
    typeof input.fallback.max_cost_micro_usd !== 'string' ||
    !/^\d{1,12}$/.test(input.fallback.max_cost_micro_usd) ||
    requested + spent + reserved > BigInt(input.fallback.max_cost_micro_usd)
  )
    return 'fallback_budget_exhausted' as const;
  return 'api_fallback' as const;
}
