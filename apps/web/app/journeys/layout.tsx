import type { Metadata } from 'next';
import '../../components/journeys/journeys.css';

export const metadata: Metadata = {
  title: 'Journey design library',
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
