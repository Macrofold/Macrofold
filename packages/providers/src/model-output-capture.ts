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
    if (
      !this.firstOutputAt &&
      (frame.type === 'response.output_text.delta' ||
        frame.type === 'content_block_delta' ||
        Array.isArray(frame.choices))
    )
      this.firstOutputAt = new Date();
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
    const text = this.frames
      .map((frame) => {
        if (frame.type === 'response.output_text.delta')
          return typeof frame.delta === 'string' ? frame.delta : '';
        const delta = frame.delta;
        if (delta && typeof delta === 'object' && 'text' in delta && typeof delta.text === 'string')
          return delta.text;
        const choices = frame.choices;
        if (Array.isArray(choices))
          return choices
            .map((choice: unknown) => {
              if (!choice || typeof choice !== 'object' || !('delta' in choice)) return '';
              const delta = choice.delta;
              return delta &&
                typeof delta === 'object' &&
                'content' in delta &&
                typeof delta.content === 'string'
                ? delta.content
                : '';
            })
            .join('');
        return '';
      })
      .join('');
    return { text, frames: this.frames, truncated: this.truncated };
  }
}
