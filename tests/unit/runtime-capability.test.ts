import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeToken, verifyRuntime } from '../../packages/core/src/runtime-auth';
import { seal } from '../../packages/core/src/crypto';

const now = Date.UTC(2026, 8, 6);
const capability = { organization: 'tenant-a', run: 'run-a', lease: 'lease-a', expires: now + 1000 };
const request = (token: string) =>
  new Request('http://localhost/runtime', { headers: { authorization: `Bearer ${token}` } });
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('sealed runtime capabilities', () => {
  it('fails closed when production security configuration is incomplete', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('AUTH_SECRET', '');
    expect(() => verifyRuntime(request(runtimeToken(capability)), 'run-a')).toThrow(
      expect.objectContaining({ status: 503, code: 'deployment_not_configured' }),
    );
  });
  it('accepts case-insensitive Bearer with multiple whitespace separators', () => {
    const req = new Request('http://localhost/runtime', {
      headers: { authorization: `bEaReR   ${runtimeToken(capability)}` },
    });
    expect(verifyRuntime(req, 'run-a').run).toBe('run-a');
  });
  it('rejects a Bearer marker embedded inside a credential', () => {
    const token = runtimeToken(capability);
    const req = new Request('http://localhost/runtime', {
      headers: { authorization: `rt_Bearer ${token.slice(3)}` },
    });
    expect(() => verifyRuntime(req, 'run-a')).toThrow(
      expect.objectContaining({ status: 401, code: 'unauthenticated' }),
    );
  });
  it('returns a structured error when both credential headers are absent', () => {
    expect(() => verifyRuntime(new Request('http://localhost/runtime'), 'run-a')).toThrow(
      expect.objectContaining({ status: 401, code: 'unauthenticated', message: expect.stringMatching(/\S/) }),
    );
  });
  it('preserves the tenant and execution lease for downstream fencing', () => {
    expect(verifyRuntime(request(runtimeToken(capability)), 'run-a')).toEqual({
      ...capability,
      purpose: 'runtime',
    });
  });
  it('accepts a capability until the millisecond before expiry', () => {
    const token = runtimeToken(capability);
    vi.setSystemTime(capability.expires - 1);
    expect(verifyRuntime(request(token), 'run-a').run).toBe('run-a');
  });
  it.each([0, 1])('rejects a capability %i milliseconds after its expiry boundary', (offset) => {
    const token = runtimeToken(capability);
    vi.setSystemTime(capability.expires + offset);
    expect(() => verifyRuntime(request(token), 'run-a')).toThrow(
      expect.objectContaining({ status: 401, code: 'unauthenticated' }),
    );
  });
  it('rejects a valid capability presented to another run', () => {
    expect(() => verifyRuntime(request(runtimeToken(capability)), 'run-b')).toThrow(
      expect.objectContaining({ status: 401, code: 'unauthenticated' }),
    );
  });
  it('rejects another sealed token purpose', () => {
    expect(() => verifyRuntime(request(`rt_${seal({ ...capability, purpose: 'upload' })}`), 'run-a')).toThrow(
      expect.objectContaining({ status: 401, code: 'unauthenticated' }),
    );
  });
  it.each(['', 'sk_customer-key', 'rt_not-encrypted', 'rt_v3.invalid'])(
    'rejects malformed credential %j',
    (token) => {
      expect(() => verifyRuntime(request(token), 'run-a')).toThrow(
        expect.objectContaining({ status: 401, code: 'unauthenticated' }),
      );
    },
  );
  it('rejects a modified ciphertext without returning its claims', () => {
    const parts = runtimeToken(capability).split('.');
    const bytes = Buffer.from(parts.at(-1)!, 'base64url');
    bytes[0] ^= 1;
    parts[parts.length - 1] = bytes.toString('base64url');
    expect(() => verifyRuntime(request(parts.join('.')), 'run-a')).toThrow(
      expect.objectContaining({ status: 401, code: 'unauthenticated' }),
    );
  });
  it('accepts the documented x-api-key transport', () => {
    const req = new Request('http://localhost/runtime', {
      headers: { 'x-api-key': runtimeToken(capability) },
    });
    expect(verifyRuntime(req, 'run-a').lease).toBe('lease-a');
  });
  it('does not fall back to x-api-key when an invalid authorization header is supplied', () => {
    const req = new Request('http://localhost/runtime', {
      headers: { authorization: 'Bearer invalid', 'x-api-key': runtimeToken(capability) },
    });
    expect(() => verifyRuntime(req, 'run-a')).toThrow(
      expect.objectContaining({ status: 401, code: 'unauthenticated' }),
    );
  });
});
