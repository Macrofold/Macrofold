import { fixtureAccount } from '../account';
import { fixtureConnector } from '../operator';
import { transaction } from '../../../packages/db';
import { ensureCustomerAgent, getCustomerBinding } from '../../../packages/core/src/customer-agents';
import { createCustomerConnection } from '../../../packages/core/src/customer-agent-connections';
import { createCustomerAuthorization } from '../../../packages/core/src/customer-connect';

import { pool, authPool } from '../../../packages/db';
const fixtureOrigin = process.env.APP_ORIGIN!;
try {
  const account = await fixtureAccount('Customer consent browser');
  await fixtureConnector('github');
  const auth = await transaction(account.p.organizationId, async (tx) => {
    const assistant = await ensureCustomerAgent(tx, account.p, 'alice', {
      key: 'assistant',
      name: 'Milo',
      configuration: {
        harness: 'codex',
        model: 'fixture-model',
        billing_mode: 'managed',
        limits: { max_cost_micro_usd: '2000000' },
      },
    });
    const binding = await getCustomerBinding(tx, account.p, 'alice', assistant.id);
    const connection = await createCustomerConnection(
      tx,
      account.p,
      binding,
      {
        name: 'My GitHub account',
        provider: 'github',
        capabilities: [
          {
            id: 'profile',
            label: 'Read my profile',
            description: 'Read your signed-in profile. No repository access.',
            tools: ['GITHUB_GET_THE_AUTHENTICATED_USER'],
          },
        ],
      },
      [
        {
          name: 'GITHUB_GET_THE_AUTHENTICATED_USER',
          description: 'Read profile',
          input_schema: {},
          granted: false,
        },
      ],
    );
    const previous = process.env.COMPOSIO_CALLBACK_VERIFICATION_ENABLED;
    process.env.COMPOSIO_CALLBACK_VERIFICATION_ENABLED = 'true';
    try {
      return await createCustomerAuthorization(
        tx,
        account.p,
        binding,
        connection.connection.id,
        fixtureOrigin + '/app-callback?state=browser-fixture',
      );
    } finally {
      if (previous === undefined) delete process.env.COMPOSIO_CALLBACK_VERIFICATION_ENABLED;
      else process.env.COMPOSIO_CALLBACK_VERIFICATION_ENABLED = previous;
    }
  });
  process.stdout.write(JSON.stringify(auth));
} finally {
  await pool.end();
  await authPool.end();
}
