import type { MetadataRoute } from 'next';
import { config } from '@platform/core/config';
import { pages } from '../lib/docs/content';
export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/pricing', '/reference', ...pages.map((page) => page.url)].map((url) => ({
    url: config.origin + url,
  }));
}
