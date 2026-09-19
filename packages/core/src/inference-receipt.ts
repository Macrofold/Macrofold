import type { InferenceConfig } from './runs';
import type { InferenceReceipt } from './decision';
import { digest } from './explicit-context';

export function initialReceipt(configuration: InferenceConfig, invocationId: string): InferenceReceipt {
  return {
    invocation_id: invocationId,
    definition_revision: configuration.definition.revision,
    definition_digest: configuration.definition_digest,
    context_digest: configuration.context_digest,
    provider_request_digest: null,
    transformation_version: configuration.transformation_version,
    dependency_tokens: configuration.context.dependency_tokens,
    outcome: 'unknown',
    provider_outcome: 'not_invoked',
    model: configuration.model,
    model_revision: null,
    model_revision_status: 'unavailable',
    validation: { schema_digest: digest(configuration.definition.output_schema), status: 'not_run' },
  };
}
