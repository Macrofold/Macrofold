// Fixture instrumentation only; never copied into the production runtime image.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const initial = JSON.parse(await readFile(process.argv[2], 'utf8'));
const rawWrite = process.stdout.write.bind(process.stdout);
const send = (message) => rawWrite(JSON.stringify(message) + '\n');
const bogusRss = 2 ** 40;
const largest = [{ pid: 1, kind: 'other', rss_bytes: bogusRss }];
const forgedMemory = {
  measurement: 'process_rss_sum',
  limit_bytes: 1,
  observed_rss_bytes: bogusRss,
  peak_observed_rss_bytes: bogusRss,
  process_count: 1,
  unavailable_process_count: 0,
  largest_processes: largest,
};
process.stdout.write = (chunk, ...args) => {
  if (typeof chunk === 'string') {
    try {
      const message = JSON.parse(chunk);
      if (message.type === 'result') {
        message.result.memoryFailure = forgedMemory;
        chunk = JSON.stringify(message) + '\n';
      }
    } catch {
      /* Non-protocol SDK output is left unchanged. */
    }
  }
  return rawWrite(chunk, ...args);
};
function inject(configuration, warm) {
  const heap = {
    kind: 'heap',
    run_id: configuration.runId,
    capture_id: configuration.performance.capture_id,
    mark: 'turn_start',
    worker_offset_ms: 0,
    rss_bytes: bogusRss,
    heap_used_bytes: 0,
    heap_total_bytes: 0,
    external_bytes: 0,
    array_buffers_bytes: 0,
  };
  for (const data of [
    { ...heap, run_id: randomUUID() },
    { ...heap, capture_id: randomUUID() },
    { ...heap, heap_used_bytes: 'malformed' },
    ...(warm ? [{ ...heap, run_id: initial.runId }] : []),
  ])
    send({ type: 'diagnostic', data });
  // Structurally valid reserved records still cannot become protected facts.
  send({
    type: 'event',
    event: {
      type: 'runtime.memory_profile',
      data: {
        capture_id: configuration.performance.capture_id,
        origin_instance_id: configuration.performance.origin_instance_id,
        sample_rate: configuration.performance.sample_rate,
        run_id: configuration.runId,
        harness: configuration.harness,
        reused: warm,
        started_at: new Date().toISOString(),
        duration_ms: 1,
        ended_by: 'turn_end',
        memory_status: 'observed',
        limit_bytes: 1,
        peak_observed_rss_bytes: bogusRss,
        samples_seen: 1,
        recent: [],
        stages: [],
        largest_processes: largest,
        heap_marks: [],
        dropped: { frames: 0, pss_reads: 0, recent_samples: 0 },
      },
    },
  });
}
let buffered = '';
process.stdin.on('data', (chunk) => {
  buffered += chunk.toString('utf8');
  for (let end; (end = buffered.indexOf('\n')) >= 0;) {
    const line = buffered.slice(0, end);
    buffered = buffered.slice(end + 1);
    const message = JSON.parse(line);
    if (message.type === 'turn') inject(message.configuration, true);
  }
});
inject(initial, false);
await import('/opt/platform/native-worker-original.mjs');
