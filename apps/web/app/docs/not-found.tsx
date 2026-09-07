import Link from 'next/link';
export default function GuideNotFound() {
  return (
    <main id="docs-content" className="docs-main">
      <div className="docs-breadcrumb">Documentation</div>
      <h1>Guide not found</h1>
      <p className="docs-description">
        This page may have moved. Browse the documentation or search for the topic you need.
      </p>
      <div className="docs-prose">
        <p>
          <Link href="/docs">Explore the documentation</Link> or{' '}
          <Link href="/docs/quickstart">start with the quickstart</Link>.
        </p>
      </div>
    </main>
  );
}
