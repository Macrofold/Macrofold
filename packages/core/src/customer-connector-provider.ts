import type { components } from '../../contracts/api';

/** Only consent transport varies by provider. Ownership and access policy stay in core. */
export interface CustomerConnectorProvider {
  tools(toolkit: string, version: string): Promise<components['schemas']['Tool'][]>;
  start(input: {
    subject: string;
    connectionId: string;
    authConfigId: string;
    callbackUrl: string;
    externalAccountId?: string;
  }): Promise<{ accountId: string; url: string }>;
  complete(sessionUri: string, subject: string): Promise<{ accountId: string; toolkit: string }>;
}
