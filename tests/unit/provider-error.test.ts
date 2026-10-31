import { expect, it } from 'vitest';
import { extractProviderError } from '../../packages/providers/src/provider-error';

it.each([
  { error: { message: 'Insufficient credits; add $2.', code: 402 } },
  { message: 'Insufficient credits; add $2.', code: '402' },
  { error: 'Insufficient credits; add $2.', code: '402' },
])('preserves the provider message and scalar code from a rejection: %j', (raw) => {
  expect(extractProviderError(raw, 402)).toEqual({
    http_status: 402,
    code: '402',
    message: 'Insufficient credits; add $2.',
  });
});

it('preserves whitespace and Unicode in a normal provider message', () => {
  const message = '  Limite atteint: réessayez après 2 secondes.\n';
  expect(extractProviderError({ error: { message } }, 429)?.message).toBe(message);
});

it('redacts exact credentials and sensitive text without returning unrelated error fields', () => {
  const raw = {
    error: {
      message:
        'Denied fixture-secret and configured-header and hosted-secret; Bearer unknown-secret; sk-ant-long-secret-value-1234',
      code: 'fixture-secret',
      responseHeaders: { authorization: 'private-header' },
      request: { prompt: 'private prompt' },
    },
  };
  const result = extractProviderError(raw, 401, [
    'fixture-secret',
    'configured-header',
    'Bearer hosted-secret',
  ]);
  expect(result).toEqual({
    http_status: 401,
    message: 'Denied [REDACTED] and [REDACTED] and [REDACTED]; Bearer [REDACTED] [REDACTED]',
    code: '[REDACTED]',
  });
  expect(JSON.stringify(result)).not.toMatch(/fixture-secret|configured-header|unknown-secret|private/);
});

it('redacts signed URL credentials while preserving a public help link', () => {
  const result = extractProviderError(
    { error: { message: 'Help https://provider.test/help; https://provider.test/object?token=private' } },
    403,
  );
  expect(result?.message).toBe('Help https://provider.test/help; https://provider.test/object?[REDACTED]');
});

it('bounds UTF-8 message bytes and marks truncation without producing broken characters', () => {
  const result = extractProviderError({ error: { message: '€'.repeat(10_000), code: 'x'.repeat(400) } }, 500);
  if (!result) throw new Error('Expected a bounded provider error.');
  expect(result?.truncated).toBe(true);
  expect(Buffer.byteLength(result.message)).toBeLessThanOrEqual(16 * 1024);
  expect(result.message).not.toContain('�');
  expect(result?.code).toHaveLength(200);
});

it.each([
  [{ choices: [] }, 200, false],
  [{ message: 'ordinary malformed successful output' }, 200, false],
  ['unparsed JSON response', 500, false],
  ['<html>Gateway outage</html>', 500, true],
  [{ error: { message: 12 } }, 500, false],
  [{ error: { message: ' ' } }, 500, false],
] as const)('does not invent a provider message from %j', (raw, status, plainText) => {
  expect(extractProviderError(raw, status, [], plainText)).toBeUndefined();
});

it('permits explicitly recognized plain-text HTTP errors', () => {
  expect(extractProviderError('Over capacity. Please retry later.\n', 503, [], true)).toEqual({
    http_status: 503,
    message: 'Over capacity. Please retry later.\n',
  });
});

it('preserves HTTP 200 separately from a provider-reported streaming error code', () => {
  expect(extractProviderError({ error: { code: 500, message: 'Generation failed.' } }, 200)).toEqual({
    http_status: 200,
    code: '500',
    message: 'Generation failed.',
  });
});
