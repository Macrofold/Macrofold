import { flushTraces } from './tracing';
import { transaction } from '../../db';
import type { Principal } from './auth';
import { assert } from './errors';
import { getRun, terminal } from './runs';
import { completeDirectInference, type InvocationPermit } from './direct-inference';

/** One transient reader, one durably identified invocation. Register the producer
 * with the host lifetime before returning headers; reader detachment never aborts it. */
export async function directInferenceStream(
  principal: Principal,
  accepted: unknown,
  permit: InvocationPermit | undefined,
  headers: Headers,
  background: (task: () => Promise<void>) => void,
  signal: AbortSignal,
  idempotencyKey: string,
  release?: () => void,
  onRecovery?: () => void,
) {
  assert(
    accepted && typeof accepted === 'object' && 'run_id' in accepted && typeof accepted.run_id === 'string',
    500,
    'invalid_inference_receipt',
    'The inference receipt is unavailable.',
  );
  const runId = accepted.run_id;
  const run =
    permit?.run ?? (await transaction(principal.organizationId, (tx) => getRun(tx, runId, principal)));
  assert(
    !run.result.content_expired,
    410,
    'content_expired',
    'The referenced content was deleted or expired.',
  );
  assert(
    permit || terminal(run.status),
    409,
    'stream_already_started',
    'This request already has a producer. Retrieve its saved result using the original run ID.',
    {
      idempotency_key: idempotencyKey,
      run_id: runId,
      ...('urls' in accepted ? { urls: accepted.urls } : {}),
    },
  );
  const encoder = new TextEncoder();
  let detached = false;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let heartbeat: ReturnType<typeof setInterval>;
  const detach = () => {
    if (detached) return;
    detached = true;
    clearInterval(heartbeat);
    signal.removeEventListener('abort', detach);
    controller.close();
  };
  const send = (type: string, data: unknown) => {
    if (detached) return;
    const frame = encoder.encode(
      `event: ${type}\ndata: ${JSON.stringify({ schema_version: 1, run_id: runId, type, occurred_at: new Date().toISOString(), data })}\n\n`,
    );
    if ((controller.desiredSize ?? 0) < frame.byteLength) {
      // A bounded queue protects the producer from slow or abandoned readers.
      controller.error(new Error('Stream reader fell behind; retrieve the saved run result.'));
      detached = true;
      clearInterval(heartbeat);
      signal.removeEventListener('abort', detach);
      return;
    }
    controller.enqueue(frame);
  };
  const stream = new ReadableStream<Uint8Array>(
    {
      start(value) {
        controller = value;
        send('run.accepted', {
          run_id: runId,
          session_id: null,
          worktree_id: null,
          status: run.status,
          kind: run.kind,
          ...('urls' in accepted ? { urls: accepted.urls } : {}),
          delivery: permit ? 'live' : 'result_replay',
        });
        heartbeat = setInterval(() => {
          if (!detached && (controller.desiredSize ?? 0) > 32)
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
        }, 15000);
        signal.addEventListener('abort', detach, { once: true });
        if (signal.aborted) detach();
      },
      cancel() {
        detached = true;
        clearInterval(heartbeat);
        signal.removeEventListener('abort', detach);
      },
    },
    { highWaterMark: 2 * 1024 * 1024, size: (chunk) => chunk.byteLength },
  );
  let resultAvailable = false;
  const producer = Promise.resolve().then(async () => {
    try {
      const completed = await completeDirectInference(principal, accepted, permit, background, (event) =>
        send(event.type, event.data),
      );
      if (completed.status === 200) {
        resultAvailable = true;
        send(`run.${completed.body.status}`, completed.body);
      } else {
        onRecovery?.();
        send('transport.error', {
          code: 'inference_recovery_required',
          idempotency_key: idempotencyKey,
          urls: completed.body.urls,
          ...('recovery_reason' in completed.body ? { recovery_reason: completed.body.recovery_reason } : {}),
          message: 'Execution is recovering. Retrieve the result using the run ID.',
        });
      }
    } catch {
      send('transport.error', {
        code: 'stream_interrupted',
        idempotency_key: idempotencyKey,
        ...('urls' in accepted ? { urls: accepted.urls } : {}),
        ...(resultAvailable ? { reason: 'result_available' } : { recovery_reason: 'outcome_unknown' }),
        message: 'Retrieve the saved result using the run ID.',
      });
    } finally {
      detach();
      release?.();
    }
  });
  background(async () => {
    await producer;
    await flushTraces();
  });
  headers.set('Content-Type', 'text/event-stream');
  headers.set('Cache-Control', 'no-store, no-transform');
  headers.set('X-Accel-Buffering', 'no');
  headers.set('X-Run-Id', runId);
  return new Response(stream, { status: 200, headers });
}
