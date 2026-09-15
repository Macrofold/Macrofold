import type { Metadata } from 'next';
import { LandingSite } from '../../components/landing/site';
import { headline, subtitle } from '../../components/landing/content';

// The same public homepage, also available while signed in to the dashboard at /.
export const metadata: Metadata = {
  title: { absolute: `${headline} · Macrofold` },
  description: subtitle,
  alternates: { canonical: '/' },
  robots: { index: false, follow: true },
};
export default function Page() {
  return <LandingSite />;
}
