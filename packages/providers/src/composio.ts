import { assert } from '../../core/src/errors';

let sdkModule: Promise<typeof import('@composio/core')> | undefined;

/** Optional connector SDKs must not initialize on unrelated API requests.
 * Cache only code: each operation still gets its own credential-bound client. */
export async function composio() {
  const apiKey = process.env.COMPOSIO_API_KEY?.trim();
  // Dashboard/session metadata can contain a masked key. Presence alone does
  // not make that display value a usable server credential.
  assert(
    apiKey && !/\*|…|\.{3}/.test(apiKey),
    503,
    'integration_not_configured',
    'Configure a complete Composio project API key. Masked key values cannot authenticate.',
  );
  const { Composio } = await (sdkModule ??= import('@composio/core').catch((error) => {
    sdkModule = undefined;
    throw error;
  }));
  return new Composio({
    apiKey,
    allowTracking: false,
    disableVersionCheck: true,
    fileUploadDirs: false,
  });
}
