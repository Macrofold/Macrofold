import type { Schema } from '../lib/client';
import { WaitingText } from './waiting-text';

/** One disclosure per provider block, not one disclosure per token/chunk. */
export function ReasoningOutput({ events, live }: { events: Schema['Event'][]; live: boolean }) {
  const truncated = events.some((event) => event.type === 'runtime.trace_truncated');
  const blocks = new Map<string, { format: string; text: string[]; status?: string }>();
  for (const event of events) {
    if (event.type === 'reasoning.summary') {
      blocks.set(event.id, { format: 'summary', text: [String(event.data.text || '')], status: 'completed' });
      continue;
    }
    if (!event.type.startsWith('reasoning.') || typeof event.data.reasoning_id !== 'string') continue;
    const id = event.data.reasoning_id;
    const block = blocks.get(id) || { format: String(event.data.format || 'text'), text: [] };
    blocks.set(id, block);
    if (event.type === 'reasoning.delta' && typeof event.data.text === 'string')
      block.text.push(event.data.text);
    if (event.type === 'reasoning.completed') block.status = String(event.data.status);
  }
  return [...blocks].map(([id, block]) => {
    const active = live && !truncated && !block.status;
    return (
      <details className="reasoning-summary" key={id}>
        <summary>
          <WaitingText active={active}>
            {active
              ? 'Thinking…'
              : block.status === 'interrupted' || !block.status
                ? 'Thinking interrupted'
                : block.format === 'summary'
                  ? 'Reasoning summary'
                  : 'Thinking details'}
          </WaitingText>
        </summary>
        <p className="reasoning-text">
          {block.text.join('') || 'The model has not shared readable reasoning for this block.'}
        </p>
      </details>
    );
  });
}
