import { describe, expect, it } from 'vitest';
import {
  claudeFallbackDecision,
  requireClaudeSubscriptionExecution,
} from '../../packages/core/src/claude-connections';

const safe = {
  quota: 'exhausted' as const,
  execution: 'not_started' as const,
  fallback: { enabled: true, connection_id: 'selected-backup', max_cost_micro_usd: '1000000' },
  requestedMicroUsd: 300000n,
  spentMicroUsd: 500000n,
  reservedMicroUsd: 200000n,
};
describe('Claude subscription spending policy', () => {
  it('keeps hosted subscription execution closed independently of environment flags', () => {
    expect(requireClaudeSubscriptionExecution).toThrow(
      expect.objectContaining({ code: 'claude_subscription_unavailable' }),
    );
  });
  it.each(['available', 'unknown'] as const)(
    'does not use unknown quota, auth errors or transient errors as spending authority (%s)',
    (quota) => {
      expect(claudeFallbackDecision({ ...safe, quota })).toBe('subscription');
    },
  );
  it('defaults to no API fallback', () => {
    expect(claudeFallbackDecision({ ...safe, fallback: null })).toBe('quota_exhausted');
  });
  it.each(['started', 'uncertain'] as const)(
    'requires explicit continuation after %s execution',
    (execution) => {
      expect(claudeFallbackDecision({ ...safe, execution })).toBe('continuation_required');
    },
  );
  it('accepts the exact spending ceiling including concurrent reservations', () => {
    expect(claudeFallbackDecision(safe)).toBe('api_fallback');
    expect(claudeFallbackDecision({ ...safe, requestedMicroUsd: safe.requestedMicroUsd + 1n })).toBe(
      'fallback_budget_exhausted',
    );
  });
  it.each([
    { requestedMicroUsd: 0n },
    { requestedMicroUsd: -1n },
    { spentMicroUsd: -1n },
    { reservedMicroUsd: -1n },
    { fallback: { ...safe.fallback, max_cost_micro_usd: 'NaN' } },
    { fallback: { ...safe.fallback, max_cost_micro_usd: '0' } },
  ])('rejects invalid budget inputs ($requestedMicroUsd / $spentMicroUsd / $reservedMicroUsd)', (change) => {
    expect(claudeFallbackDecision({ ...safe, ...change })).toBe('fallback_budget_exhausted');
  });
});
