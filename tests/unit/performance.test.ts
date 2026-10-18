import { describe, expect, it, vi } from 'vitest';
import { Writable } from 'node:stream';
import { chmod, lstat, mkdtemp, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import type { PerformanceRecord, PerformanceSink } from '../../packages/contracts/performance';
import {
  createPerformanceCollector,
  profilingConfiguration,
  runPerformanceRoot,
  startPerformanceStage,
} from '../../packages/core/src/performance';
import { PerformanceJsonlSink, privatePerformanceFile } from '../../packages/providers/src/performance-jsonl';

function fixture(sampleRate = 1) {
  const records: PerformanceRecord[] = [];
  const sink: PerformanceSink = {
    enqueue: (record) => {
      if (record.state !== 'started') records.push(record);
    },
    flush: async () => {},
    close: async () => {},
  };
  const collector = createPerformanceCollector({ sink, sampleRate, durationSeconds: 300 });
  return { collector, records };
}
describe('optional process profiling', () => {
  it('allows normal actions beyond the 256-scope cap without retaining extra scopes', async () => {
    const { collector, records } = fixture();
    let release = () => {};
    let deferred: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const actions = Array.from({ length: 257 }, (_, index) =>
      collector.run(
        'rest',
        {},
        async () => {
          if (index === 256) {
            expect(collector.ticket()).toBeUndefined();
            deferred = collector.background(() =>
              collector.job('run', {}, () => expect(collector.ticket()).toBeUndefined()),
            );
          }
          await gate;
          return index;
        },
        'foreground',
        false,
      ),
    );
    release();
    expect(await Promise.all(actions)).toEqual(Array.from({ length: 257 }, (_, index) => index));
    deferred?.();
    expect(records.filter((record) => record.type === 'operation')).toHaveLength(256);
    await collector.close();
    expect(records.find((record) => record.type === 'capture')?.dropped?.scope_limit).toBe(1);
  });

  it('caps optional group exemplars while preserving all aggregate measurements', async () => {
    const { collector, records } = fixture();
    for (let operation = 0; operation < 16; operation++)
      collector.run(
        'rest',
        {},
        () => {
          const ticket = collector.ticket();
          for (let group = 0; group < 20; group++)
            ticket?.record({ kind: 'group', groupId: group, statements: 2, durationMs: 1, pool: 'domain' });
        },
        'foreground',
        false,
      );
    expect(records.flatMap((record) => record.groups ?? [])).toHaveLength(128);
    expect(records.every((record) => (record.groups?.length ?? 0) <= 16)).toBe(true);
    expect(records.reduce((sum, record) => sum + (record.counters.groups ?? 0), 0)).toBe(320);
    await collector.close();
  });

  it('expires automatically without cancelling or completing the underlying operation', async () => {
    vi.useFakeTimers();
    const records: PerformanceRecord[] = [];
    const close = vi.fn(async () => {}),
      detach = vi.fn();
    const collector = createPerformanceCollector({
      sampleRate: 1,
      durationSeconds: 1,
      sink: {
        enqueue(record) {
          records.push(record);
        },
        flush: async () => {},
        close,
      },
    });
    collector.onClose(detach);
    let release = () => {};
    let businessCompleted = false;
    const business = collector.run(
      'run',
      {},
      async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        businessCompleted = true;
        return 'preserved';
      },
      'job',
      false,
    );
    try {
      await vi.advanceTimersByTimeAsync(1000);
      expect(collector.active()).toBe(false);
      expect(businessCompleted).toBe(false);
      expect(records.find((record) => record.type === 'operation')?.truncated).toBe(true);
      expect(detach).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
      release();
      expect(await business).toBe('preserved');
      expect(records.filter((record) => record.type === 'operation')).toHaveLength(1);
    } finally {
      release();
      await collector.close();
      vi.useRealTimers();
    }
  });
  it('leaves profiling unconfigured by default and preserves return identity', () => {
    const value = Promise.resolve('business result');
    expect(profilingConfiguration({})).toBeUndefined();
    expect(runPerformanceRoot('rest', {}, () => value)).toBe(value);
    const now = vi.spyOn(performance, 'now');
    startPerformanceStage('http.total')();
    expect(now).not.toHaveBeenCalled();
    now.mockRestore();
  });
  it.each([
    { PERF_PROFILING_ENABLED: 'yes' },
    { PERF_PROFILING_ENABLED: 'true', PERF_PROFILING_SAMPLE_RATE: '-0.1' },
    { PERF_PROFILING_ENABLED: 'true', PERF_PROFILING_SAMPLE_RATE: '' },
    { PERF_PROFILING_ENABLED: 'true', PERF_PROFILING_DURATION_SECONDS: '3601' },
  ])('rejects invalid optional configuration %o', (env) => {
    expect(() => profilingConfiguration(env)).toThrow();
  });
  it('uses the finite default window and whole-operation sampling', () => {
    expect(profilingConfiguration({ PERF_PROFILING_ENABLED: 'true' })).toEqual({
      sampleRate: 1,
      durationSeconds: 300,
    });
  });
  it('keeps parallel requests and deferred background separate', async () => {
    const { collector, records } = fixture();
    let release: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let deferred: (() => void) | undefined;
    const first = collector.run(
      'rest',
      {},
      async () => {
        const ticket = collector.ticket();
        deferred = collector.background(() => collector.ticket()?.record({ kind: 'query', durationMs: 7 }));
        await barrier;
        ticket?.record({ kind: 'query', durationMs: 11 });
      },
      'foreground',
      false,
    );
    await collector.run(
      'mcp',
      {},
      async () => {
        collector.ticket()?.record({ kind: 'query', durationMs: 22 });
      },
      'foreground',
      false,
    );
    release();
    await first;
    deferred?.();
    expect(
      records
        .filter((record) => record.type === 'operation')
        .map((record) => [record.operation, record.phase, record.stages['db.query']?.total_ms]),
    ).toEqual([
      ['mcp', 'foreground', 22],
      ['rest', 'foreground', 11],
      ['background', 'background', 7],
    ]);
    const root = records.find((record) => record.operation === 'rest');
    expect(records.find((record) => record.phase === 'background')?.parent_id).toBe(root?.operation_id);
    await collector.close();
  });
  it('does not inherit a sampled parent for an independently unsampled root', async () => {
    const records: PerformanceRecord[] = [];
    let decision = 0;
    const collector = createPerformanceCollector({
      sampleRate: 0.5,
      durationSeconds: 300,
      random: () => (decision++ === 0 ? 0 : 1),
      sink: {
        enqueue: (record) => {
          if (record.state !== 'started') records.push(record);
        },
        flush: async () => {},
        close: async () => {},
      },
    });
    collector.run(
      'rest',
      {},
      () => {
        collector.run('maintenance', {}, () => expect(collector.ticket()).toBeUndefined(), 'job', false);
        collector.ticket()?.record({ kind: 'query', durationMs: 1 });
      },
      'foreground',
      false,
    );
    expect(records).toHaveLength(1);
    expect(records[0].counters.statements).toBe(1);
    await collector.close();
  });
  it('preserves skipped decisions through async children and deferred jobs while sampling independent roots', async () => {
    const records: PerformanceRecord[] = [];
    const random = vi.fn().mockReturnValueOnce(0.9).mockReturnValue(0.1);
    const collector = createPerformanceCollector({
      sampleRate: 0.5,
      durationSeconds: 300,
      random,
      sink: {
        enqueue: (record) => records.push(record),
        flush: async () => {},
        close: async () => {},
      },
    });
    let deferred: (() => Promise<void>) | undefined;
    try {
      await collector.job('run', {}, async () => {
        await Promise.resolve();
        collector.child('stream_owner', () =>
          collector.job('run', {}, () => expect(collector.ticket()).toBeUndefined()),
        );
        deferred = collector.background(async () => {
          await Promise.resolve();
          collector.job('run', {}, () => expect(collector.ticket()).toBeUndefined());
        });
        collector.run('maintenance', {}, () => expect(collector.ticket()).toBeDefined(), 'job', false);
        expect(collector.ticket()).toBeUndefined();
      });
      expect(random).toHaveBeenCalledTimes(2);
      await collector.run(
        'rest',
        {},
        async () => {
          await deferred?.();
          collector.ticket()?.record({ kind: 'query', durationMs: 1 });
        },
        'foreground',
        false,
      );
      expect(
        records.filter((record) => record.type === 'operation').map((record) => record.operation),
      ).toEqual(['maintenance', 'rest']);
      expect(random).toHaveBeenCalledTimes(3);
      expect(records.find((record) => record.operation === 'rest')?.counters.statements).toBe(1);
    } finally {
      await collector.close();
    }
    expect(records.find((record) => record.state === 'completed')?.sampling).toEqual({
      seen: 3,
      sampled: 2,
      skipped: 1,
    });
  });
  it('limits nested spans, finishes once, and expires without cancelling business work', async () => {
    const { collector, records } = fixture();
    let finish: () => void = () => {};
    const pending = collector.run(
      'run',
      { requestId: 'secret text must never be retained' },
      async () => {
        const stops = Array.from({ length: 10 }, () => collector.stage('http.total'));
        stops.forEach((stop) => {
          stop();
          stop();
        });
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return 'preserved';
      },
      'job',
      false,
    );
    await collector.close();
    finish();
    expect(await pending).toBe('preserved');
    expect(records[0].truncated).toBe(true);
    expect(records[0].stages['http.total']?.count).toBe(8);
    expect(records[1].dropped?.span_limit).toBe(2);
    expect(JSON.stringify(records)).not.toContain('secret text');
  });
  it('does not allow a broken diagnostics sink to fail an action', async () => {
    const collector = createPerformanceCollector({
      sampleRate: 1,
      durationSeconds: 300,
      sink: {
        enqueue() {
          throw new Error('sink');
        },
        flush: async () => {
          throw new Error('sink');
        },
        close: async () => {},
      },
    });
    expect(collector.run('tool', {}, () => 'ok', 'foreground', false)).toBe('ok');
    await collector.flush();
    await collector.close();
  });
});

