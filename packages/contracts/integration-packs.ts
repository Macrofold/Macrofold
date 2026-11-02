/** Curated capability descriptions, not a registry of executable third-party code. */
export const integrationPacks = [
  {
    id: 'file-memory',
    name: 'Editable memory',
    category: 'memory',
    availability: 'available',
    summary: 'Preferences, notes and tasks in ordinary editable files across conversations.',
    capture: 'Agent instructions guide updates; this is not guaranteed semantic recall.',
    funding: 'Uses the normal Run model budget. No additional memory service.',
  },
  {
    id: 'hindsight',
    name: 'Hindsight',
    category: 'memory',
    availability: 'setup_required',
    summary: 'Automatic fact extraction and relevant recall through a dedicated memory bank.',
    capture:
      'Successful final user/assistant conversation notes, background retention and bounded retrieval.',
    funding: 'A configured memory service and explicit funding are required before activation.',
  },
  {
    id: 'claude-mem',
    name: 'Claude-mem',
    category: 'memory',
    availability: 'setup_required',
    summary: 'Engineering history and relevant recall across separate conversations.',
    capture:
      'Terminal Run narratives, bounded committed tool-outcome metadata and known verified provenance; no raw arguments, results or reasoning.',
    funding: 'A configured hosted memory service and explicit funding are required before activation.',
  },
] as const;

export type IntegrationPackId = (typeof integrationPacks)[number]['id'];
export type IntegrationState = 'active' | 'paused' | 'disabled';

/** Shared with examples and the installer. The platform does not assign special
 * semantics to these filenames; only an explicit installation adds guidance. */
export const defaultMemoryLayout = {
  profile: 'profile.md',
  memories: 'memory',
  tasks: 'tasks.json',
};
