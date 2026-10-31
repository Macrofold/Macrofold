import type { InferenceConfig, ImmediateInferenceConfig } from './runs';
import type { InferenceReceipt } from './decision';
import { digest } from './explicit-context';
import { inferenceUsage, inferenceBilling } from './model-gateway';
import { emptyUsage } from './model-protocol';

/** Provider messages can echo request content. Keep both disclosure fields in
 * encrypted invocation evidence, never the unencrypted Run summary. */
export function inferenceReceiptMetadata(receipt: InferenceReceipt) {
  const { value: _value, provider_error: _providerError, ...metadata } = receipt;
  return metadata;
}

export function initialReceipt(
  configuration: InferenceConfig | ImmediateInferenceConfig,
  invocationId: string,
): InferenceReceipt {
  return {
    ...(configuration.deployment_target
      ? {
          deployment: {
            deployment_id: configuration.deployment_target.deployment_id,
            deployment_revision_id: configuration.deployment_target.deployment_revision_id,
          },
          cost_attribution: {
            basis: 'deployment' as const,
            deployment_id: configuration.deployment_target.deployment_id,
            infrastructure_cost_included: false as const,
          },
        }
      : {}),
    invocation_id: invocationId,
    definition_revision:
      'payload_kind' in configuration ? configuration.definition_revision : configuration.definition.revision,
    definition_digest: configuration.definition_digest,
    context_digest: configuration.context_digest,
    provider_request_digest: null,
    transformation_version: configuration.transformation_version,
    dependency_tokens:
      'payload_kind' in configuration
        ? configuration.dependency_tokens
        : configuration.context.dependency_tokens,
    outcome: 'unknown',
    provider_outcome: 'not_invoked',
    model: configuration.model,
    model_revision: null,
    model_revision_status: 'unavailable',
    validation: {
      schema_digest:
        'payload_kind' in configuration
          ? configuration.schema_digest
          : digest(configuration.definition.output_schema),
      status: 'not_run',
    },
    usage: inferenceUsage(emptyUsage(), true),
    billing: inferenceBilling(undefined, configuration.billing_mode, true),
  };
}
