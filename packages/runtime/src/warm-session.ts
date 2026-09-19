import { createHash } from 'node:crypto';
import type { NativeConfiguration } from './types';

/** A live conversation is reusable only within the same authorized session and
 * exact harness setup. Prompts, deadlines and credentials belong to each turn. */
export function warmSessionKey(c: NativeConfiguration): string | undefined {
  if (!c.warm) return undefined;
  return createHash('sha256')
    .update(
      JSON.stringify({
        session: c.warm.sessionId,
        harness: c.harness,
        model: c.model,
        provider: c.provider,
        instructions: c.instructions,
        permissions: c.permissions,
        tools: c.warm.toolFingerprint,
        workspace: c.workspace,
        home: c.stateHome,
      }),
    )
    .digest('hex');
}
