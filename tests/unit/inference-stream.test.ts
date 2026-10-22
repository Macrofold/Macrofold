import { expect, it } from 'vitest';
import { readInferenceStream } from '../../packages/providers/src/inference-stream';
import type { InferenceOutput } from '../../packages/core/src/decision';

const stream = (frames: unknown[]) =>
  new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  });

it('preserves returned native reasoning and per-choice log probabilities in the final response', async () => {
  const first = { token: 'hel', logprob: -0.25, bytes: [104, 101, 108], top_logprobs: [] };
  const second = { token: 'lo', logprob: -0.5, bytes: [108, 111], top_logprobs: [] };
  const events: InferenceOutput[] = [];
  const result = await readInferenceStream(
    stream([
      {
        id: 'answer',
        model: 'fixture',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', reasoning: 'Visible ' },
            logprobs: null,
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            delta: { reasoning: 'reason.', content: 'hel' },
            logprobs: { content: [first], refusal: null },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            delta: { content: 'lo' },
            logprobs: { content: [second], refusal: null },
            finish_reason: 'stop',
          },
        ],
      },
    ]),
    true,
    (event) => {
      events.push(event);
    },
  );
  expect(result.incomplete).toBeUndefined();
  expect(result.raw.choices).toEqual([
    {
      index: 0,
      message: { role: 'assistant', content: 'hello', reasoning: 'Visible reason.' },
      logprobs: { content: [first, second], refusal: null },
      finish_reason: 'stop',
    },
  ]);
  expect(events.filter((event) => event.type === 'output.delta').map((event) => event.data.text)).toEqual([
    'hel',
    'lo',
  ]);
});

it('preserves externally returned legacy reasoning_content without changing its field name', async () => {
  const result = await readInferenceStream(
    stream([
      { choices: [{ index: 0, delta: { reasoning_content: 'A ' }, finish_reason: null }] },
      {
        choices: [
          { index: 0, delta: { reasoning_content: 'reason', content: 'answer' }, finish_reason: 'stop' },
        ],
      },
    ]),
    true,
  );
  expect(result.raw.choices).toMatchObject([
    { message: { content: 'answer', reasoning_content: 'A reason' } },
  ]);
});

it('counts retained native reasoning against the assembled response limit', async () => {
  const result = await readInferenceStream(
    stream([
      ...Array.from({ length: 3 }, () => ({
        choices: [{ index: 0, delta: { reasoning: 'r'.repeat(200_000) }, finish_reason: null }],
      })),
      { choices: [{ index: 0, delta: { content: 'answer' }, finish_reason: 'stop' }] },
    ]),
    true,
  );
  expect(result.incomplete).toBe('provider_response_too_large');
});
