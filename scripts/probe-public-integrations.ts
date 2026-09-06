import { safeFetch } from '../packages/providers/src/network';
import { boundedJSON } from '../packages/core/src/body';

// Fixed GET-only metadata routes, no .env/config import, credentials, payloads,
// vendor SDK initialization, retries, redirects, or account resource creation.
// A denial proves reachability/auth enforcement, never authenticated integration.
const probes = [
  {
    name: 'github_metadata',
    url: 'https://api.github.com/meta',
    status: [200],
    field: 'verifiable_password_authentication',
  },
  {
    name: 'openrouter_model_catalog',
    url: 'https://openrouter.ai/api/v1/models',
    status: [200],
    field: 'data',
  },
  { name: 'openai_model_auth', url: 'https://api.openai.com/v1/models', status: [401], field: 'error' },
  {
    name: 'anthropic_model_auth',
    url: 'https://api.anthropic.com/v1/models',
    status: [401],
    field: 'error',
    headers: { 'anthropic-version': '2023-06-01' },
  },
  { name: 'stripe_balance_auth', url: 'https://api.stripe.com/v1/balance', status: [401], field: 'error' },
  {
    name: 'composio_catalog_auth',
    url: 'https://backend.composio.dev/api/v3.1/tools?limit=1',
    status: [401, 403],
    field: 'error',
  },
  { name: 'resend_domains_auth', url: 'https://api.resend.com/domains', status: [401], field: 'message' },
  {
    name: 'vercel_sandbox_list_auth',
    url: 'https://vercel.com/api/v2/sandboxes?limit=1',
    status: [401, 403],
    field: 'error',
  },
] as const;

const results = await Promise.all(
  probes.map(async (probe) => {
    try {
      const response = await safeFetch(probe.url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'integration-readiness-probe/1.0',
          ...('headers' in probe ? probe.headers : {}),
        },
        signal: AbortSignal.timeout(15000),
      });
      const body = await boundedJSON(response, 8 * 1024 * 1024);
      const object = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      const shape =
        probe.field === 'data'
          ? Array.isArray(object.data) &&
            object.data.length > 0 &&
            object.data.every(
              (model: unknown) =>
                model !== null && typeof model === 'object' && 'id' in model && typeof model.id === 'string',
            )
          : probe.field === 'verifiable_password_authentication'
            ? typeof object[probe.field] === 'boolean'
            : probe.field in object;
      const ok = (probe.status as readonly number[]).includes(response.status) && shape;
      return {
        name: probe.name,
        url: probe.url,
        status: response.status,
        expected_status: probe.status,
        schema_matches: shape,
        ok,
        evidence: response.ok ? 'public_metadata_only' : 'unauthenticated_denial_only',
      };
    } catch (error) {
      return {
        name: probe.name,
        url: probe.url,
        ok: false,
        error: error instanceof Error ? error.name : 'UnknownError',
      };
    }
  }),
);
console.log(
  JSON.stringify(
    { observed_at: new Date().toISOString(), authenticated: false, paid_operations: 0, results },
    null,
    2,
  ),
);
if (results.some((result) => !result.ok)) process.exitCode = 1;
