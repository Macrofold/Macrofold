import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import type { PerformanceRecord, PerformanceSink } from '../../contracts/performance';

/** All outstanding bytes include the current write. Diagnostic loss is preferable
 * to unbounded output debt. No I/O occurs inside enqueue/measurement callbacks. */
export class PerformanceJsonlSink implements PerformanceSink {
  private readonly queue: string[] = [];
  private bytes = 0;
  private count = 0;
  private writing?: Promise<void>;
  private stopped = false;
  private failed = false;
  private dropped = 0;
  private written = 0;
  private stream?: Writable;
  private readonly onStreamError = () => this.fail();
  constructor(
    private readonly destination: Promise<Writable> | Writable,
    private readonly owned = false,
  ) {}
  stats() {
    return {
      outstanding_bytes: this.bytes,
      outstanding_records: this.count,
      dropped: this.dropped,
      written: this.written,
    };
  }
  enqueue(record: PerformanceRecord) {
    if (this.stopped || this.count >= 256 || this.bytes + 8192 > 1024 * 1024) {
      this.dropped++;
      return;
    }
    const line = `${JSON.stringify(record)}\n`,
      size = Buffer.byteLength(line);
    if (size > 8192) {
      this.dropped++;
      return;
    }
    this.queue.push(line);
    this.bytes += size;
    this.count++;
  }
  flush(): Promise<void> {
    if (this.writing) return this.writing;
    if (this.stopped || !this.queue.length) return Promise.resolve();
    this.writing = this.drain()
      .catch(() => this.fail())
      .finally(() => {
        this.writing = undefined;
      });
    return this.writing;
  }
  private fail() {
    // The stream error and write rejection can describe the same failure.
    if (this.failed) return;
    this.failed = this.stopped = true;
    this.dropped += this.count;
    this.queue.length = 0;
    this.bytes = this.count = 0;
    try {
      console.warn(JSON.stringify({ code: 'performance_profile_sink_failed' }));
    } catch {
      /* Optional diagnostics must not fail the caller. */
    }
  }
  private async drain() {
    let stream = this.stream;
    if (!stream) {
      stream = await this.destination;
      this.stream = stream;
      // Writable invokes its write callback before emitting 'error'. The
      // per-write rejection listener must not be its final error listener.
      stream.on('error', this.onStreamError);
      const observed = stream;
      stream.once('close', () => observed.removeListener('error', this.onStreamError));
    }
    while (this.queue.length && !this.stopped) {
      const lines: string[] = [];
      let bytes = 0;
      while (this.queue.length && bytes + Buffer.byteLength(this.queue[0]) <= 65536) {
        const line = this.queue.shift();
        if (line !== undefined) {
          lines.push(line);
          bytes += Buffer.byteLength(line);
        }
      }
      const text = lines.join('');
      await new Promise<void>((resolve, reject) => {
        let callbackDone = false,
          drained = false,
          accepted: boolean | undefined;
        const cleanup = () => {
          stream.removeListener('error', failed);
          stream.removeListener('drain', onDrain);
        };
        const finish = () => {
          if (callbackDone && (accepted === true || drained)) {
            cleanup();
            resolve();
          }
        };
        const failed = (error: Error) => {
          cleanup();
          reject(error);
        };
        const onDrain = () => {
          drained = true;
          finish();
        };
        stream.once('error', failed);
        stream.once('drain', onDrain);
        try {
          accepted = stream.write(text, (error) => {
            if (error) failed(error);
            else {
              callbackDone = true;
              finish();
            }
          });
          finish();
        } catch (error) {
          cleanup();
          reject(error);
        }
      });
      // Shutdown can discard an unacknowledged batch; never retry an ambiguous write.
      if (!this.stopped) {
        this.bytes -= bytes;
        this.count -= lines.length;
        this.written += lines.length;
      }
    }
  }
  async close() {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.flush(),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 2000);
          timeout.unref();
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      this.stopped = true;
      this.dropped += this.count;
      this.queue.length = 0;
      this.bytes = this.count = 0;
      if (this.owned) {
        // A slow file-open must not extend the shutdown budget either.
        if (this.stream) this.stream.end();
        else
          void Promise.resolve(this.destination).then(
            (stream) => stream.end(),
            () => {},
          );
      } else if (this.stream) {
        const stream = this.stream;
        // A write can fail after the drain deadline. Keep its harmless error
        // listener until that pending write settles, then detach next tick.
        const detach = () => {
          setImmediate(() => stream.removeListener('error', this.onStreamError));
        };
        if (this.writing) void this.writing.then(detach, detach);
        else detach();
      }
    }
  }
}

export async function privatePerformanceFile(directory: string): Promise<Writable> {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
    }
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe profiling directory.');
  }
  if ((await lstat(absolute)).mode & 0o077) throw new Error('Profiling directory must be private.');
  const handle = await open(
    path.join(absolute, `performance-${process.pid}-${randomUUID()}.jsonl`),
    'wx',
    0o600,
  );
  return handle.createWriteStream();
}
