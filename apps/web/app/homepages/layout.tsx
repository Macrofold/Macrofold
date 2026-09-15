import type { Metadata } from 'next';
import '../../components/homepages/homepages.css';

export const metadata: Metadata = { title: 'Homepage studies', robots: { index: false, follow: false } };
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
