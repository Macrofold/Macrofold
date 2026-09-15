'use client';

import { useEffect, useState } from 'react';

const key = 'macrofold.dashboard.motion';

/** Explicit dashboard playback, independent of marketing and the device preference.
 * The document attribute also reaches portalled controls; remove it on leaving the app. */
export function useDashboardMotion() {
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    const sync = () => {
      let enabled = true;
      try {
        enabled = localStorage.getItem(key) !== 'paused';
      } catch {
        /* Page-only preference. */
      }
      setPlaying(enabled);
      document.documentElement.dataset.dashboardMotion = enabled ? 'playing' : 'paused';
    };
    sync();
    const changed = (event: StorageEvent) => {
      if (event.key === key || event.key === null) sync();
    };
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener('storage', changed);
      delete document.documentElement.dataset.dashboardMotion;
    };
  }, []);
  return {
    playing,
    toggle: () => {
      const enabled = !playing;
      setPlaying(enabled);
      document.documentElement.dataset.dashboardMotion = enabled ? 'playing' : 'paused';
      try {
        localStorage.setItem(key, enabled ? 'playing' : 'paused');
      } catch {
        /* Page-only preference. */
      }
    },
  };
}
