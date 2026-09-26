import type { NativeEvent } from './types';

/** Keep readable provider reasoning separate from answers. First text is immediate;
 * subsequent fragments share bounded batches before supervisor/SQL persistence. */
export function reasoningEvents(send: (event: NativeEvent) => Promise<void>) {
  const active = new Map<string, { format: 'summary' | 'text'; hasText: boolean }>();
  let pending: NativeEvent | undefined;
  let lastFlush = 0;
  async function flush() {
    if (!pending) return;
    const event = pending;
    pending = undefined;
    lastFlush = Date.now();
    await send(event);
  }
  async function write(event: NativeEvent) {
    if (!event.type.startsWith('reasoning.')) {
      await flush();
      return send(event);
    }
    const id = event.data.reasoning_id;
    if (typeof id !== 'string' || !id) return;
    const format = event.data.format === 'summary' ? 'summary' : 'text';
    if (pending && pending.data.reasoning_id !== id) await flush();
    if (event.type === 'reasoning.completed') {
      await flush();
      if (!active.has(id)) return;
      active.delete(id);
      return send({
        type: event.type,
        data: { reasoning_id: id, status: event.data.status === 'interrupted' ? 'interrupted' : 'completed' },
      });
    }
    if (!['reasoning.started', 'reasoning.delta'].includes(event.type)) return;
    if (!active.has(id)) {
      await flush();
      active.set(id, { format, hasText: false });
      await send({ type: 'reasoning.started', data: { reasoning_id: id, format } });
    }
    const block = active.get(id)!;
    if (event.type !== 'reasoning.delta' || typeof event.data.text !== 'string') return;
    // Only allowlisted readable text crosses the boundary, never SDK signatures
    // or encrypted/redacted payloads. Chunking also keeps supervisor lines bounded.
    const text = event.data.text;
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(offset + 4096, text.length);
      // Do not split a UTF-16 surrogate pair across separate event payloads.
      if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff)
        end--;
      const chunk = text.slice(offset, end);
      offset = end;
      if (pending && String(pending.data.text).length + chunk.length > 4096) await flush();
      if (pending) pending.data.text += chunk;
      else
        pending = { type: 'reasoning.delta', data: { reasoning_id: id, format: block.format, text: chunk } };
      if (!block.hasText || String(pending.data.text).length >= 4096 || Date.now() - lastFlush >= 100) {
        await flush();
        block.hasText = true;
      }
    }
  }
  async function close(status: 'completed' | 'interrupted') {
    await flush();
    for (const id of active.keys())
      await write({ type: 'reasoning.completed', data: { reasoning_id: id, status } });
  }
  return { write, close };
}
