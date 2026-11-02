import { nativeResultMaximumBytes } from '../../contracts/native-model';

/** Answer text only: reasoning and tool arguments never become final prose. */
export function modelTextDelta(frame: Record<string, unknown>): string {
  if (frame.type === 'response.output_text.delta') return typeof frame.delta === 'string' ? frame.delta : '';
  const delta = frame.delta as { type?: unknown; text?: unknown } | undefined;
  if (delta?.type === 'text_delta' && typeof delta.text === 'string') return delta.text;
  const choices = frame.choices;
  if (Array.isArray(choices))
    return choices
      .map((choice) => (typeof choice?.delta?.content === 'string' ? choice.delta.content : ''))
      .join('');
  return '';
}

function* modelResponseText(frame: Record<string, unknown>): Generator<string> {
  const choices = frame.choices;
  if (Array.isArray(choices) && typeof choices[0]?.message?.content === 'string') {
    yield choices[0].message.content;
    return;
  }
  const messages = Array.isArray(frame.output) ? frame.output : [{ type: 'message', content: frame.content }];
  for (const item of messages) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content)
      if (['text', 'output_text'].includes(part?.type) && typeof part.text === 'string' && part.text)
        yield part.text;
  }
}

/** Required failure recovery, independent of optional tracing. Some native SDKs
 * replace a truncated answer with a later retry error. Keep only bounded answer
 * text, and persist it only with the first semantic failure fence. */
export class ModelAnswerCapture {
  text = '';
  truncated = false;
  private bytes = 0;
  constructor(private readonly maxBytes = nativeResultMaximumBytes) {}
  private append(text: string) {
    if (this.truncated || !text) return;
    const remaining = this.maxBytes - this.bytes;
    // encodeInto stops before an incomplete UTF-8 character and never allocates
    // more than the remaining allowance, even for one unusually large frame.
    const size = text.length > remaining ? remaining + 1 : Buffer.byteLength(text);
    if (size > remaining) {
      const buffer = new Uint8Array(remaining);
      const { written } = new TextEncoder().encodeInto(text, buffer);
      text = new TextDecoder().decode(buffer.subarray(0, written));
      this.bytes += written;
      this.truncated = true;
    } else this.bytes += size;
    this.text += text;
  }
  response(frame: Record<string, unknown>) {
    let reset = false;
    for (const text of modelResponseText(frame)) {
      if (!reset) {
        this.text = '';
        this.bytes = 0;
        this.truncated = false;
        reset = true;
      }
      this.append(text);
      if (this.truncated) break;
    }
  }
  delta(frame: Record<string, unknown>) {
    this.append(modelTextDelta(frame));
    if (frame.response && typeof frame.response === 'object')
      this.response(frame.response as Record<string, unknown>);
  }
}

/** Shared first-output classification works without retaining response frames. */
export function isModelOutputFrame(frame: Record<string, unknown>) {
  return (
    frame.type === 'response.output_text.delta' ||
    frame.type === 'content_block_delta' ||
    Array.isArray(frame.choices)
  );
}

/** Bounded, observational capture of provider frames. Never drives metering or
 * delivery. Prefer a provider's complete response; keep partial frames on abort. */
export class ModelOutputCapture {
  private frames: Record<string, unknown>[] = [];
  private bytes = 0;
  private complete: Record<string, unknown> | undefined;
  private truncated = false;
  firstOutputAt: Date | undefined;
  constructor(private readonly maxBytes = 1024 * 1024) {}
  add(frame: Record<string, unknown>) {
    if (!this.firstOutputAt && isModelOutputFrame(frame)) this.firstOutputAt = new Date();
    const serialized = JSON.stringify(frame);
    if (frame.type === 'response.completed' && frame.response && typeof frame.response === 'object') {
      if (Buffer.byteLength(serialized) <= this.maxBytes) {
        this.complete = frame.response as Record<string, unknown>;
        this.frames = [];
        return;
      }
    }
    if (this.bytes + Buffer.byteLength(serialized) > this.maxBytes) {
      this.truncated = true;
      return;
    }
    this.bytes += Buffer.byteLength(serialized);
    this.frames.push(frame);
  }
  result() {
    if (this.complete) return this.complete;
    // Preserve exact tool-call deltas and provider usage alongside readable text.
    const text = this.frames.map(modelTextDelta).join('');
    return { text, frames: this.frames, truncated: this.truncated };
  }
}
