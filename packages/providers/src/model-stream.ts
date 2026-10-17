import { createParser } from 'eventsource-parser';
import { assert } from '../../core/src/errors';

export const modelResponseMaximumBytes = 32 * 1024 * 1024;

/** Failure and stream completion are independent from token-usage completeness.
 * This observer leaves the provider's bytes intact for the native harness. */
export function modelResponseFailed(frame: Record<string, unknown>) {
  const response = frame.response as Record<string, unknown> | undefined;
  return Boolean(
    frame.error ||
    frame.type === 'error' ||
    frame.type === 'response.failed' ||
    frame.status === 'failed' ||
    response?.status === 'failed',
  );
}

export function observeModelStream(
  path: string,
  onFrame: (frame: Record<string, unknown>) => void,
  onTerminal?: () => void,
) {
  let complete = false;
  let trailingCR = false;
  const parser = createParser({
    // A final Responses frame can contain the entire answer. Do not impose a
    // smaller per-frame ceiling than the existing complete-response bound.
    maxBufferSize: modelResponseMaximumBytes,
    onError(error) {
      if (error.type === 'max-buffer-size-exceeded') throw error;
    },
    onEvent(event) {
      if (event.data === '[DONE]') {
        if (path.endsWith('chat/completions')) {
          complete = true;
          onTerminal?.();
        }
        return;
      }
      const frame: unknown = JSON.parse(event.data);
      assert(
        frame && typeof frame === 'object' && !Array.isArray(frame),
        502,
        'invalid_model_response',
        'The provider returned an invalid stream frame.',
      );
      const value = frame as Record<string, unknown>;
      onFrame(value);
      assert(
        !modelResponseFailed(value),
        502,
        'model_provider_error',
        'The provider interrupted generation.',
      );
      if (path.endsWith('responses'))
        complete ||= value.type === 'response.completed' || value.type === 'response.incomplete';
      if (path.endsWith('messages')) complete ||= value.type === 'message_stop';
    },
  });
  return {
    feed(text: string) {
      if (text) trailingCR = text.endsWith('\r');
      parser.feed(text);
    },
    finish() {
      // The maintained parser defers a final CR in case LF follows. At EOF it
      // is a complete line terminator; flush only the parser, not native bytes.
      if (trailingCR) parser.feed('\n');
      assert(
        complete,
        502,
        'model_stream_interrupted',
        'The provider stream ended without a completion marker.',
      );
    },
  };
}

/** A native harness may act as soon as it sees a finish reason, before socket
 * EOF. Keep that boundary and trailing usage private until shared settlement
 * commits. The gateway need not know vendor framing or rewrite native bytes. */
export function gateModelStream(path: string, onFrame: (frame: Record<string, unknown>) => void) {
  let holding = false;
  let pending = '';
  let lineStart = 0;
  let scan = 0;
  let retainedBytes = 0;
  const tail: string[] = [];
  const observer = observeModelStream(
    path,
    (frame) => {
      onFrame(frame);
      const choices = frame.choices as { finish_reason?: unknown }[] | undefined;
      const delta = frame.delta as { stop_reason?: unknown } | undefined;
      holding ||=
        modelResponseFailed(frame) ||
        (path.endsWith('responses') &&
          ['response.completed', 'response.incomplete'].includes(String(frame.type))) ||
        (path.endsWith('messages') && (frame.type === 'message_stop' || delta?.stop_reason != null)) ||
        (path.endsWith('chat/completions') && !!choices?.some((choice) => choice.finish_reason != null));
    },
    () => {
      holding = true;
    },
  );
  function accept(frame: string, ready: string[]) {
    observer.feed(frame);
    if (holding) tail.push(frame);
    else {
      ready.push(frame);
      retainedBytes -= Buffer.byteLength(frame);
    }
  }
  return {
    feed(text: string) {
      pending += text;
      retainedBytes += Buffer.byteLength(text);
      assert(
        retainedBytes <= modelResponseMaximumBytes,
        413,
        'response_too_large',
        'Model output exceeded the stream limit.',
      );
      const ready: string[] = [];
      const newline = /\r\n|\r|\n/g;
      newline.lastIndex = scan;
      let match: RegExpExecArray | null;
      while ((match = newline.exec(pending))) {
        // A CR at a transport boundary may be the first half of CRLF.
        if (match[0] === '\r' && match.index + 1 === pending.length) {
          scan = match.index;
          break;
        }
        const end = match.index + match[0].length;
        if (match.index === lineStart) {
          accept(pending.slice(0, end), ready);
          pending = pending.slice(end);
          lineStart = 0;
          scan = 0;
          newline.lastIndex = 0;
        } else {
          lineStart = end;
          scan = end;
        }
      }
      if (!match) scan = pending.length;
      return ready;
    },
    finish() {
      if (pending) {
        const ready: string[] = [];
        accept(pending, ready);
        // Valid streams have already reached their terminal tail. Retain any
        // final comments as well so release reproduces the exact native bytes.
        tail.push(...ready);
        pending = '';
      }
      observer.finish();
    },
    release() {
      return tail.splice(0);
    },
  };
}
