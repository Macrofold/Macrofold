import { swarmMovie, swarmPlaybackRate, swarmStudies, type SwarmWidth } from './swarm-media';

type Connection = EventTarget & { saveData?: boolean; effectiveType?: string; downlink?: number };
type SwarmStatus = 'playing' | 'blocked' | 'unavailable';
type Slot = {
  video: HTMLVideoElement;
  index: number;
  width: SwarmWidth;
  generation: number;
  pending: boolean;
};

/** Two native decoders, one playing; no frame loop, media fetch blobs, or React time updates. */
export function createSwarmPlayer(
  host: HTMLElement,
  videos: readonly [HTMLVideoElement, HTMLVideoElement],
  base: string,
  onStatus: (status: SwarmStatus) => void,
) {
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  const slots: Slot[] = videos.map((video) => ({
    video,
    index: -1,
    width: 960,
    generation: 0,
    pending: false,
  }));
  let active = 0;
  let shown = -1;
  let paused = false;
  let visible = false;
  let pageActive = true;
  let destroyed = false;
  let blocked = false;
  let exhausted = false;
  let preferredWidth: SwarmWidth = 960;
  let chosen = false;
  const failed = new Set<number>();
  const removers: (() => void)[] = [];
  const running = () =>
    !destroyed && !paused && !blocked && !exhausted && visible && pageActive && !document.hidden;

  function listen(target: EventTarget, event: string, listener: EventListener) {
    target.addEventListener(event, listener);
    removers.push(() => target.removeEventListener(event, listener));
  }
  function show(slot: number) {
    shown = slot;
    videos.forEach((video, i) => {
      video.style.opacity = i === slot ? '1' : '0';
    });
    host.dataset.videoVisible = String(slot >= 0);
  }
  function clear(slot: Slot) {
    slot.generation++;
    slot.pending = false;
    slot.index = -1;
    slot.video.pause();
    slot.video.removeAttribute('src');
    slot.video.load();
  }
  function load(slot: Slot, index: number, width: SwarmWidth) {
    clear(slot);
    slot.index = index;
    slot.width = width;
    slot.video.preload = 'auto';
    slot.video.defaultPlaybackRate = swarmPlaybackRate;
    slot.video.src = swarmMovie(base, swarmStudies[index], width);
    slot.video.load();
    slot.video.playbackRate = swarmPlaybackRate;
  }
  function next(index: number) {
    for (let step = 1; step <= swarmStudies.length; step++) {
      const candidate = (index + step) % swarmStudies.length;
      if (!failed.has(candidate)) return candidate;
    }
    return -1;
  }
  function unavailable() {
    exhausted = true;
    slots.forEach(clear);
    show(-1);
    onStatus('unavailable');
  }
  function play() {
    const slot = slots[active];
    if (!running() || slot.pending || slot.index < 0 || !slot.video.paused) return;
    const generation = slot.generation;
    slot.pending = true;
    let interrupted = false;
    slot.video
      .play()
      .catch((error: unknown) => {
        if (destroyed || generation !== slot.generation) return;
        if (error instanceof DOMException && error.name === 'AbortError') {
          interrupted = true;
          return;
        }
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          blocked = true;
          onStatus('blocked');
        } else fail(slot);
      })
      .finally(() => {
        if (generation === slot.generation) {
          slot.pending = false;
          if (interrupted && running()) play();
        }
      });
  }
  function prepareNext() {
    if (!running() || slots[active].video.currentTime < 2) return;
    // Wait for a healthy buffer before the next download competes with this one.
    const current = slots[active].video;
    let ahead = 0;
    for (let i = 0; i < current.buffered.length; i++) {
      if (current.buffered.start(i) <= current.currentTime && current.buffered.end(i) >= current.currentTime)
        ahead = current.buffered.end(i) - current.currentTime;
    }
    if (ahead < 6 && current.duration - current.currentTime > 8) return;
    const standby = slots[1 - active];
    if (standby.index >= 0) return;
    const index = next(slots[active].index);
    if (index >= 0) load(standby, index, preferredWidth);
  }
  function advance() {
    if (!running()) return;
    const old = active;
    const standby = slots[1 - active];
    const index = next(slots[active].index);
    if (index < 0) return unavailable();
    if (standby.index !== index) load(standby, index, preferredWidth);
    active = 1 - active;
    // The outgoing frame stays until the incoming decoder actually presents a frame.
    slots[old].video.pause();
    play();
  }
  function fail(slot: Slot) {
    if (destroyed || slot.index < 0 || exhausted) return;
    if (slot.width === 1440) {
      preferredWidth = 960;
      const index = slot.index;
      if (running()) {
        load(slot, index, 960);
        if (slot === slots[active]) play();
      } else {
        // Keep the index for a retry once visible; do not start hidden downloads.
        slot.video.pause();
      }
      return;
    }
    failed.add(slot.index);
    if (slot !== slots[active]) {
      clear(slot);
      return;
    }
    const index = next(slot.index);
    if (index < 0) return unavailable();
    clear(slot);
    if (running()) {
      load(slot, index, preferredWidth);
      play();
    }
  }
  function sync() {
    if (destroyed) return;
    if (!running()) {
      slots.forEach((slot) => slot.video.pause());
      // Cancel speculative loading while offscreen/paused; preserve the active frame.
      const standby = slots[1 - active];
      if (standby.index >= 0 && shown !== 1 - active) clear(standby);
      return;
    }
    if (!chosen) {
      const slow = connection?.effectiveType && /(^2g$|slow-2g|3g)/.test(connection.effectiveType);
      preferredWidth =
        connection?.saveData ||
        innerWidth < 768 ||
        host.clientWidth <= 960 ||
        slow ||
        (connection?.downlink !== undefined && connection.downlink < 15)
          ? 960
          : 1440;
      chosen = true;
    }
    const slot = slots[active];
    if (slot.index < 0) {
      const index = next(-1);
      if (index < 0) return unavailable();
      load(slot, index, preferredWidth);
    } else if (slot.video.error) {
      fail(slot);
      return;
    }
    if (slot.video.ended) advance();
    else {
      play();
      prepareNext();
    }
  }
  for (const [index, slot] of slots.entries()) {
    slot.video.muted = true;
    slot.video.defaultMuted = true;
    slot.video.playsInline = true;
    slot.video.loop = false;
    listen(slot.video, 'playing', () => {
      if (active !== index || !running()) {
        slot.video.pause();
        return;
      }
      const changed = shown !== index;
      show(index);
      onStatus('playing');
      if (changed) clear(slots[1 - active]);
    });
    listen(slot.video, 'ended', () => {
      if (active === index) advance();
    });
    listen(slot.video, 'error', () => fail(slot));
    listen(slot.video, 'timeupdate', () => {
      if (active === index) {
        play();
        prepareNext();
      }
    });
    listen(slot.video, 'progress', () => {
      if (active === index) prepareNext();
    });
    listen(slot.video, 'canplay', () => {
      if (active === index) play();
    });
  }
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  });
  observer.observe(host);
  // Safari can refuse autoplay (for example in Low Power Mode). Retry directly
  // inside a normal user gesture, where playback is permitted, without a new UI.
  // Also allow recovery after a temporary delivery failure such as stale DNS.
  function retryAfterInteraction() {
    if (paused || (!blocked && !exhausted)) return;
    blocked = false;
    exhausted = false;
    failed.clear();
    sync();
  }
  listen(document, 'touchend', retryAfterInteraction);
  listen(document, 'click', retryAfterInteraction);
  listen(document, 'keydown', retryAfterInteraction);
  listen(document, 'visibilitychange', sync);
  if (connection) listen(connection, 'change', sync);
  listen(window, 'pagehide', () => {
    pageActive = false;
    sync();
  });
  listen(window, 'pageshow', () => {
    pageActive = true;
    sync();
  });
  return {
    setIntent(isPaused: boolean, userInitiated: boolean) {
      if (!isPaused && userInitiated) {
        blocked = false;
        if (exhausted) {
          exhausted = false;
          failed.clear();
        }
      }
      paused = isPaused;
      sync();
    },
    destroy() {
      destroyed = true;
      observer.disconnect();
      removers.forEach((remove) => remove());
      slots.forEach(clear);
    },
  };
}
