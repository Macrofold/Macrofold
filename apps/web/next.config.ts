import { withWorkflow } from 'workflow/next';
import type { NextConfig } from 'next';
import path from 'node:path';
const config: NextConfig = {
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
