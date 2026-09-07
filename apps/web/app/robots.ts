import type { MetadataRoute } from 'next';
import { config } from '@platform/core/config';
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/v1/',
        '/admin/',
        '/auth/',
        '/account',
        '/api-keys',
        '/projects',
        '/runs',
        '/agents',
        '/connections',
        '/team',
        '/billing',
        '/usage',
        '/webhooks',
        '/operator',
        '/developers',
        '/login',
        '/register',
        '/integrations/',
        '/internal/',
        '/runtime/',
        '/objects/',
        '/health',
      ],
    },
    sitemap: config.origin + '/sitemap.xml',
  };
}
