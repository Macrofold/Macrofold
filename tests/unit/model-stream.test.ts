import { expect, it } from 'vitest';
import {
  modelResponseFailed,
  modelResponseMaximumBytes,
  observeModelStream,
  gateModelStream,
} from '../../packages/providers/src/model-stream';

const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
it.each([
  ['v1/responses', frame({ type: 'response.completed' })],
  [
    'v1/responses',
    frame({ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } }),
  ],
  ['v1/messages', frame({ type: 'message_stop' })],
  ['v1/chat/completions', 'data: [DONE]\n\n'],
])('requires a protocol terminal marker, independently of usage: %s', (path, terminal) => {
  const observed: unknown[] = [];
  const observer = observeModelStream(path, (value) => observed.push(value));
  const usage = { usage: { input_tokens: 10, output_tokens: 2 } };
  for (const char of frame(usage)) observer.feed(char);
  expect(observed).toEqual([usage]);
  expect(() => observer.finish()).toThrow('completion marker');
  for (const char of terminal) observer.feed(char);
  expect(() => observer.finish()).not.toThrow();
});

it.each([
  [
    'v1/responses',
    { type: 'response.output_text.delta', delta: 'hello' },
    { type: 'response.completed', response: { usage: { input_tokens: 3, output_tokens: 1 } } },
  ],
  [
    'v1/messages',
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
  ],
  [
    'v1/chat/completions',
    { choices: [{ delta: { content: 'hello' }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ],
])('holds the %s completion and trailing usage, while forwarding split deltas', (path, delta, terminal) => {
  const frames: unknown[] = [];
  const gate = gateModelStream(path, (value) => frames.push(value));
  const answer = frame(delta);
  const ending =
    frame(terminal) +
    (path.endsWith('messages')
      ? frame({ type: 'message_stop' })
      : path.endsWith('chat/completions')
        ? frame({ usage: { prompt_tokens: 3, completion_tokens: 1 }, choices: [] }) + 'data: [DONE]\n\n'
        : '');
  let forwarded = '';
  for (const character of answer + ending) forwarded += gate.feed(character).join('');
  gate.finish();
  expect(forwarded).toBe(answer);
  expect(gate.release().join('')).toBe(ending);
  expect(gate.release()).toEqual([]);
  expect(frames[0]).toEqual(delta);
});

it.each(['\n', '\r\n', '\r'])(
  'preserves native bytes and holds bare chat DONE across %j boundaries',
  (separator) => {
    const gate = gateModelStream('v1/chat/completions', () => {});
    const content = `: keepalive${separator}${separator}data: {"choices":[{"delta":{"content":"héllo"}}]}${separator}${separator}`;
    const done = `data: [DONE]${separator}${separator}`;
    let visible = '';
    for (const character of content + done) visible += gate.feed(character).join('');
    gate.finish();
    expect(visible).toBe(content);
    expect(gate.release().join('')).toBe(done);
  },
);

it('does not expose successful terminal bytes when a later provider error arrives', () => {
  const gate = gateModelStream('v1/responses', () => {});
  const terminal = frame({ type: 'response.completed' });
  expect(gate.feed(terminal)).toEqual([]);
  expect(() => gate.feed(frame({ type: 'error', error: { message: 'fixture failure' } }))).toThrow(
    'interrupted generation',
  );
});

it.each([
  { error: { message: 'failure' }, usage: { output_tokens: 3 } },
  { type: 'error', error: { type: 'overloaded_error' } },
  { type: 'response.failed', response: { status: 'failed' } },
])('captures available usage before rejecting an in-band error', (value) => {
  let captured: unknown;
  const observer = observeModelStream('v1/responses', (item) => {
    captured = item;
  });
  expect(modelResponseFailed(value)).toBe(true);
  expect(() => observer.feed(frame(value))).toThrow('interrupted generation');
  expect(captured).toEqual(value);
});

it('rejects malformed, oversized and incomplete protocol frames', () => {
  for (const data of [
    'data: invalid\n\n',
    'data: []\n\n',
    'data: ' + 'a'.repeat(modelResponseMaximumBytes + 1),
  ])
    expect(() => observeModelStream('v1/messages', () => {}).feed(data)).toThrow();
  const observer = observeModelStream('v1/responses', () => {});
  observer.feed('data: [DONE]\n\n');
  expect(() => observer.finish()).toThrow('completion marker');
});
