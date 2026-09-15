import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { headline, subtitle, homepages, studyBrand } from '../../../components/homepages/catalog';
import { HomepageSite } from '../../../components/homepages/site';

type Props = { params: Promise<{ slug: string }> };
export function generateStaticParams() {
  return homepages.map(({ slug }) => ({ slug }));
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const study = homepages.find((item) => item.slug === slug);
  return { title: study ? `${study.name} · ${headline}` : 'Homepage not found', description: subtitle };
}
export default async function Page({ params }: Props) {
  const { slug } = await params;
  const study = homepages.find((item) => item.slug === slug);
  if (!study) notFound();
  return <HomepageSite study={study} name={studyBrand} />;
}
