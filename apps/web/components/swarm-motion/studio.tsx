'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import * as Tabs from '@radix-ui/react-tabs';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  Check,
  Expand,
  Layers3,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react';
import { SwarmCanvas } from './canvas';
import { swarmStudies } from './catalog';
import type { SwarmVariant } from './renderer';

type Download = { url: string; filename: string; label: string; bytes: number };

export function SwarmMotionStudio() {
  const [variant, setVariant] = useState<SwarmVariant>('convergence');
  const [paused, setPaused] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [motionOptIn, setMotionOptIn] = useState(false);
  const [original, setOriginal] = useState(false);
  const [copy, setCopy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [seek, setSeek] = useState({ seconds: 0 });
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState<number | null>(null);
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [error, setError] = useState('');
  const stageRef = useRef<HTMLElement>(null);
  const exportController = useRef<AbortController | null>(null);
  const objectUrls = useRef<string[]>([]);
  const study = swarmStudies.find((item) => item.id === variant) ?? swarmStudies[0];

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      setReduced(media.matches);
      setPaused(media.matches);
      setMotionOptIn(false);
    };
    update();
    media.addEventListener('change', update);
    const requested = new URLSearchParams(window.location.search).get('version');
    const match = swarmStudies.find((item) => item.id === requested);
    if (match) setVariant(match.id);
    return () => {
      media.removeEventListener('change', update);
      exportController.current?.abort();
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  function select(value: string) {
    const selected = swarmStudies.find((item) => item.id === value);
    if (!selected) return;
    setVariant(selected.id);
    setOriginal(false);
    setSeek({ seconds: 0 });
    setSeconds(0);
    const url = new URL(window.location.href);
    url.searchParams.set('version', selected.id);
    window.history.replaceState(null, '', url);
  }

  async function record(width: number, height: number) {
    if (!ready || exportController.current) return;
    const controller = new AbortController();
    exportController.current = controller;
    setRecording(0);
    setError('');
    setPaused(true);
    try {
      const { exportSwarmVideo } = await import('./export');
      const result = await exportSwarmVideo(variant, {
        width,
        height,
        signal: controller.signal,
        onProgress: setRecording,
      });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(result.blob);
      objectUrls.current.push(url);
      setDownloads((previous) => [
        ...previous,
        {
          url,
          filename: `swarm-${variant}-${height}p.${result.extension}`,
          label: `${study.name} · ${height === 2160 ? '4K' : '1080p'}`,
          bytes: result.blob.size,
        },
      ]);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Video export failed. Please try again.');
    } finally {
      if (exportController.current === controller) {
        exportController.current = null;
        setRecording(null);
      }
    }
  }

  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch {
      setError('Fullscreen is unavailable in this browser. The preview still plays here.');
    }
  }

  return (
    <main className="swarm-studio">
      <header className="swarm-studio-nav">
        <Link href="/concepts/swarm">
          <ArrowLeft size={14} /> Back to Swarm
        </Link>
        <span>
          <Layers3 size={17} /> Motion studies <i>/</i> 001—005
        </span>
        <a href="/concepts/swarm.png" target="_blank" rel="noreferrer">
          Source artwork <ArrowUpRight size={14} />
        </a>
      </header>

      <div className="swarm-studio-intro">
        <div>
          <p className="swarm-eyebrow">From a field to a form</p>
          <h1>Swarm, in motion.</h1>
        </div>
        <p>
          Five particle systems. One emergent structure.
          <br />
          Lattice inflow, organic growth, then a slow fade.
        </p>
      </div>

      <Tabs.Root value={variant} onValueChange={select} className="swarm-studies">
        <figure className="swarm-stage" ref={stageRef} aria-label="Swarm animation preview">
          <SwarmCanvas
            playReducedMotion={motionOptIn}
            variant={variant}
            paused={paused || recording !== null}
            original={original}
            seek={seek}
            onTime={setSeconds}
            onReady={setReady}
          />
          <div className="swarm-stage-top">
            <span>{original ? 'Original still' : `0${swarmStudies.indexOf(study) + 1} / ${study.name}`}</span>
            <span>
              15 second loop <i>↻</i>
            </span>
          </div>
          {copy && (
            <div className="swarm-hero-copy">
              <p>Put coding agents to work in the cloud</p>
              <h2>
                A new kind of software
                <br />
                starts with you.
              </h2>
              <p>Run Claude Code, Codex, and OpenCode in the cloud through one API.</p>
              <span>
                Start building <ArrowUpRight size={14} />
              </span>
            </div>
          )}
          <div className="swarm-stage-actions">
            <button
              type="button"
              aria-label="Show original"
              aria-pressed={original}
              onClick={() => setOriginal(!original)}
            >
              {original && <Check size={13} />} Original
            </button>
            <button
              type="button"
              aria-label="Show hero copy"
              aria-pressed={copy}
              onClick={() => setCopy(!copy)}
            >
              {copy && <Check size={13} />} Hero copy
            </button>
            <button type="button" aria-label="Fullscreen preview" onClick={() => void fullscreen()}>
              <Expand size={15} />
            </button>
          </div>
          <figcaption className="swarm-sr-only">
            Abstract animated artwork; points do not represent real agents or activity.
          </figcaption>
        </figure>

        <div className="swarm-transport">
          <button
            type="button"
            aria-label={paused ? 'Play animation' : 'Pause animation'}
            disabled={!ready || original || recording !== null}
            onClick={() => {
              setMotionOptIn(true);
              setPaused(!paused);
            }}
          >
            {paused ? <Play size={17} fill="currentColor" /> : <Pause size={17} fill="currentColor" />}
          </button>
          <button
            type="button"
            aria-label="Restart animation"
            disabled={!ready || recording !== null}
            onClick={() => {
              setSeek({ seconds: 0 });
              setSeconds(0);
            }}
          >
            <RotateCcw size={15} />
          </button>
          <input
            type="range"
            aria-label="Animation time"
            aria-valuetext={`${seconds.toFixed(1)} of 15 seconds`}
            min={0}
            max={15}
            step={0.01}
            value={seconds}
            disabled={!ready || recording !== null}
            onChange={(event) => {
              const value = Number(event.target.value);
              setPaused(true);
              setMotionOptIn(true);
              setSeconds(value);
              setSeek({ seconds: value });
            }}
          />
          <output aria-live="off">
            {seconds.toFixed(1).padStart(4, '0')} <span>/ 15.0 s</span>
          </output>
          <span className="swarm-playback-label">
            {reduced && !motionOptIn
              ? 'Reduced motion'
              : original
                ? 'Original'
                : paused
                  ? 'Paused'
                  : 'Looping'}
          </span>
        </div>

        <div className="swarm-phase-track" aria-label="Animation sequence">
          <span data-active={seconds < 5}>
            <b>01</b> Build <small>0–5 s</small>
          </span>
          <span data-active={seconds >= 5 && seconds < 10}>
            <b>02</b> Swirl &amp; morph <small>5–10 s</small>
          </span>
          <span data-active={seconds >= 10 && seconds < 13}>
            <b>03</b> Fade <small>10–13 s</small>
          </span>
          <span data-active={seconds >= 13}>
            <b>04</b> Reset <small>13–15 s</small>
          </span>
        </div>

        <Tabs.List className="swarm-version-list" aria-label="Animation version">
          {swarmStudies.map((item, index) => (
            <Tabs.Trigger
              key={item.id}
              value={item.id}
              className="swarm-version"
              disabled={recording !== null}
            >
              <span className="swarm-version-index">
                0{index + 1}
                <span aria-hidden="true">↗</span>
              </span>
              <strong>{item.name}</strong>
              <small>{item.gesture}</small>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {swarmStudies.map((item, index) => (
          <Tabs.Content value={item.id} key={item.id} className="swarm-study-detail">
            <div>
              <p className="swarm-eyebrow">Study 0{index + 1}</p>
              <h2>{item.name}</h2>
            </div>
            <p>{item.description}</p>
            <span>
              Cyan / ivory
              <br />
              Continuous / 15 s
            </span>
          </Tabs.Content>
        ))}
      </Tabs.Root>

      <section className="swarm-export" aria-label="Use this animation">
        <div>
          <p className="swarm-eyebrow">Ready for the next frame</p>
          <h2>Made to move on the web.</h2>
          <p>Live particles scale with your screen. Export a silent video to use anywhere.</p>
        </div>
        <div className="swarm-export-actions">
          <button
            type="button"
            disabled={!ready || recording !== null}
            onClick={() => void record(1920, 1080)}
          >
            <ArrowDownToLine size={16} /> Export 1080p video
          </button>
          <button
            type="button"
            disabled={!ready || recording !== null}
            onClick={() => void record(3840, 2160)}
          >
            <ArrowDownToLine size={16} /> Export 4K video
          </button>
          <p>15 s · no audio · rendered locally</p>
        </div>
        {recording !== null && (
          <div className="swarm-export-progress" role="status">
            <progress max={1} value={recording} />
            <span>Rendering {Math.round(recording * 100)}% · Keep this tab visible.</span>
            <button type="button" onClick={() => exportController.current?.abort()}>
              Cancel export
            </button>
          </div>
        )}
        {error && (
          <p className="swarm-export-error" role="alert">
            {error}
          </p>
        )}
        {downloads.length > 0 && (
          <ul className="swarm-downloads">
            {downloads.map((download) => (
              <li key={download.url}>
                <a href={download.url} download={download.filename}>
                  <ArrowDownToLine size={15} /> Download {download.label}{' '}
                  <span>{(download.bytes / 1024 / 1024).toFixed(1)} MB</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      <footer className="swarm-studio-footer">
        <span>Swarm / motion explorations</span>
        <p>An abstract field. Never a count of agents.</p>
        <Link href="/concepts/swarm">
          Original concept <ArrowUpRight size={13} />
        </Link>
      </footer>
    </main>
  );
}
