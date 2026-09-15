import { Composio } from '@composio/core';
import { assert } from '../../core/src/errors';

export function composio() {
  const apiKey = process.env.COMPOSIO_API_KEY?.trim();
  // Dashboard/session metadata can contain a masked key. Presence alone does
  // not make that display value a usable server credential.
  assert(
    apiKey && !/\*|…|\.{3}/.test(apiKey),
    503,
    'integration_not_configured',
    'Configure a complete Composio project API key. Masked key values cannot authenticate.',
  );
  return new Composio({
    apiKey,
    allowTracking: false,
    disableVersionCheck: true,
    fileUploadDirs: false,
  });
}
