import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { NativeEvent } from './types';

/** The SDK publishes committed messages, not token deltas or private reasoning. */
export function deepseekEvent(event: SessionEvent): NativeEvent | undefined {
  if (event.type === 'assistant/message') {
    const text = event.data.message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (text) return { type: 'output.delta', data: { text } };
  }
  if (event.type === 'tool/call')
    return {
      type: 'tool.started',
      data: {
        tool_call_id: event.data.callId,
        name: event.data.name,
        arguments: event.data.arguments,
      },
    };
  if (event.type === 'tool/result')
    return {
      type: 'tool.completed',
      data: {
        tool_call_id: event.data.message.content[0].toolCallId,
        result: event.data.message.content[0].content,
        is_error: event.data.message.content[0].isError,
      },
    };
}
