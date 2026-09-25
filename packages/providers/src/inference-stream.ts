import { createParser } from 'eventsource-parser';
import { z } from 'zod';
import { AppError, assert } from '../../core/src/errors';
import type { InferenceOutput, InferenceOutputSink } from '../../core/src/decision';

const object = z.record(z.string(), z.unknown());
const index = z.number().int().min(0).max(1023);
const string = (value: unknown) => (typeof value === 'string' ? value : '');
const limit = 512 * 1024;

/** Decode vendor framing and assemble one native response. Delivery never owns
 * execution: sinks may detach, but upstream consumption and finalization continue. */
export async function readInferenceStream(response: Response, chat: boolean, output?: InferenceOutputSink) {
  const raw: Record<string, unknown> = chat
    ? { object: 'chat.completion', choices: [] }
    : { type: 'message', role: 'assistant', content: [] };
  const blocks: Record<string, unknown>[] = [];
  const choices = new Map<
    number,
    { index: number; message: Record<string, unknown>; finish_reason: unknown }
  >();
  const argumentsByBlock = new Map<number, string>();
  let complete = false;
  let incomplete: string | undefined;
  let bytes = 0;
  let checkedAt = 0;
  let frames: InferenceOutput[] = [];
  const emit = (
    type: InferenceOutput['type'],
    content: number,
    data: Omit<InferenceOutput['data'], 'message_id' | 'content_index'> = {},
  ) => {
    frames.push({ type, data: { message_id: string(raw.id) || 'message', content_index: content, ...data } });
  };
  const parser = createParser({
    maxBufferSize: limit,
    onError(error) {
      if (error.type === 'max-buffer-size-exceeded') throw error;
    },
    onEvent(event) {
      if (event.data === '[DONE]' && chat) {
        assert(
          choices.size > 0 && [...choices.values()].every((c) => typeof c.finish_reason === 'string'),
          502,
          'incomplete_provider_stream',
          'The provider ended before completing its choices.',
        );
        complete = true;
        return;
      }
      const frame = object.parse(JSON.parse(event.data));
      if (frame.error || frame.type === 'error')
        throw new AppError(502, 'provider_stream_error', 'The provider interrupted generation.');
      if (chat) {
        for (const key of ['id', 'model', 'created', 'system_fingerprint'])
          if (frame[key] !== undefined) raw[key] = frame[key];
        if (frame.usage) raw.usage = frame.usage;
        for (const item of z.array(object).parse(frame.choices ?? [])) {
          const i = index.parse(item.index);
          const choice = choices.get(i) ?? {
            index: i,
            message: { role: 'assistant', content: '' },
            finish_reason: null,
          };
          if (!choices.has(i)) emit('output.started', 0, { choice_index: i });
          choices.set(i, choice);
          const delta = object.parse(item.delta ?? {});
          for (const key of ['content', 'refusal']) {
            const text = string(delta[key]);
            if (text) {
              choice.message[key] = string(choice.message[key]) + text;
              emit(key === 'content' ? 'output.delta' : 'output.refusal.delta', 0, { choice_index: i, text });
            }
          }
          if (delta.tool_calls) {
            const tools = z.array(object).parse(choice.message.tool_calls ?? []);
            for (const piece of z.array(object).parse(delta.tool_calls)) {
              const t = index.parse(piece.index);
              const tool = tools[t] ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
              if (piece.id) tool.id = piece.id;
              const fn = object.parse(tool.function);
              const addition = object.parse(piece.function ?? {});
              for (const key of ['name', 'arguments']) fn[key] = string(fn[key]) + string(addition[key]);
              tool.function = fn;
              tools[t] = tool;
              if (addition.arguments)
                emit('tool.arguments.delta', t, {
                  choice_index: i,
                  tool_call_id: string(tool.id) || `choice-${i}-tool-${t}`,
                  text: string(addition.arguments),
                });
            }
            choice.message.tool_calls = tools;
          }
          if (item.finish_reason != null) {
            choice.finish_reason = item.finish_reason;
            emit('output.finished', 0, { choice_index: i, stop_reason: string(item.finish_reason) });
          }
        }
        raw.choices = [...choices.values()].sort((a, b) => a.index - b.index);
        return;
      }
      if (frame.type === 'message_start')
        Object.assign(raw, object.parse(frame.message), { content: blocks });
      else if (frame.type === 'content_block_start') {
        const i = index.parse(frame.index);
        blocks[i] = object.parse(frame.content_block);
        emit('output.started', i);
      } else if (frame.type === 'content_block_delta') {
        const i = index.parse(frame.index);
        const block = blocks[i];
        assert(block, 502, 'invalid_provider_stream', 'A content delta arrived before its block.');
        const delta = object.parse(frame.delta);
        if (delta.type === 'text_delta') {
          block.text = string(block.text) + z.string().parse(delta.text);
          emit('output.delta', i, { text: string(delta.text) });
        } else if (delta.type === 'input_json_delta') {
          const text = z.string().parse(delta.partial_json);
          argumentsByBlock.set(i, (argumentsByBlock.get(i) ?? '') + text);
          emit('tool.arguments.delta', i, { tool_call_id: string(block.id), text });
        } else if (delta.type === 'thinking_delta' || delta.type === 'signature_delta') {
          // Preserve native response fidelity without publishing private reasoning as text.
          const key = delta.type === 'thinking_delta' ? 'thinking' : 'signature';
          block[key] = string(block[key]) + string(delta[key]);
        }
      } else if (frame.type === 'content_block_stop') {
        const i = index.parse(frame.index);
        const args = argumentsByBlock.get(i);
        if (args !== undefined) blocks[i].input = JSON.parse(args);
        argumentsByBlock.delete(i);
        emit('output.finished', i);
      } else if (frame.type === 'message_delta') {
        Object.assign(raw, object.parse(frame.delta));
        raw.usage = { ...object.parse(raw.usage ?? {}), ...object.parse(frame.usage ?? {}) };
      } else if (frame.type === 'message_stop') {
        assert(
          typeof raw.stop_reason === 'string',
          502,
          'incomplete_provider_stream',
          'The provider omitted its stop reason.',
        );
        complete = true;
      }
    },
  });
  const reader = response.body?.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    assert(
      reader && response.headers.get('content-type')?.includes('text/event-stream'),
      502,
      'invalid_provider_stream',
      'The provider did not return an event stream.',
    );
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      // Total wire bytes include framing, so allow bounded framing overhead in
      // addition to the existing 512 KiB assembled-response ceiling.
      bytes += part.value.byteLength;
      assert(
        bytes <= limit * 16,
        502,
        'provider_response_too_large',
        'Provider stream exceeds its response limit.',
      );
      parser.feed(decoder.decode(part.value, { stream: true }));
      if (bytes - checkedAt >= 16384 || complete) {
        checkedAt = bytes;
        assert(
          Buffer.byteLength(JSON.stringify(raw)) +
            [...argumentsByBlock.values()].reduce((n, s) => n + Buffer.byteLength(s), 0) <=
            limit,
          502,
          'provider_response_too_large',
          'Provider response exceeds 512 KiB.',
        );
      }
      for (const frame of frames) await output?.(frame);
      frames = [];
      if (complete) break;
    }
    if (!complete) incomplete = 'incomplete_provider_stream';
  } catch (error) {
    incomplete = error instanceof AppError ? error.code : 'interrupted_provider_stream';
  } finally {
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
  if (incomplete && argumentsByBlock.size)
    raw.incomplete_tool_arguments = Object.fromEntries(argumentsByBlock);
  return { raw, incomplete };
}
