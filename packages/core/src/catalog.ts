import { config, isLocal } from './config';
import { z } from 'zod';
import { AppError } from './errors';
export const harnesses = [
  {
    id: 'codex',
    name: 'Codex',
    provider: 'OpenAI',
    description: 'Engineering and complex repository work',
    capabilities: { streaming: true, continuation: true, cancellation: true, mcp: true },
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    provider: 'Anthropic',
    description: 'Research, writing, and thoughtful code changes',
    capabilities: { streaming: true, continuation: true, cancellation: true, mcp: true },
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    provider: 'Multi-provider',
    description: 'Flexible, open-source agent workflows',
    capabilities: { streaming: true, continuation: true, cancellation: true, mcp: true },
  },
];
export type Model = {
  id: string;
  name: string;
  provider: string;
  harnesses: string[];
  input_micro_usd_per_million: string;
  output_micro_usd_per_million: string;
  enabled: boolean;
  simulated?: boolean;
};
export function models(): Model[] {
  if (isLocal() && config.execution === 'simulator')
    return [
      {
        id: 'fixture-model',
        name: 'Simulation · no model charges',
        provider: 'fixture',
        harnesses: harnesses.map((h) => h.id),
        input_micro_usd_per_million: '0',
        output_micro_usd_per_million: '0',
        enabled: true,
        simulated: true,
      },
    ];
  try {
    const schema = z.array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        provider: z.enum(['openai', 'anthropic', 'openrouter']),
        harnesses: z.array(z.enum(['codex', 'claude-code', 'opencode'])).min(1),
        input_micro_usd_per_million: z.string().regex(/^\d{1,15}$/),
        output_micro_usd_per_million: z.string().regex(/^\d{1,15}$/),
        enabled: z.boolean(),
      }),
    );
    const values = schema.parse(JSON.parse(process.env.MODEL_CATALOG_JSON || '[]'));
    if (
      new Set(values.map((v) => v.id)).size !== values.length ||
      values.some((v) =>
        v.harnesses.some(
          (h) =>
            (h === 'codex' && v.provider !== 'openai') || (h === 'claude-code' && v.provider !== 'anthropic'),
        ),
      )
    )
      throw new Error('Incompatible model catalog');
    return values;
  } catch {
    throw new AppError(
      503,
      'invalid_model_catalog',
      'The operator must repair the configured model catalog.',
    );
  }
}
