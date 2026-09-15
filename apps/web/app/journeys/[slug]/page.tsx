import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { headline, journeys, subtitle } from '../../../components/journeys/catalog';
import { JourneySite } from '../../../components/journeys/site';
type Props = { params: Promise<{ slug: string }> };
export function generateStaticParams() {
  return journeys.map(({ slug }) => ({ slug }));
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const selected = journeys.find((item) => item.slug === slug);
  return { title: selected ? `${selected.name} · ${headline}` : 'Journey not found', description: subtitle };
}
export default async function Page({ params }: Props) {
  const { slug } = await params;
  const study = journeys.find((item) => item.slug === slug);
  if (!study) notFound();
  return <JourneySite study={study} />;
}
