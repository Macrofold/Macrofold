import { withWorkflow } from 'workflow/next';
import type { NextConfig } from 'next';
import path from 'node:path';
const config: NextConfig = {
  // Optional isolated local acceptance build; normal deployments keep .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Isolated acceptance must not type-check another build's generated route validators.
  ...(process.env.NEXT_TYPECHECK_CONFIG
    ? { typescript: { tsconfigPath: process.env.NEXT_TYPECHECK_CONFIG } }
    : {}),
  // Isolated coverage builds only; deployment artifacts do not publish application source maps.
  ...(process.env.TEST_COVERAGE_BUILD === '1' && !process.env.VERCEL
    ? { productionBrowserSourceMaps: true, experimental: { serverSourceMaps: true } }
    : {}),
  // Vercel's adapter packages Functions; standalone copying is only for self-hosting.
  // Next 16.3 skips the server trace with an adapter, so requesting both fails the build.
  output: process.env.VERCEL === '1' ? undefined : 'standalone',
  outputFileTracingRoot: path.resolve(import.meta.dirname, '../..'),
  outputFileTracingExcludes: {
    '/*': [
      '../../.data/**',
      '../../.env*',
      '../../.git/**',
      '../../test-results/**',
      '../../tests/**',
      '../../packages/runtime/node_modules/**',
    ],
  },
  serverExternalPackages: ['pg', '@anthropic-ai/claude-agent-sdk', '@composio/core'],
  poweredByHeader: false,
  logging: { incomingRequests: { ignore: [/\/objects\//, /\/integrations\/[^/]+\/callback/] } },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
export default withWorkflow(config);
