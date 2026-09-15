import type { Metadata } from 'next';
import { Providers } from '../lib/client';
import { ThemeProvider } from '../components/theme';
import { themeBootstrap } from '../lib/theme';
import './globals.css';
import '../components/shell.css';
import '../components/connectors.css';
import './interaction.css';
export const metadata: Metadata = {
  icons: { icon: { url: '/brands/macrofold/mark.svg', type: 'image/svg+xml', sizes: 'any' } },
  title: { default: 'Agent workspace', template: '%s · Agent workspace' },
  description: 'A persistent home for your cloud agents. Work through the dashboard, API, or terminal.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <ThemeProvider>
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
