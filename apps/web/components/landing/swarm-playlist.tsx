'use client';

import { useEffect, useRef } from 'react';
import { useMarketingMotion } from './controls';
import { createSwarmPlayer } from './swarm-player';

export function SwarmPlaylist({ baseUrl }: { baseUrl?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLVideoElement>(null);
  const second = useRef<HTMLVideoElement>(null);
  const player = useRef<ReturnType<typeof createSwarmPlayer> | null>(null);
  const motion = useMarketingMotion();
  const intent = useRef(motion);
  intent.current = motion;
  useEffect(() => {
    if (!baseUrl || !host.current || !first.current || !second.current) return;
    const element = host.current;
    const controller = createSwarmPlayer(element, [first.current, second.current], baseUrl, (status) => {
      element.dataset.status = status;
    });
    player.current = controller;
    controller.setIntent(intent.current.paused, intent.current.explicit);
    return () => {
      controller.destroy();
      player.current = null;
    };
  }, [baseUrl]);
  useEffect(() => {
    player.current?.setIntent(motion.paused, motion.explicit);
  }, [motion.paused, motion.explicit]);
  return (
    <div className="mf-swarm" ref={host} data-status="idle">
      {baseUrl && (
        <>
          <video ref={first} className="mf-swarm-video" muted playsInline preload="none" aria-hidden="true" />
          <video
            ref={second}
            className="mf-swarm-video"
            muted
            playsInline
            preload="none"
            aria-hidden="true"
          />
        </>
      )}
    </div>
  );
}
