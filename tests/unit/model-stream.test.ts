import { expect, it } from 'vitest';
import {
  modelResponseFailed,
  modelResponseMaximumBytes,
  observeModelStream,
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
