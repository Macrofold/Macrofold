# Customer-data integration recipes

Choose the smallest data store your app already uses. An agent does not need a new memory product to read customer records. These recipes expose bounded read operations with customer identity supplied by verified application authentication, not by a tool argument or model output.

Start with [file memory](../../docs/features/customer-agents/memory.md) if files are sufficient. Use the [personal-agent application](../personal-agent/README.md) for customer/preset/worktree/session ownership. This directory owns runnable source and synthetic fixtures; it does not provision cloud accounts or enable paid calls.

## Choose a recipe

| Need                                       | Recipe                                                                    | Boundary that matters                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Existing Supabase application data         | [Supabase](#supabase) · [data.ts](data.ts) · [supabase.sql](supabase.sql) | Customer JWT plus database row-level security; never a service-role token in agent access |
| Existing relational app using Prisma       | [Prisma](#prisma) · [recipe.mjs](prisma/recipe.mjs)                       | Authenticated customer ID in every query; selected fields and result limit                |
| Semantic retrieval over your own vectors   | [Pinecone](#pinecone) · [data.ts](data.ts)                                | Server-derived namespace shared by indexing, query and deletion                           |
| A custom database/API behind an agent tool | [Remote MCP](#remote-mcp) · [mcp.ts](mcp.ts)                              | Bearer token resolves customer, fixed read tool, no arbitrary SQL or tenant selector      |

## Run the synthetic fixtures first

From the repository root, after the [local development prerequisites](../../docs/getting-started/local-development.md):

```sh
pnpm test:domain tests/unit/integration-recipes.test.ts tests/integration/supabase-recipe.test.ts
pnpm --dir examples/integrations/prisma --ignore-workspace install --frozen-lockfile
pnpm --dir examples/integrations/prisma test
```

The first command uses an isolated PostgreSQL database and actual MCP HTTP transport. Supabase REST and Pinecone requests use deterministic response fixtures; no cloud request is made. The SQL test executes the Supabase RLS policy in PostgreSQL, substituting only the local runtime role and a fixture `auth.uid()` helper. This proves policy behavior, not Supabase's hosted JWT issuer. Prisma runs its actual generated client against a temporary SQLite database and removes it afterward. Installation/client generation can download package or engine artifacts, but the data tests require no provider account or payment.

## Supabase

1. In a disposable Supabase project, run [supabase.sql](supabase.sql). It creates `customer_notes`, indexes customer identity, enables RLS, revokes anonymous access and grants authenticated customers only selected read columns.
2. Create two disposable Supabase Auth users and seed one synthetic note for each using a trusted administrative migration. Set each row's `customer_id` to its Auth user UUID. Keep administrative credentials outside the runtime recipe.
3. In your app, resolve the authenticated customer's current Supabase access token. Token refresh belongs to your server's normal Supabase Auth integration. The token subject must match the customer ID passed to the reader.
4. Configure the reader with a server-owned project URL and publishable key, then call it after authentication:

   ```ts
   import { supabaseNotes } from './examples/integrations/data';
   const readNotes = supabaseNotes({
     url: process.env.SUPABASE_URL!,
     publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY!,
     customerToken: async (verifiedCustomerId) => customerSessions.accessToken(verifiedCustomerId),
   });
   const result = await readNotes(authenticatedCustomer.id);
   ```

   `customerSessions` and `authenticatedCustomer` are your app's existing verified session components, not globals supplied by this recipe. The adapter takes that boundary as a function so it does not couple authentication to a specific framework.

5. Verify Alice sees only Alice's note, Bob sees only Bob's, an expired/missing token is denied, anonymous reads return no customer data, and insert/update/delete are denied. Test this on a disposable hosted project before production.

The request selects only `id,title,body`, uses an encoded customer filter and caps results at 20. RLS remains the authority if the application filter is removed. The adapter refuses redirects, uses a ten-second timeout, limits responses to 1 MiB and does not retry failures. Never replace a failing customer JWT with `service_role`, which bypasses the intended isolation. See [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [API keys](https://supabase.com/docs/guides/getting-started/api-keys).

## Prisma

The standalone [Prisma package](prisma/package.json) keeps its generated client and dependencies out of the platform runtime. It pins Prisma and its SQLite driver adapter together; its [schema](prisma/schema.prisma) defines an indexed `customerId` on every note. [recipe.test.mjs](prisma/recipe.test.mjs) generates the client, creates a disposable database, seeds Alice/Bob and exercises the real query.

```sh
pnpm --dir examples/integrations/prisma --ignore-workspace install --frozen-lockfile
pnpm --dir examples/integrations/prisma test
```

Use [prismaNotes](prisma/recipe.mjs) with your existing generated `PrismaClient`. Pass only the customer ID returned by your application's authentication. It issues a parameterized `findMany` with a fixed `where`, selected public fields, deterministic ordering and a limit of 20. It rejects a missing customer ID.

```js
import { prismaNotes } from './recipe.mjs';
const readNotes = prismaNotes(prisma); // your initialized server-side PrismaClient
const result = await readNotes(authenticatedCustomer.id);
```

When adapting the schema to PostgreSQL, use your normal Prisma migrations, credentials and connection pooling. The query's tenant filter is application enforcement; add database RLS or separate credentials if you need a second boundary. Do not expose generic `findMany`, raw SQL, model names or `where` objects as tool arguments. Keep writes in separately authorized operations with explicit schemas. Follow the version-specific [Prisma filtering documentation](https://www.prisma.io/docs/orm/prisma-client/queries/filtering-and-sorting) when changing the query.

## Pinecone

1. Choose an existing index and note its HTTPS data-plane host and vector dimension. Keep the index API key in your server secret store.
2. For every customer record you index, derive the namespace with **the same** `customerNamespace(verifiedCustomerId)` helper used by queries. Never accept a namespace string from an agent.
3. Create an embedding with your chosen embedding model outside this recipe. Use the same model/dimension for ingestion and querying. The fixture uses two-dimensional synthetic vectors and makes no embedding call.
4. Query with the verified customer ID:

   ```ts
   import { pineconeSearch, customerNamespace } from './examples/integrations/data';
   const search = pineconeSearch({
     indexHost: process.env.PINECONE_INDEX_HOST!, // https://your-index-host
     apiKey: process.env.PINECONE_API_KEY!,
     dimensions: 1536, // replace with your actual index dimension
   });
   const hits = await search(authenticatedCustomer.id, queryEmbedding);
   // Ingestion and deletion use customerNamespace(authenticatedCustomer.id), too.
   ```

5. Seed synthetic data in two namespaces. Query each customer and verify cross-customer records never appear. Deleting a customer requires removing its namespace and original source records under your retention policy; deleting vectors alone does not erase the source.

This recipe uses the dated `2025-10` query API, five results, metadata without full vector values, a ten-second timeout and a 1 MiB response bound. It deliberately omits embedding generation, indexing queues, reranking and writes. Pinecone API keys can span namespaces: the server must enforce customer identity. Retrieved metadata is untrusted content, not authority or instructions. Namespace scoping follows [Pinecone's multitenancy guidance](https://docs.pinecone.io/guides/index-data/implement-multitenancy); exact fields come from the [query API](https://docs.pinecone.io/reference/api/2025-10/data-plane/query).

## Remote MCP

The [server](mcp.ts) uses the maintained MCP TypeScript SDK already installed in the repository. It exposes one `read_customer_notes` tool, with no customer argument, no SQL and no writes. Its annotations describe read-only/idempotent behavior; the actual handler enforces it. Each request resolves a bearer token to a customer, then creates a fresh stateless server/transport so authentication cannot bleed between sessions.

### Try the local protocol

```sh
pnpm example:mcp
```

In another terminal:

```sh
curl --fail-with-body http://127.0.0.1:3230/mcp \
  -H 'Authorization: Bearer fixture-alice-token' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"local-example","version":"1"}}}'

curl --fail-with-body http://127.0.0.1:3230/mcp \
  -H 'Authorization: Bearer fixture-alice-token' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"read_customer_notes","arguments":{}}}'
```

Use `fixture-bob-token` to see Bob's different note. Omit the token to receive 401. These documented tokens and data are synthetic and accepted only by [start-mcp.ts](start-mcp.ts), which binds to loopback. They are not production credentials. The automated fixture uses actual SDK clients and tests missing credentials, browser-origin rejection, foreign customer arguments and unknown tools.

### Connect a deployed server to an agent

1. Replace fixture token lookup with your verified JWT signature/issuer/audience/expiry validation or a lookup of an opaque token hash. Return the stable customer ID. Support rotation/revocation in your normal account service. Bind a short-lived credential to one customer and this service's audience.
2. Supply a `CustomerNotes` function backed by one of the adapters above. Do not retrieve another customer's data based on tool arguments. Deploy behind your normal HTTPS origin, request limits and authentication controls.
3. In **Connections → Add connection → Remote MCP**, enter the public HTTPS `/mcp` URL, select bearer authentication, and enter that customer's token. The platform intentionally rejects loopback/private URLs; do not disable network validation to connect the fixture directly.
4. Load the tool list, approve only **read_customer_notes**, and choose **Access → Add rule → Project + agent preset** for the intended customer-agent. Save that exact tool selection in the preset. Start a new conversation after the selection changes.
5. Review resolved access and run one authorized test with an explicit run budget. Confirm another customer's preset has no access. A 401 requires reauthentication, not fallback to an administrative credential.

The equivalent server-side SDK setup, after authenticating the customer and resolving their owned project/preset, is:

```ts
const connection = await client.connections.create(
  {
    name: 'Customer notes',
    kind: 'mcp_remote',
    provider: 'customer-notes',
    url: process.env.CUSTOMER_MCP_URL!,
    auth_method: 'bearer',
    secret: customerMcpToken,
  },
  { idempotencyKey: savedCreateKey },
);
const access = await client.connections.getAccess(connection.id);
const approved = await client.connections.updateAccess(
  connection.id,
  {
    tools: ['read_customer_notes'],
    ifMatch: `"${access.version}"`,
  },
  { idempotencyKey: savedApprovalKey },
);
await client.connections.createAccessRule(
  connection.id,
  {
    scope: 'project_agent',
    project_id: agent.projectId,
    agent_id: agent.presetId,
    ifMatch: `"${approved.version}"`,
  },
  { idempotencyKey: savedRuleKey },
);
await client.agents.update(
  agent.presetId,
  {
    connection_grants: [{ connection_id: connection.id, tools: ['read_customer_notes'] }],
  },
  { idempotencyKey: savedSelectionKey },
);
```

Persist `connection.id`, keys and request bodies/revisions for recovery as shown in the [reference app](../personal-agent/README.md#recovery-without-duplicate-side-effects). `agent`, `customerMcpToken` and `saved…Key` values belong to your server, never to model-selected arguments. This uses supported bearer authentication; the recipe is not an OAuth authorization server and does not implement arbitrary OAuth discovery. The MCP transport follows the SDK's [stateless server example](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/examples/server/simpleStatelessStreamableHttp.ts).

## Acceptance and AI implementation map

Read this guide, the selected source adapter, its schema/SQL, [customer identity](../../docs/features/customer-agents/README.md), [connection access](../../docs/features/identity-integrations/connection-access.md), [network protections](../../docs/features/identity-integrations/implementation.md) and the [SDK reference](../../docs/features/api/sdks/reference.md). Keep the identity resolver outside the data adapter and preserve query bounds and error redaction.

Local fixtures establish request shapes, data filtering/RLS, typed responses, actual Prisma queries and MCP transport isolation. They do not establish live Supabase/Pinecone availability, real customer credentials, provider billing, hosted OAuth or internet deployment. Before release, use disposable accounts, confirm both positive and negative access paths, and record the provider/version, test customer IDs (synthetic), request IDs and redacted results. Never put tokens or customer note bodies in general logs.
