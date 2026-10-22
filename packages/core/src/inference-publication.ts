import type { Tx } from '../../db';
import type { InferenceRunRow } from './runs';
import type { InferenceReceipt } from './decision';
import { actorAuthorized } from './actor-authorization';
import { authorizeContext } from './context-artifacts';
import { principalFor } from './engine';
import { AppError, assert } from './errors';
import { authorizeDeploymentInvocationTx } from './model-deployments';

/** The caller holds the fresh Run lock. Provider usage is independent of
 * publication authority: denial removes the value, never incurred accounting.
 * Optional actor facts must be decoded from this same transaction after its
 * Run lock, never inferred from the admitted configuration or a prior request.
 * See docs/features/decisions/implementation.md#shared-sql-ownership. */
export async function inferencePublicationReceipt(
  tx: Tx,
  current: InferenceRunRow,
  expectedGeneration: string,
  receipt: InferenceReceipt,
  contextExpiresAt?: Date | null,
  currentActorAllowed?: boolean,
): Promise<InferenceReceipt> {
  assert(
    current.lease_generation === expectedGeneration,
    409,
    'inference_owner_changed',
    'Recovery owns this invocation.',
  );
  let allowed =
    !current.result.content_expired && (currentActorAllowed ?? (await actorAuthorized(tx, current)));
  if (allowed && current.config.deployment_target) {
    try {
      await authorizeDeploymentInvocationTx(
        tx,
        principalFor(current),
        current.config.deployment_target,
        current.workspace_id ?? undefined,
      );
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      allowed = false;
    }
  }
  const references = current.config.context_reference ? [current.config.context_reference] : [];
  if (allowed && current.kind === 'bounded_agent' && current.config.definition.bounded_agent) {
    // Evidence retained for recovery does not retain a revoked disclosure grant.
    const used = await tx.query<{ artifact_id: string }>(
      'SELECT DISTINCT artifact_id FROM decision_tool_steps WHERE run_id=$1',
      [current.id],
    );
    for (const { artifact_id } of used.rows) {
      const reference = current.config.definition.bounded_agent.context_artifacts.find(
        (candidate) => candidate.artifact_id === artifact_id,
      );
      if (!reference) allowed = false;
      else references.push(reference);
    }
  }
  if (allowed && references.length) {
    try {
      allowed = await actorAuthorized(tx, current, 'files:read');
      if (allowed)
        for (const reference of references)
          await authorizeContext(tx, principalFor(current), current.workspace_id, reference);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      allowed = false;
    }
  }
  if (!allowed) {
    const { value: _value, ...rest } = receipt;
    receipt = {
      ...rest,
      outcome: 'failed',
      reason_code: current.result.content_expired ? 'content_expired' : 'authorization_revoked',
    };
  }
  if (contextExpiresAt && contextExpiresAt.getTime() <= Date.now() && receipt.outcome === 'value') {
    const { value: _value, ...rest } = receipt;
    receipt = { ...rest, outcome: 'stale_input', reason_code: 'context_expired' };
  }
  return receipt;
}
