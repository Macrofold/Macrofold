import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { config } from '@platform/core/config';
import { concepts, productDescription } from '../../../components/concepts/catalog';
import { ConceptSite } from '../../../components/concepts/site';
type Props = { params: Promise<{ slug: string }> };
export function generateStaticParams() {
  return concepts.map(({ slug }) => ({ slug }));
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const concept = concepts.find((c) => c.slug === slug);
  return {
    title: concept ? `${concept.name} · ${config.name}` : 'Concept not found',
    description: productDescription,
  };
}
export default async function Page({ params }: Props) {
  const { slug } = await params;
  const concept = concepts.find((c) => c.slug === slug);
  if (!concept) notFound();
  return <ConceptSite concept={concept} name={config.name} />;
}
