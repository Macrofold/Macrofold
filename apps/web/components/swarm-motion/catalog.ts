import type { SwarmVariant } from './renderer';

export const swarmStudies: {
  id: SwarmVariant;
  name: string;
  gesture: string;
  description: string;
}[] = [
  {
    id: 'convergence',
    name: 'Convergence',
    gesture: 'Lattice → organic volume',
    description:
      'An ordered lattice funnels in from the left, branches into finer streams, and expands into a porous, swirling volume. The structure keeps evolving before it fades away.',
  },
  {
    id: 'tide',
    name: 'Tidal field',
    gesture: 'Flow → folding waves',
    description:
      'Incoming rows multiply into layered folds. A rolling current bends the emerging volume into waves, opening and closing its dark cavities before the fade.',
  },
  {
    id: 'parallax',
    name: 'Deep orbit',
    gesture: 'Inflow → expanding depth',
    description:
      'The lattice feeds a growing three-dimensional structure. A shallow camera arc reveals interlocking layers as particles continue to swirl through the finished mass.',
  },
  {
    id: 'filaments',
    name: 'Filament flow',
    gesture: 'Streams → interwoven folds',
    description:
      'Organized streams separate into finer filaments, curl around one another, and form an intricate volume. The currents remain active through the hold and fade.',
  },
  {
    id: 'breathe',
    name: 'Living volume',
    gesture: 'Branches → living structure',
    description:
      'A sparse inflow branches and expands into a dense organic structure. Its cavities breathe and its surface morphs, then the entire field gently disappears.',
  },
];
