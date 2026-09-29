import { createHash } from 'node:crypto';

// Changing the model-facing names also changes warm-harness compatibility. Otherwise
// an existing process may retain a catalog the broker no longer recognizes.
export const CONNECTOR_TOOL_NAME_VERSION = 'readable-v1';

export function exposedToolName(connectionId: string, name: string): string {
  const readable = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20) || 'tool';
  const identity = createHash('sha256').update(JSON.stringify([connectionId, name])).digest('hex');
  // At most 47 characters, leaving room for native MCP prefixes under 64-character
  // provider limits. Hash the full identity, including truncated/replaced characters.
  return `c_${readable}_${identity.slice(0, 24)}`;
}
