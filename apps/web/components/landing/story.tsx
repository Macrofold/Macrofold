'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Diagram } from './diagram';
import { pillars, scenarios } from './content';

export function ProductStory() {
  const [selected, setSelected] = useState(scenarios[0]!);
  const [stage, setStage] = useState(0);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [shortScreen, setShortScreen] = useState(false);
  const [pickerHeight, setPickerHeight] = useState(100);
  const track = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const media = matchMedia('(max-height: 740px) and (max-width: 800px), (max-height: 520px)');
    const update = () => setShortScreen(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const element = track.current;
    const selector = picker.current;
    if (!element || !selector) {
      setVisible(false);
      return;
    }
    setReady(true);
    let frame = 0;
    let intersecting = false;
    const update = () => {
      frame = 0;
      const box = element.getBoundingClientRect();
      const viewport = element.querySelector<HTMLElement>('.mf-story-viewport');
      if (!viewport) return;
      const scene = viewport.getBoundingClientRect();
      // The centered prompt must be visible before its entry timer starts.
      setVisible(
        scene.top + scene.height / 2 < innerHeight - 40 &&
          scene.bottom > parseFloat(getComputedStyle(selector).top) + selector.offsetHeight,
      );
      if (matchMedia('(max-width: 800px)').matches) {
        const travel = Math.max(1, box.height - viewport.offsetHeight);
        const progress = Math.max(
          0,
          Math.min(4.999, ((parseFloat(getComputedStyle(viewport).top) - box.top) / travel) * pillars.length),
        );
        setStage(Math.floor(progress));
        // A compact phone keeps the diagram in view, while copy moves with
        // every scroll update instead of remaining frozen between chapters.
        viewport.style.setProperty('--mf-copy-offset', `${20 - (progress % 1) * 40}px`);
        viewport.style.setProperty(
          '--mf-copy-opacity',
          String(Math.min(1, (progress % 1) / 0.15, (1 - (progress % 1)) / 0.15)),
        );
      } else {
        const center = scene.top + scene.height / 2;
        const chapters = Array.from(element.querySelectorAll<HTMLElement>('.mf-story-chapter'));
        let nearest = 0;
        let distance = Infinity;
        chapters.forEach((chapter, index) => {
          const rect = chapter.getBoundingClientRect();
          const chapterCenter = rect.top + rect.height / 2;
          const next = Math.abs(chapterCenter - center);
          // Measure the untransformed chapter, so its visual entrance cannot
          // feed back into selection or change the page's scroll geometry.
          const position = chapterCenter / innerHeight;
          const entering = Math.max(0, Math.min(1, (0.92 - position) / 0.32));
          const leaving = Math.max(0, Math.min(1, (position - 0.18) / 0.22));
          chapter.style.setProperty('--mf-copy-opacity', String(Math.min(entering, leaving)));
          chapter.style.setProperty('--mf-copy-offset', `${32 * (1 - entering) - 12 * (1 - leaving)}px`);
          if (next < distance) {
            nearest = index;
            distance = next;
          }
        });
        setStage(nearest);
      }
    };
    const onScroll = () => {
      if (intersecting && !frame) frame = requestAnimationFrame(update);
    };
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = Boolean(entry?.isIntersecting);
      if (intersecting) update();
      else setVisible(false);
    });
    observer.observe(element);
    const resize = new ResizeObserver(() => {
      setPickerHeight(selector.offsetHeight);
      onScroll();
    });
    resize.observe(selector);
    resize.observe(element);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      observer.disconnect();
      resize.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [shortScreen]);

  function jumpTo(index: number) {
    const element = track.current;
    const viewport = element?.querySelector<HTMLElement>('.mf-story-viewport');
    if (!element || !viewport) return;
    const top = parseFloat(getComputedStyle(viewport).top);
    const box = element.getBoundingClientRect();
    const chapter = element.querySelectorAll<HTMLElement>('.mf-story-chapter')[index];
    const offset =
      innerWidth <= 800
        ? ((index + 0.5) / pillars.length) * (box.height - viewport.offsetHeight)
        : (chapter?.offsetTop || 0) + (chapter?.offsetHeight || 0) / 2 - viewport.offsetHeight / 2;
    window.scrollTo({
      top: Math.max(
        scrollY +
          box.top -
          (picker.current?.offsetHeight || 100) -
          (picker.current ? parseFloat(getComputedStyle(picker.current).top) : 16),
        scrollY + box.top + offset - top,
      ),
      behavior: 'instant',
    });
  }

  const chapter = selected.chapters[stage]!;
  const pillar = pillars[stage]!;
  return (
    <div
      className="mf-experience"
      data-ready={ready}
      data-visible={visible}
      style={{ '--picker-height': `${pickerHeight}px` } as CSSProperties}
    >
      <div className="mf-case-picker" ref={picker}>
        <span>Example use cases:</span>
        <div role="group" aria-label="Example use cases">
          {scenarios.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              aria-pressed={scenario.id === selected.id}
              onClick={() => setSelected(scenario)}
            >
              {scenario.label}
            </button>
          ))}
        </div>
      </div>
      {shortScreen ? (
        <div className="mf-short-story">
          {pillars.map((item, index) => (
            <article key={`${selected.id}-${item.label}`}>
              <div className="mf-story-copy">
                <p className="mf-eyebrow">{item.label}</p>
                <h3>{selected.chapters[index]![0]}</h3>
                <p>{selected.chapters[index]![1]}</p>
                <Link className="mf-text-link" href={item.href}>
                  {index === 4 ? 'Explore all connectors' : 'Explore this feature'}
                  <ArrowRight size={14} />
                </Link>
              </div>
              <Diagram scenario={selected} stage={index} />
            </article>
          ))}
        </div>
      ) : (
        <div ref={track} className="mf-story-track">
          <div className="mf-story-chapters">
            {pillars.map((item, index) => (
              <article className="mf-story-chapter" key={item.label}>
                <div className="mf-story-copy">
                  <p className="mf-eyebrow">{item.label}</p>
                  <h3>{selected.chapters[index]![0]}</h3>
                  <p>{selected.chapters[index]![1]}</p>
                  <Link className="mf-text-link" href={item.href}>
                    {index === 4 ? 'Explore all connectors' : 'Explore this feature'}
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </article>
            ))}
          </div>
          <div className="mf-story-viewport" data-current-step={stage}>
            <div className="mf-story-nav" role="group" aria-label="Explore the five pillars">
              <span>{pillar.label}</span>
              {pillars.map((item, index) => (
                <button
                  type="button"
                  key={item.label}
                  aria-label={item.label}
                  aria-pressed={index === stage}
                  onClick={() => jumpTo(index)}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                </button>
              ))}
            </div>
            <div className="mf-story-copy mf-mobile-copy" key={`${selected.id}-${stage}`}>
              <p className="mf-eyebrow">{pillar.label}</p>
              <h3>{chapter[0]}</h3>
              <p>{chapter[1]}</p>
              <Link className="mf-text-link" href={pillar.href}>
                {stage === 4 ? 'Explore all connectors' : 'Explore this feature'}
                <ArrowRight size={14} />
              </Link>
            </div>
            <div className="mf-story-art">
              <Diagram key={selected.id} scenario={selected} stage={stage} animated={visible} />
            </div>
          </div>
        </div>
      )}
      <noscript>
        <div className="mf-static-story">
          {scenarios.map((scenario) => (
            <article key={scenario.id}>
              <h3>{scenario.label}</h3>
              <p>{scenario.prompts[0]}</p>
              {scenario.chapters.map(([title, body]) => (
                <section key={title}>
                  <h4>{title}</h4>
                  <p>{body}</p>
                </section>
              ))}
            </article>
          ))}
        </div>
      </noscript>
    </div>
  );
}
