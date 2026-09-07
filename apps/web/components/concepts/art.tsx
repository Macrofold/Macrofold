import Image from 'next/image';
import type { Concept } from './catalog';
import { AnimationStudy } from './controls';

/** Generated posters are artwork, never live activity or an execution/capacity claim. */
export function ConceptArt({ concept, gallery = false }: { concept: Concept; gallery?: boolean }) {
  const halfWidth = gallery || concept.layout === 'split' || concept.layout === 'editorial';
  return (
    <AnimationStudy name={concept.name} description={concept.animation} technique={concept.technique}>
      <div className="concept-art">
        <Image
          src={`/concepts/${concept.slug}.png`}
          alt={concept.art}
          width={1536}
          height={1024}
          sizes={halfWidth ? '(max-width: 700px) 100vw, 50vw' : '100vw'}
          priority={!gallery}
        />
      </div>
    </AnimationStudy>
  );
}
