import { createHmac } from 'node:crypto';
import { config } from './config';
export const resourceVerifierClientId = 'platform-resource-verifier';
/** Internal introspection credential; purpose-separated from cookie signing and never sent to clients. */
export function resourceVerifierSecret() {
  return createHmac('sha256', config.secret).update('oauth-resource-introspection-v1').digest('base64url');
}
