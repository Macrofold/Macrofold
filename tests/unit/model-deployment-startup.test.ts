import { expect, it } from 'vitest';
import {
  deploymentStartupExpired,
  deploymentStartupStatus,
} from '../../packages/core/src/model-deployment-startup';

const start = new Date('2030-01-01T00:00:00Z');
const clock = (readiness: string | null = null) => ({
  startup_at: start,
  readiness_started_at: readiness ? new Date(readiness) : null,
  policy: null,
});

it('has no startup status or expiry outside a startup episode', () => {
  const row = { ...clock(), startup_at: null };
  expect(deploymentStartupStatus(row)).toBeNull();
  expect(deploymentStartupExpired(row, Date.parse('2030-01-02T00:00:00Z'))).toBe(false);
});

it('allows thirty minutes for allocation and image startup', () => {
  expect(deploymentStartupStatus(clock())).toEqual({
    phase: 'provisioning',
    started_at: start.toISOString(),
    phase_started_at: start.toISOString(),
    deadline_at: '2030-01-01T00:30:00.000Z',
  });
  expect(deploymentStartupExpired(clock(), Date.parse('2030-01-01T00:29:59.999Z'))).toBe(false);
  expect(deploymentStartupExpired(clock(), Date.parse('2030-01-01T00:30:00Z'))).toBe(true);
});

it('gives a late eligible worker its own twenty-minute endpoint readiness phase', () => {
  const row = clock('2030-01-01T00:29:00Z');
  expect(deploymentStartupStatus(row)).toEqual({
    phase: 'model_readiness',
    started_at: start.toISOString(),
    phase_started_at: '2030-01-01T00:29:00.000Z',
    deadline_at: '2030-01-01T00:49:00.000Z',
  });
  expect(deploymentStartupExpired(row, Date.parse('2030-01-01T00:48:59.999Z'))).toBe(false);
  expect(deploymentStartupExpired(row, Date.parse('2030-01-01T00:49:00Z'))).toBe(true);
});

it('never lets a phase extend the original fifty-minute episode', () => {
  const row = clock('2030-01-01T00:40:00Z');
  expect(deploymentStartupStatus(row)?.deadline_at).toBe('2030-01-01T00:50:00.000Z');
  expect(deploymentStartupExpired(row, Date.parse('2030-01-01T00:50:00Z'))).toBe(true);
});

it('reports an earlier scheduled stop without changing shutdown into startup failure', () => {
  const row = {
    ...clock('2030-01-01T00:10:00Z'),
    policy: {
      min_replicas: 1,
      max_replicas: 1,
      max_concurrent_requests: 1,
      max_hourly_cost_micro_usd: '1000000',
      stop_at: '2030-01-01T00:12:00Z',
    },
  };
  expect(deploymentStartupStatus(row)?.deadline_at).toBe('2030-01-01T00:12:00.000Z');
  expect(deploymentStartupExpired(row, Date.parse('2030-01-01T00:12:00Z'))).toBe(false);
  expect(
    deploymentStartupStatus({ ...row, policy: { ...row.policy, stop_at: '2030-01-01T01:00:00Z' } })
      ?.deadline_at,
  ).toBe('2030-01-01T00:30:00.000Z');
});
