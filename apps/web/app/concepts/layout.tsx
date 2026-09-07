import type { Metadata } from 'next';
import '../../components/concepts/concepts.css';
export const metadata: Metadata = { title: 'Marketing concepts', robots: { index: false, follow: false } };
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
