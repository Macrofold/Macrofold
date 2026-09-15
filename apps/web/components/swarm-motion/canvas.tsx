'use client';

import { useEffect, useRef, useState } from 'react';
import { createSwarmRenderer, LOOP_SECONDS, type SwarmVariant } from './renderer';

export const SWARM_POSTER = '/swarm-motion/swarm.webp';

/** Procedural decorative particles, with no connection to product activity. */
export function SwarmCanvas({
  variant = 'convergence',
  paused = false,
  original = false,
  playReducedMotion = false,
  seek,
  onTime,
  onReady,
}: {
  variant?: SwarmVariant;
  paused?: boolean;
  original?: boolean;
  playReducedMotion?: boolean;
  seek?: { seconds: number };
  onTime?: (seconds: number) => void;
  onReady?: (ready: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clock = useRef(0);
  const requestDraw = useRef(() => {});
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const props = useRef({ variant, paused, original, playReducedMotion, onTime, onReady });
  useEffect(() => {
    props.current = { variant, paused, original, playReducedMotion, onTime, onReady };
    requestDraw.current();
  }, [variant, paused, original, playReducedMotion, onTime, onReady]);
  useEffect(() => {
    if (seek) clock.current = seek.seconds % LOOP_SECONDS;
    requestDraw.current();
  }, [seek]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: ReturnType<typeof createSwarmRenderer> | undefined;
    let frame = 0;
    let disposed = false;
    let visible = true;
    let last = 0;
    let reported = 0;
    let dirty = true;
    let renderedTime = -1;
    let lastVariant = props.current.variant;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fail = () => {
      cancelAnimationFrame(frame);
      renderer?.dispose();
      renderer = undefined;
      setState('fallback');
      props.current.onReady?.(false);
    };
    const draw = (now: number) => {
      if (disposed || !renderer) return;
      const current = props.current;
      const running =
        !current.paused &&
        !current.original &&
        (!motion.matches || current.playReducedMotion) &&
        visible &&
        !document.hidden;
      if (lastVariant !== current.variant) {
        lastVariant = current.variant;
        dirty = true;
      }
      if (running && last)
        clock.current = (clock.current + (now - last) / 1000) % LOOP_SECONDS;
      if (running || dirty || renderedTime !== clock.current) {
        renderer.render(clock.current, current.variant);
        renderedTime = clock.current;
        dirty = false;
      }
      last = now;
      if (now - reported > 100) {
        current.onTime?.(clock.current);
        reported = now;
      }
      if (running) frame = requestAnimationFrame(draw);
    };
    const resume = () => {
      cancelAnimationFrame(frame);
      last = 0;
      dirty = true;
      if (renderer && visible && !document.hidden) frame = requestAnimationFrame(draw);
    };
    requestDraw.current = resume;
    const resize = () => {
      if (!renderer) return;
      const bounds = canvas.getBoundingClientRect();
      // Native pixels up to 4K width, bounded for retina/mobile GPU cost.
      const ratio = Math.min(window.devicePixelRatio || 1, 2, 3840 / Math.max(bounds.width, 1));
      renderer.resize(Math.max(bounds.width, 1), Math.max(bounds.height, 1), ratio);
      dirty = true;
      resume();
    };
    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(canvas);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      resume();
    });
    visibilityObserver.observe(canvas);
    document.addEventListener('visibilitychange', resume);
    motion.addEventListener('change', resume);
    canvas.addEventListener('webglcontextlost', fail);
    try {
      renderer = createSwarmRenderer(canvas);
      resize();
      renderer.render(clock.current, props.current.variant);
      setState('ready');
      props.current.onReady?.(true);
      resume();
    } catch {
      fail();
    }
    return () => {
      disposed = true;
      requestDraw.current = () => {};
      cancelAnimationFrame(frame);
      sizeObserver.disconnect();
      visibilityObserver.disconnect();
      document.removeEventListener('visibilitychange', resume);
      motion.removeEventListener('change', resume);
      canvas.removeEventListener('webglcontextlost', fail);
      renderer?.dispose();
    };
  }, []);

  return (
    <div
      className="swarm-canvas"
      data-renderer={state}
      data-original={original}
      data-motion-allowed={playReducedMotion}
    >
      {/* Kept in the server HTML for loading, no JavaScript, and GPU fallback. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={SWARM_POSTER}
        alt="An intricate emergent volume of ivory and cyan point samples in deep black."
        width={1536}
        height={1024}
        fetchPriority="high"
      />
      <canvas ref={canvasRef} aria-hidden="true" />
      {state === 'fallback' && (
        <p className="swarm-fallback" role="status">
          Still preview · animated rendering is unavailable in this browser.
        </p>
      )}
    </div>
  );
}
