/** URLs are relative to a versioned public media directory, never the private file store. */
export const swarmStudies = [
  'tetrarch',
  'hypercell',
  'aperiodic',
  'alveoli',
  'druse',
  'plexus',
  'coronet',
  'viscera',
  'thalassa',
  'chitin',
  'maelstrom',
] as const;

export const swarmPlaybackRate = 1.3;
export type SwarmStudy = (typeof swarmStudies)[number];
export type SwarmWidth = 960 | 1440;

export function swarmMovie(base: string, study: SwarmStudy, width: SwarmWidth) {
  return `${base.replace(/\/$/, '')}/web/${study}/${study}-${width}.h264.mp4`;
}

export function swarmMediaBase(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const base = value.trim().replace(/\/$/, '');
  // Root-relative paths support a staged local preview without a media proxy.
  if (base.startsWith('/') && !base.startsWith('//') && !/[?#\\]/.test(base)) return base;
  try {
    const url = new URL(base);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) return base;
  } catch {
    /* Invalid configuration leaves the hero background clear. */
  }
  return undefined;
}
