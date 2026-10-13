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

export function observeModelStream(path: string, onFrame: (frame: Record<string, unknown>) => void) {
  let complete = false;
  const parser = createParser({
    // A final Responses frame can contain the entire answer. Do not impose a
    // smaller per-frame ceiling than the existing complete-response bound.
    maxBufferSize: modelResponseMaximumBytes,
    onError(error) {
      if (error.type === 'max-buffer-size-exceeded') throw error;
    },
    onEvent(event) {
      if (event.data === '[DONE]') {
        if (path.endsWith('chat/completions')) complete = true;
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
    feed: (text: string) => parser.feed(text),
    finish() {
      assert(
        complete,
        502,
        'model_stream_interrupted',
        'The provider stream ended without a completion marker.',
      );
    },
  };
}
