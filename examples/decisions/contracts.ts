import type { Schema } from '../../sdk/typescript/src/client';

/** Original, domain-independent integration fixtures. No domain logic runs in Macrofold. */
export function decisionExample(
  workspaceId: string,
  scenario: 'triage' | 'actor',
): Schema['InferenceCreate'] & {
  definition: Schema['InferenceDefinition'];
  context: Schema['ExplicitContext'];
} {
  const triage = scenario === 'triage';
  return {
    workspace_id: workspaceId,
    input: { subject_id: triage ? 'case-42' : 'actor-42' },
    definition: {
      revision: `${scenario}/1`,
      prompt: triage
        ? 'Classify a customer exception. Unknown evidence means abstain.'
        : 'Propose wait or investigate from the supplied observations only. Unknown evidence means abstain.',
      input_schema: {
        type: 'object',
        properties: { subject_id: { type: 'string' } },
        required: ['subject_id'],
        additionalProperties: false,
      },
      output_schema: { type: 'string', enum: ['wait', 'investigate', 'unknown'] },
      question: {
        kind: 'choice',
        criteria: {
          wait: 'No relevant change',
          investigate: 'Relevant change needs inspection',
          unknown: 'Insufficient evidence',
        },
      },
      unknown_values: ['unknown'],
      required_records: ['observation'],
      require_complete: true,
      require_snapshot: true,
      allowed_models: [
        { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
        { provider: 'typesafe', model: 'jev-1.13.0' },
        { provider: 'openrouter', model: 'typesafe/jev-1.13' },
      ],
      limits: { max_cost_micro_usd: '20000', max_output_tokens: 256, timeout_seconds: 20 },
    },
    model_binding: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', billing_mode: 'managed' },
    context: {
      schema_version: 1,
      template_revision: `${scenario}-context/1`,
      audience: { kind: 'application_actor', id: triage ? 'customer-42' : 'actor-42' },
      items: [
        {
          id: 'observation',
          kind: 'observation',
          status: 'unknown',
          source: triage ? 'app:customer-case' : 'app:perception',
          source_revision: '7',
          observed_at: '2026-09-19T12:00:00Z',
        },
      ],
      observed_at: '2026-09-19T12:00:00Z',
      consistency: 'snapshot',
      complete: true,
      truncated: false,
      dependency_tokens: triage
        ? { case: '7', customer_cases_query: '12' }
        : { actor: '7', visible_region_query: '12' },
    },
  };
}
