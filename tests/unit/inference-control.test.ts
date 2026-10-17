import { afterEach, expect, it, vi } from 'vitest';
import {
  InferenceControlObserver,
  type InferenceControlRow,
  acquireImmediateInferencePermit,
  acquireInferenceAdmission,
  acquireInferenceRequestPermit,
} from '../../packages/core/src/inference-control';
import { apiKeyActorAuthorized } from '../../packages/core/src/actor-authorization';

const facts = {
  member_role: 'member',
  email_verified: true,
  key_bound: true,
  key_revoked: false,
  key_expired: false,
  scope_allowed: true,
  workspace_allowed: true,
  worker_allowed: true,
};
const row = (id: string): InferenceControlRow => ({
  ...facts,
  id,
  organization_id: `org-${id}`,
  lease_generation: '7',
  status: 'running',
  cancel_requested: false,
  deadline: null,
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it.each([
  { member_role: null },
  { member_role: 'viewer' },
  { email_verified: false },
  { key_bound: false },
  { key_revoked: true },
  { key_expired: true },
  { scope_allowed: false },
  { workspace_allowed: false },
  { worker_allowed: false },
])('denies current API-key authority when %j', (denied) => {
  expect(apiKeyActorAuthorized(facts)).toBe(true);
  expect(apiKeyActorAuthorized({ ...facts, ...denied })).toBe(false);
});

it('checks different tenants in bounded pages and removes registrations synchronously', async () => {
  vi.useFakeTimers();
  const read = vi.fn(async (ids: string[]) => ids.map(row));
  const observer = new InferenceControlObserver(read);
  const registrations = Array.from({ length: 600 }, (_, index) => {
    const id = String(index);
    const abort = new AbortController();
    const cleanup = observer.register({ runId: id, organizationId: `org-${id}`, generation: '7', abort });
    return { abort, cleanup };
  });
  try {
    await vi.advanceTimersByTimeAsync(500);
    expect(read.mock.calls.map(([ids]) => ids.length)).toEqual([256, 256, 88]);
    expect(registrations.every(({ abort }) => !abort.signal.aborted)).toBe(true);
    for (const { cleanup } of registrations) cleanup();
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledTimes(3);
  } finally {
    for (const { cleanup } of registrations) cleanup();
  }
});

it.each(['missing', 'wrong_org', 'generation', 'cancelled', 'terminal', 'revoked'] as const)(
  'aborts a Run when its authoritative observation is %s',
  async (condition) => {
    vi.useFakeTimers();
    const observed = row('a');
    if (condition === 'wrong_org') observed.organization_id = 'other';
    if (condition === 'generation') observed.lease_generation = '8';
    if (condition === 'cancelled') observed.cancel_requested = true;
    if (condition === 'terminal') observed.status = 'succeeded';
    if (condition === 'revoked') observed.key_revoked = true;
    const observer = new InferenceControlObserver(async () => (condition === 'missing' ? [] : [observed]));
    const abort = new AbortController();
    const cleanup = observer.register({ runId: 'a', organizationId: 'org-a', generation: '7', abort });
    try {
      await vi.advanceTimersByTimeAsync(500);
      expect(abort.signal.aborted).toBe(true);
    } finally {
      cleanup();
    }
  },
);

it('aborts the first failed page immediately without another observation attempt', async () => {
  vi.useFakeTimers();
  const read = vi.fn(async () => {
    throw new Error('fixture database unavailable');
  });
  const observer = new InferenceControlObserver(read);
  const abort = new AbortController();
  const cleanup = observer.register({ runId: 'a', organizationId: 'org-a', generation: '7', abort });
  try {
    await vi.advanceTimersByTimeAsync(500);
    expect(abort.signal.reason).toMatchObject({ code: 'inference_control_unavailable' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    cleanup();
  }
});

it('keeps admission freshness across commit delay and immediately aborts an already stale owner', async () => {
  vi.useFakeTimers();
  const read = vi.fn(async (ids: string[]) => ids.map(row));
  const observer = new InferenceControlObserver(read);
  const checkedAtMonotonicMs = performance.now();
  await vi.advanceTimersByTimeAsync(2000);
  const abort = new AbortController();
  const cleanup = observer.register({
    runId: 'a',
    organizationId: 'org-a',
    generation: '7',
    abort,
    checkedAtMonotonicMs,
  });
  try {
    expect(abort.signal.reason).toMatchObject({ code: 'inference_control_stale' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
});

it('aborts stale registrations without waiting for an outstanding query and ignores removed identities', async () => {
  vi.useFakeTimers();
  let resolve!: (rows: InferenceControlRow[]) => void;
  const blocked = new Promise<InferenceControlRow[]>((done) => {
    resolve = done;
  });
  const observer = new InferenceControlObserver(() => blocked);
  const stale = new AbortController(),
    removed = new AbortController();
  const cleanup = observer.register({ runId: 'a', organizationId: 'org-a', generation: '7', abort: stale });
  const detach = observer.register({ runId: 'b', organizationId: 'org-b', generation: '7', abort: removed });
  try {
    await vi.advanceTimersByTimeAsync(500);
    expect(observer.available()).toBe(true);
    detach();
    await vi.advanceTimersByTimeAsync(500);
    expect(observer.available()).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(stale.signal.reason).toMatchObject({ code: 'inference_control_stale' });
    expect(removed.signal.aborted).toBe(false);
    resolve([row('a'), row('b')]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(removed.signal.aborted).toBe(false);
  } finally {
    cleanup();
    detach();
    resolve([]);
  }
});

it('keeps at most two page queries active while refilling freed slots', async () => {
  vi.useFakeTimers();
  const release: ((rows: InferenceControlRow[]) => void)[] = [];
  const calls: string[][] = [];
  const observer = new InferenceControlObserver((ids) => {
    calls.push(ids);
    return new Promise((resolve) => {
      release.push(resolve);
    });
  });
  const cleanup = Array.from({ length: 600 }, (_, index) => {
    const id = String(index);
    return observer.register({
      runId: id,
      organizationId: `org-${id}`,
      generation: '7',
      abort: new AbortController(),
    });
  });
  try {
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toHaveLength(2);
    release[0](calls[0].map(row));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(3);
  } finally {
    for (const detach of cleanup) detach();
    for (let index = 0; index < release.length; index++) release[index](calls[index].map(row));
    await vi.advanceTimersByTimeAsync(0);
  }
});

it('refuses exhausted local permits and releases them exactly once', () => {
  vi.stubEnv('IMMEDIATE_INFERENCE_CONCURRENCY', '1');
  vi.stubEnv('IMMEDIATE_INFERENCE_ADMISSION_CONCURRENCY', '1');
  const release = acquireImmediateInferencePermit(),
    done = acquireInferenceAdmission(Date.now() + 1000),
    read = acquireInferenceRequestPermit();
  try {
    expect(() => acquireImmediateInferencePermit()).toThrow(
      expect.objectContaining({ code: 'inference_service_unavailable' }),
    );
    expect(() => acquireInferenceAdmission(Date.now() + 1000)).toThrow(
      expect.objectContaining({ code: 'inference_service_unavailable' }),
    );
    expect(() => acquireInferenceRequestPermit()).toThrow(
      expect.objectContaining({ code: 'inference_service_unavailable' }),
    );
  } finally {
    release();
    release();
    done();
    done();
    read();
    read();
  }
  acquireImmediateInferencePermit()();
  acquireInferenceAdmission(Date.now() + 1000)();
  acquireInferenceRequestPermit()();
  expect(() => acquireInferenceAdmission(Date.now() - 1)).toThrow(
    expect.objectContaining({ code: 'inference_admission_timeout' }),
  );
});
