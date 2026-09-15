import { customerDataServer } from './mcp';

// Synthetic, loopback-only walkthrough. Replace token lookup and data reader together for deployment.
const server = customerDataServer(
  async (customer) => [
    {
      id: `${customer}-preference`,
      title: 'Travel preference',
      body: customer === 'alice' ? 'Quiet hotels' : 'Mountain walks',
    },
  ],
  async (token) =>
    token === 'fixture-alice-token' ? 'alice' : token === 'fixture-bob-token' ? 'bob' : undefined,
);
server.listen(3230, '127.0.0.1', () =>
  console.log('Fixture customer MCP: http://127.0.0.1:3230/mcp (synthetic tokens only)'),
);
process.once('SIGINT', () => server.close());
process.once('SIGTERM', () => server.close());
