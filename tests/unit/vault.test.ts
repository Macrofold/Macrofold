import { it, expect } from 'vitest';
import { Vault } from '../../packages/core/src/crypto';
it('rotates new writes while reading legacy and retained keys and authenticating key identity', () => {
  const legacy = 'legacy-fixture-secret-with-at-least-32-bytes',
    a = 'a'.repeat(40),
    b = 'b'.repeat(40);
  const first = new Vault(legacy),
    second = new Vault(legacy, { september: a }, 'september'),
    third = new Vault(legacy, { september: a, october: b }, 'october');
  const old = first.seal({ files: ['persisted'], secret: 'fixture' }),
    current = second.seal({ run: 'retained' });
  expect(third.unseal(old)).toEqual({ files: ['persisted'], secret: 'fixture' });
  expect(third.unseal(current)).toEqual({ run: 'retained' });
  const rewrapped = third.seal(third.unseal(current));
  expect(rewrapped.startsWith('v2.october.')).toBe(true);
  expect(new Vault(legacy, { october: b }, 'october').unseal(rewrapped)).toEqual({ run: 'retained' });
  expect(() => new Vault(legacy, { october: b }).unseal(current)).toThrow(/unavailable/);
  expect(() => third.unseal(current.replace('september', 'october'))).toThrow();
  expect(() => new Vault(legacy, { september: a }, 'missing')).toThrow(/missing/);
});
