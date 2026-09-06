import type { Metadata } from 'next';
import { Providers } from '../lib/client';
import './globals.css';
import '../components/connectors.css';
export const metadata: Metadata = {
  title: { default: 'Agent workspace', template: '%s · Agent workspace' },
  description: 'A persistent home for your cloud agents. Work through the dashboard, API, or terminal.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
