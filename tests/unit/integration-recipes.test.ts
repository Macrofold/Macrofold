import { expect, it } from 'vitest';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { supabaseNotes, pineconeSearch, customerNamespace } from '../../examples/integrations/data';
import { customerDataServer } from '../../examples/integrations/mcp';

it('Supabase sends only the verified customer token and an encoded customer filter', async () => {
  const id = 'a20e277f-2c2b-46ea-8478-a32fc2b550d2';
  const read = supabaseNotes(
    {
      url: 'https://fixture.supabase.co',
      publishableKey: 'synthetic-public',
      customerToken: async (customer) => {
        expect(customer).toBe(id);
        return 'synthetic-customer-jwt';
      },
    },
    async (input, init) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('customer_id')).toBe(`eq.${id}`);
      expect(url.searchParams.get('select')).toBe('id,title,body');
      expect(init).toMatchObject({
        headers: { apikey: 'synthetic-public', Authorization: 'Bearer synthetic-customer-jwt' },
        redirect: 'error',
      });
      return Response.json([{ id: 'one', title: 'Alice', body: 'Confirmed note' }]);
    },
  );
  expect(await read(id)).toEqual([{ id: 'one', title: 'Alice', body: 'Confirmed note' }]);
  await expect(read('invalid-customer')).rejects.toThrow();
});

it('Pinecone derives namespaces server-side, validates dimensions and does not retry failures', async () => {
  const requests: unknown[] = [];
  const search = pineconeSearch(
    { indexHost: 'https://fixture.pinecone.io', apiKey: 'synthetic-key', dimensions: 2 },
    async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      expect(init?.headers).toMatchObject({ 'X-Pinecone-Api-Version': '2025-10' });
      return Response.json({ matches: [{ id: 'note', score: 0.9 }] });
    },
  );
  await search('alice', [0, 1]);
  await search('bob', [1, 0]);
  expect(requests).toMatchObject([
    { namespace: customerNamespace('alice'), topK: 5 },
    { namespace: customerNamespace('bob'), topK: 5 },
  ]);
  expect(customerNamespace('alice')).not.toBe(customerNamespace('bob'));
  await expect(search('alice', [1])).rejects.toThrow();
  let calls = 0;
  const failed = pineconeSearch(
    { indexHost: 'https://fixture.pinecone.io', apiKey: 'synthetic-key', dimensions: 2 },
    async () => {
      calls++;
      return new Response('private detail', { status: 429 });
    },
  );
  await expect(failed('alice', [0, 1])).rejects.toThrow('Data service request failed (429).');
  expect(calls).toBe(1);
});

it('remote MCP authenticates every request and cannot select another customer through tool arguments', async () => {
  const server = customerDataServer(
    async (customer) => [{ id: `${customer}-note`, title: customer, body: 'Fixture note' }],
    async (token) => (token === 'alice-token' ? 'alice' : token === 'bob-token' ? 'bob' : undefined),
  ).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server');
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
  const alice = new Client({ name: 'fixture', version: '1' }),
    bob = new Client({ name: 'fixture', version: '1' });
  try {
    expect((await fetch(url, { method: 'POST' })).status).toBe(401);
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: { origin: 'https://untrusted.example', Authorization: 'Bearer alice-token' },
        })
      ).status,
    ).toBe(403);
    await alice.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: 'Bearer alice-token' } },
      }),
    );
    await bob.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: 'Bearer bob-token' } },
      }),
    );
    expect((await alice.listTools()).tools.map((tool) => tool.name)).toEqual(['read_customer_notes']);
    expect(
      JSON.stringify(await alice.callTool({ name: 'read_customer_notes', arguments: { customerId: 'bob' } })),
    ).toContain('alice-note');
    expect(JSON.stringify(await bob.callTool({ name: 'read_customer_notes', arguments: {} }))).not.toContain(
      'alice-note',
    );
    expect((await alice.callTool({ name: 'delete_notes', arguments: {} })).isError).toBe(true);
  } finally {
    await alice.close();
    await bob.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
