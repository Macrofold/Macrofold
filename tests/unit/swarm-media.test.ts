import { describe, expect, it } from 'vitest';
import { swarmMediaBase, swarmMovie, swarmStudies } from '../../apps/web/components/landing/swarm-media';

describe('public marketing media configuration', () => {
  it('leaves the preserved poster in place without a valid public base', () => {
    for (const value of [
      undefined,
      '',
      'javascript:alert(1)',
      'https://user:secret@cdn.test',
      '//cdn.test',
      '/media?token=secret',
      'https://cdn.test?token=secret',
    ])
      expect(swarmMediaBase(value)).toBeUndefined();
  });
  it('uses versioned public assets and supports a staged local preview', () => {
    expect(swarmMediaBase(' https://media.example.com/swarm/v1/ ')).toBe(
      'https://media.example.com/swarm/v1',
    );
    expect(swarmMediaBase('/swarm-media/myriad/v1/')).toBe('/swarm-media/myriad/v1');
    expect(swarmMovie('https://media.example.com/swarm/v1/', 'druse', 1440)).toBe(
      'https://media.example.com/swarm/v1/web/druse/druse-1440.h264.mp4',
    );
    expect(new Set(swarmStudies).size).toBe(11);
  });
});