describe('bounded JSONL sink', () => {
  const record = (captureId = 'fixture'): PerformanceRecord => ({
    component: 'performance',
    version: 1,
    type: 'capture',
    capture_id: captureId,
    instance_id: 'fixture',
    started_at: '',
    duration_ms: 1,
    sample_rate: 1,
    counters: {},
    stages: {},
  });

  it('rejects oversized records without preventing a subsequent valid record', async () => {
    const output: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        output.push(chunk.toString());
        callback();
      },
    });
    const sink = new PerformanceJsonlSink(stream);
    try {
      sink.enqueue(record('x'.repeat(8192)));
      sink.enqueue(record());
      await sink.flush();
      expect(sink.stats()).toMatchObject({ dropped: 1, written: 1, outstanding_bytes: 0 });
      expect(output.join('').trim().split('\n')).toHaveLength(1);
    } finally {
      await sink.close();
      stream.destroy();
    }
  });

  it('enforces the one-MiB limit across queued and in-flight batches of at most 64 KiB', async () => {
    let acknowledge: (() => void) | undefined;
    const batchBytes: number[] = [];
    const stream = new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, callback) {
        batchBytes.push(chunk.length);
        if (!acknowledge) acknowledge = callback;
        else callback();
      },
    });
    const sink = new PerformanceJsonlSink(stream);
    try {
      for (let index = 0; index < 200; index++) sink.enqueue(record('x'.repeat(7500)));
      const queued = sink.stats();
      expect(queued.outstanding_bytes).toBeLessThanOrEqual(1024 * 1024);
      expect(queued.outstanding_records).toBeLessThan(200);
      expect(queued.dropped).toBeGreaterThan(0);
      const flushing = sink.flush();
      await new Promise((resolve) => setImmediate(resolve));
      expect(sink.stats().outstanding_bytes).toBe(queued.outstanding_bytes);
      expect(sink.stats().outstanding_records).toBe(queued.outstanding_records);
      acknowledge?.();
      await flushing;
      expect(batchBytes.length).toBeGreaterThan(1);
      expect(batchBytes.every((bytes) => bytes <= 64 * 1024)).toBe(true);
      expect(sink.stats()).toMatchObject({ outstanding_bytes: 0, outstanding_records: 0 });
    } finally {
      await sink.close();
      stream.destroy();
    }
  });

  it('drops an unacknowledged write after two seconds and contains its late failure', async () => {
    vi.useFakeTimers();
    let acknowledge: ((error?: Error | null) => void) | undefined;
    let writes = 0;
    const stream = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) {
        writes++;
        acknowledge = callback;
      },
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sink = new PerformanceJsonlSink(stream);
    try {
      sink.enqueue(record());
      const flushing = sink.flush();
      await Promise.resolve();
      let closed = false;
      const closing = sink.close().then(() => {
        closed = true;
      });
      await vi.advanceTimersByTimeAsync(1999);
      expect(closed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await closing;
      expect(sink.stats()).toMatchObject({ dropped: 1, outstanding_bytes: 0, outstanding_records: 0 });
      acknowledge?.(new Error('synthetic late write failure'));
      await flushing;
      await vi.runOnlyPendingTimersAsync();
      expect(writes).toBe(1);
    } finally {
      acknowledge?.();
      await sink.close();
      stream.destroy();
      warning.mockRestore();
      vi.useRealTimers();
    }
  });
  it('contains a real Writable callback failure and its subsequent error event', async () => {
    const stream = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('synthetic write failure'));
      },
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const sink = new PerformanceJsonlSink(stream);
      sink.enqueue({
        component: 'performance',
        version: 1,
        type: 'capture',
        capture_id: '',
        instance_id: '',
        started_at: '',
        duration_ms: 0,
        sample_rate: 1,
        counters: {},
        stages: {},
      });
      await sink.flush();
      await new Promise((resolve) => setImmediate(resolve));
      expect(sink.stats().dropped).toBe(1);
      expect(sink.stats().outstanding_bytes).toBe(0);
      await sink.close();
    } finally {
      warning.mockRestore();
      stream.destroy();
    }
  });
  it('discards queued records and reports an idle stream failure once', async () => {
    const stream = new Writable({ write: (_chunk, _encoding, callback) => callback() });
    const sink = new PerformanceJsonlSink(stream);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      sink.enqueue(record());
      await sink.flush();
      sink.enqueue(record());
      stream.emit('error', new Error('synthetic idle failure'));
      stream.emit('error', new Error('same failed stream'));
      await sink.flush();
      expect(sink.stats()).toEqual({
        dropped: 1,
        written: 1,
        outstanding_bytes: 0,
        outstanding_records: 0,
      });
      sink.enqueue(record());
      expect(sink.stats().dropped).toBe(2);
      expect(warning).toHaveBeenCalledExactlyOnceWith(
        JSON.stringify({ code: 'performance_profile_sink_failed' }),
      );
    } finally {
      await sink.close();
      stream.destroy();
      warning.mockRestore();
    }
  });
  it.each([false, true])(
    'counts a stream failure once before a late write callback (failure: %s)',
    async (fails) => {
      let acknowledge: ((error?: Error | null) => void) | undefined;
      const stream = new Writable({
        write(_chunk, _encoding, callback) {
          acknowledge = callback;
        },
      });
      const sink = new PerformanceJsonlSink(stream);
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        sink.enqueue(record());
        const flushing = sink.flush();
        await new Promise((resolve) => setImmediate(resolve));
        expect(acknowledge).toBeDefined();
        stream.emit('error', new Error('synthetic in-flight stream failure'));
        await flushing;
        acknowledge?.(fails ? new Error('synthetic late callback failure') : undefined);
        await new Promise((resolve) => setImmediate(resolve));
        expect(sink.stats()).toEqual({
          dropped: 1,
          written: 0,
          outstanding_bytes: 0,
          outstanding_records: 0,
        });
        expect(warning).toHaveBeenCalledExactlyOnceWith(
          JSON.stringify({ code: 'performance_profile_sink_failed' }),
        );
      } finally {
        await sink.close();
        stream.destroy();
        warning.mockRestore();
      }
    },
  );
  it('bounds queued and in-flight bytes and waits for write completion', async () => {
    let acknowledge: ((error?: Error | null) => void) | undefined;
    const stream = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) {
        acknowledge = callback;
      },
    });
    const sink = new PerformanceJsonlSink(stream);
    const record: PerformanceRecord = {
      component: 'performance',
      version: 1,
      type: 'capture',
      capture_id: 'test',
      instance_id: 'test',
      started_at: '',
      duration_ms: 1,
      sample_rate: 1,
      stages: {},
      counters: {},
    };
    for (let i = 0; i < 500; i++) sink.enqueue(record);
    expect(sink.stats().outstanding_records).toBe(256);
    expect(sink.stats().dropped).toBe(244);
    const flushing = sink.flush();
    await new Promise((resolve) => setImmediate(resolve));
    expect(sink.stats().outstanding_records).toBe(256);
    acknowledge?.();
    await flushing;
    expect(sink.stats().outstanding_records).toBe(0);
    await sink.close();
    stream.destroy();
  });
});

describe('private profiling files', () => {
  it('creates owner-only directories/files and rejects public directories and symlink ancestors', async () => {
    const directory = await mkdtemp(path.join(await realpath(tmpdir()), 'performance-file-'));
    try {
      const nested = path.join(directory, 'private', 'nested');
      const stream = await privatePerformanceFile(nested);
      stream.end('synthetic numeric profiling record\n');
      await finished(stream);
      const files = await readdir(nested);
      expect(files).toHaveLength(1);
      expect((await lstat(nested)).mode & 0o777).toBe(0o700);
      expect((await lstat(path.join(nested, files[0]))).mode & 0o777).toBe(0o600);
      await chmod(nested, 0o755);
      await expect(privatePerformanceFile(nested)).rejects.toThrow('must be private');
      expect(await readdir(nested)).toEqual(files);
      await symlink(path.join(directory, 'private'), path.join(directory, 'linked'));
      await expect(privatePerformanceFile(path.join(directory, 'linked', 'nested'))).rejects.toThrow(
        'Unsafe profiling directory',
      );
      expect(await readdir(nested)).toEqual(files);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
