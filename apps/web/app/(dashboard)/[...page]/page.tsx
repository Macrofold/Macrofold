import { Dashboard } from '../../../components/dashboard';
export default async function Page({ params }: { params: Promise<{ page?: string[] }> }) {
  return <Dashboard segments={(await params).page || []} />;
}
