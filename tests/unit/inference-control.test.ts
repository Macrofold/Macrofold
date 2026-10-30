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
  vi.restoreAllMocks();
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

it('recovers a failed control read without aborting the provider or admitting through degraded observation', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const read = vi
    .fn(async (ids: string[]) => ids.map(row))
    .mockRejectedValueOnce(new Error('fixture database unavailable'));
  const observer = new InferenceControlObserver(read);
  const abort = new AbortController();
  const cleanup = observer.register({ runId: 'a', organizationId: 'org-a', generation: '7', abort });
  try {
    await vi.advanceTimersByTimeAsync(500);
    expect(abort.signal.aborted).toBe(false);
    expect(observer.available()).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(read).toHaveBeenCalledTimes(2);
    expect(abort.signal.aborted).toBe(false);
    expect(observer.available()).toBe(true);
  } finally {
    cleanup();
  }
});

it('aborts persistent observation failures at the original two-second cutoff without extending freshness', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const read = vi.fn(async () => {
    throw new Error('fixture database unavailable');
  });
  const observer = new InferenceControlObserver(read);
  const abort = new AbortController();
  const cleanup = observer.register({ runId: 'a', organizationId: 'org-a', generation: '7', abort });
  try {
    await vi.advanceTimersByTimeAsync(1999);
    expect(read).toHaveBeenCalledTimes(3);
    expect(abort.signal.aborted).toBe(false);
    expect(observer.available()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(abort.signal.reason).toMatchObject({ code: 'inference_control_unavailable' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledTimes(3);
  } finally {
    cleanup();
  }
});

it('does not let a successful page mask another page whose authority cannot be refreshed', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const read = vi.fn(async (ids: string[]) => {
    if (ids.includes('0')) throw new Error('fixture first page unavailable');
    return ids.map(row);
  });
  const observer = new InferenceControlObserver(read);
  const registrations = Array.from({ length: 257 }, (_, index) => {
    const id = String(index);
    const abort = new AbortController();
    const cleanup = observer.register({ runId: id, organizationId: `org-${id}`, generation: '7', abort });
    return { abort, cleanup };
  });
  try {
    await vi.advanceTimersByTimeAsync(500);
    expect(registrations.every(({ abort }) => !abort.signal.aborted)).toBe(true);
    expect(observer.available()).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(
      registrations
        .slice(0, 256)
        .every(({ abort }) => abort.signal.reason?.code === 'inference_control_unavailable'),
    ).toBe(true);
    expect(registrations[256].abort.signal.aborted).toBe(false);
    expect(observer.available()).toBe(true);
  } finally {
    for (const { cleanup } of registrations) cleanup();
  }
});

it('keeps the failed-read cutoff while the next observation is pending and ignores its late completion', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  let resolve!: (rows: InferenceControlRow[]) => void;
  const blocked = new Promise<InferenceControlRow[]>((done) => {
    resolve = done;
  });
  const read = vi.fn(() => blocked).mockRejectedValueOnce(new Error('fixture database unavailable'));
  const observer = new InferenceControlObserver(read);
  const abort = new AbortController();
  const cleanup = observer.register({ runId: 'a', organizationId: 'org-a', generation: '7', abort });
  try {
    await vi.advanceTimersByTimeAsync(1999);
    expect(read).toHaveBeenCalledTimes(2);
    expect(abort.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(abort.signal.reason).toMatchObject({ code: 'inference_control_unavailable' });
    resolve([row('a')]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(abort.signal.reason).toMatchObject({ code: 'inference_control_unavailable' });
  } finally {
    cleanup();
    resolve([]);
  }
});

it('clears recovered failure history before a later stalled observation reaches its own stale cutoff', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  let resolve!: (rows: InferenceControlRow[]) => void;
  const blocked = new Promise<InferenceControlRow[]>((done) => {
    resolve = done;
  });
  const read = vi
    .fn(() => blocked)
    .mockRejectedValueOnce(new Error('fixture database unavailable'))
    .mockResolvedValueOnce([row('a')]);
  const observer = new InferenceControlObserver(read);
  const abort = new AbortController();
  const cleanup = observer.register({ runId: 'a', organizationId: 'org-a', generation: '7', abort });
  try {
    await vi.advanceTimersByTimeAsync(1000);
    expect(observer.available()).toBe(true);
    await vi.advanceTimersByTimeAsync(1999);
    expect(abort.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(abort.signal.reason).toMatchObject({ code: 'inference_control_stale' });
  } finally {
    cleanup();
    resolve([]);
    await vi.advanceTimersByTimeAsync(0);
  }
});

it.each(['cancelled', 'revoked'] as const)(
  'still aborts confirmed %s immediately after a transient read failure',
  async (condition) => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const observed = row('a');
    if (condition === 'cancelled') observed.cancel_requested = true;
    else observed.key_revoked = true;
    const read = vi
      .fn(async () => [observed])
      .mockRejectedValueOnce(new Error('fixture database unavailable'));
    const observer = new InferenceControlObserver(read);
    const abort = new AbortController();
    const cleanup = observer.register({ runId: 'a', organizationId: 'org-a', generation: '7', abort });
    try {
      await vi.advanceTimersByTimeAsync(500);
      expect(abort.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(500);
      expect(abort.signal.reason).toMatchObject({
        code: condition === 'cancelled' ? 'cancelled' : 'authorization_revoked',
      });
    } finally {
      cleanup();
    }
  },
);

it('does not restore or abort detached registrations when their failed observation arrives late', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  let reject!: (error: Error) => void;
  const blocked = new Promise<InferenceControlRow[]>((_, failed) => {
    reject = failed;
  });
  const read = vi.fn(() => blocked);
  const observer = new InferenceControlObserver(read);
  const abort = new AbortController();
  const cleanup = observer.register({ runId: 'a', organizationId: 'org-a', generation: '7', abort });
  try {
    await vi.advanceTimersByTimeAsync(500);
    cleanup();
    reject(new Error('fixture detached page unavailable'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(abort.signal.aborted).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    expect(observer.available()).toBe(true);
  } finally {
    cleanup();
  }
});

it('logs control failure classification and bounded timings without exception text or customer identities', async () => {
  vi.useFakeTimers();
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const failure = Object.assign(new Error('private-key fixture-secret SELECT customer_prompt'), {
    name: 'customer-secret-error-name',
    query: 'SELECT sensitive_payload',
    parameters: ['fixture-credential'],
  });
  const observer = new InferenceControlObserver(async () => {
    throw failure;
  });
  const abort = new AbortController();
  const cleanup = observer.register({
    runId: 'private-run-identity',
    organizationId: 'private-organization-identity',
    generation: '7',
    abort,
  });
  try {
    await vi.advanceTimersByTimeAsync(500);
    expect(warnings).toHaveBeenCalledTimes(1);
    const serialized = warnings.mock.calls[0][0];
    expect(typeof serialized).toBe('string');
    const diagnostic: unknown = JSON.parse(serialized);
    expect(diagnostic).toMatchObject({
      code: 'inference_control_read_failed',
      error_type: 'Error',
      duration_ms: expect.any(Number),
      run_count: 1,
      max_age_ms: 500,
    });
    for (const secret of [
      'fixture-secret',
      'customer_prompt',
      'customer-secret-error-name',
      'sensitive_payload',
      'fixture-credential',
      'private-run-identity',
      'private-organization-identity',
    ])
      expect(serialized).not.toContain(secret);
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

it('does not refresh authority when a late query resolves before its delayed freshness timer', async () => {
  vi.useFakeTimers();
  let resolve!: (rows: InferenceControlRow[]) => void;
  const blocked = new Promise<InferenceControlRow[]>((done) => {
    resolve = done;
  });
  const read = vi.fn(() => blocked);
  const observer = new InferenceControlObserver(read);
  const abort = new AbortController();
  const checkedAt = performance.now();
  const cleanup = observer.register({ runId: 'a', organizationId: 'org-a', generation: '7', abort });
  try {
    await vi.advanceTimersByTimeAsync(500);
    expect(read).toHaveBeenCalledTimes(1);
    // Advance the monotonic clock without firing the pending cutoff timer,
    // matching a delayed event loop where the query callback runs first.
    vi.spyOn(performance, 'now').mockReturnValue(checkedAt + 2000);
    resolve([row('a')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(abort.signal.reason).toMatchObject({ code: 'inference_control_stale' });
    expect(observer.available()).toBe(true);
  } finally {
    cleanup();
    resolve([]);
  }
});

it('recovers idle admission after a slow detached page finishes without admitting over the outstanding read', async () => {
  vi.useFakeTimers();
  let resolve!: (rows: InferenceControlRow[]) => void;
  const blocked = new Promise<InferenceControlRow[]>((done) => {
    resolve = done;
  });
  const read = vi.fn(() => blocked);
  const observer = new InferenceControlObserver(read);
  const abort = new AbortController();
  const cleanup = observer.register({ runId: 'a', organizationId: 'org-a', generation: '7', abort });
  try {
    await vi.advanceTimersByTimeAsync(500);
    cleanup();
    expect(observer.available()).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    resolve([row('a')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(observer.available()).toBe(true);
    expect(abort.signal.aborted).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    cleanup();
    resolve([]);
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
