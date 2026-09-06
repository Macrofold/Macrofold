import { seal, unseal } from './crypto';
import { assert } from './errors';
import { assertSecurityConfiguration } from './config';
export type RuntimeCapability = {
  purpose: 'runtime';
  organization: string;
  run: string;
  lease: string;
  expires: number;
};
export function runtimeToken(cap: Omit<RuntimeCapability, 'purpose'>) {
  return `rt_${seal({ ...cap, purpose: 'runtime' })}`;
}
export function verifyRuntime(request: Request, runId: string): RuntimeCapability {
  assertSecurityConfiguration();
  const token =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    request.headers.get('x-api-key') ||
    '';
  assert(token.startsWith('rt_'), 401, 'unauthenticated', 'A runtime capability is required.');
  let cap: RuntimeCapability;
  try {
    cap = unseal<RuntimeCapability>(token.slice(3));
  } catch {
    assert(false, 401, 'unauthenticated', 'The runtime capability is invalid.');
  }
  assert(
    cap.purpose === 'runtime' && cap.run === runId && cap.expires > Date.now(),
    401,
    'unauthenticated',
    'The runtime capability expired or belongs to another run.',
  );
  return cap;
}
