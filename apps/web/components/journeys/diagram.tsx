'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Folder, GitBranch } from 'lucide-react';
import { brandNames } from './brands';
import { pillars, type Form, type UseCase } from './catalog';

type Point = readonly [number, number];
const positions: Record<Form, readonly Point[]> = {
  fan: [
    [350, 90],
    [350, 225],
    [350, 360],
    [145, 390],
  ],
  terraces: [
    [240, 95],
    [330, 230],
    [420, 365],
    [140, 380],
  ],
  matrix: [
    [190, 140],
    [465, 140],
    [190, 345],
    [465, 345],
  ],
  lanes: [
    [360, 80],
    [360, 225],
    [360, 370],
    [130, 390],
  ],
  strata: [
    [370, 110],
    [290, 250],
    [210, 390],
    [510, 390],
  ],
  switchboard: [
    [190, 95],
    [470, 240],
    [190, 385],
    [470, 385],
  ],
  aperture: [
    [270, 90],
    [480, 250],
    [270, 395],
    [70, 310],
  ],
  ledger: [
    [320, 100],
    [320, 245],
    [320, 390],
    [90, 390],
  ],
  constellation: [
    [185, 125],
    [450, 210],
    [305, 390],
    [70, 365],
  ],
  assembly: [
    [220, 115],
    [455, 220],
    [220, 365],
    [455, 365],
  ],
};

function FolderGlyph({ x = 0, y = 0, size = 22 }: { x?: number; y?: number; size?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 24})`}>
      <path d="M2 5H10L13 8H22V21H2Z" fill="currentColor" stroke="currentColor" strokeLinejoin="miter" />
    </g>
  );
}

function Unit({
  saved,
  agent,
  prompt,
  input,
}: {
  saved: boolean;
  agent: number;
  prompt?: string;
  input?: string;
}) {
  return (
    <g className="jl-unit">
      {prompt && (
        <text x="0" y="-17" className="jl-prompt-label">
          {prompt}
        </text>
      )}
      <rect width="210" height="100" rx="7" className="jl-unit-surface" />
      <path d="M0 28H210" className="jl-thin-line" />
      <circle cx="12" cy="14" r="2" fill="#aee5e9" />
      <path d="M23 14H70" className="jl-thin-line" />
      <image
        href={`/brands/${['codex', 'claude', 'opencode'][agent % 3]}.svg`}
        x="15"
        y="47"
        width="26"
        height="26"
        className="jl-svg-mark"
      />
      <path
        d="M47 60H65M95 60H115M115 38V82M115 38H128M115 60H128M115 82H128M145 38H164M145 60H164"
        className="jl-trace"
      />
      <FolderGlyph x={65} y={45} size={29} />
      {[0, 1, 2, 3, 4].map((i) => (
        <FolderGlyph key={i} x={129 + (i > 2 ? 35 : 0)} y={33 + (i % 3) * 22} size={15} />
      ))}
      {saved && (
        <g className="jl-saved">
          <path d="M211 60H230" className="jl-trace" />
          <circle cx="245" cy="60" r="12" className="jl-save-circle" />
          <path d="M240 60L244 64L250 56" fill="none" stroke="#b2edf0" strokeWidth="2" />
          <path d="M258 60H278" className="jl-trace" />
          <image href="/brands/git.svg" x="282" y="47" width="25" height="25" className="jl-svg-mark" />
          {[0, 1, 2].map((i) => (
            <rect
              key={i}
              x={220 + i * 25}
              y="90"
              width="13"
              height="4"
              fill="#81bcc9"
              opacity={1 - i * 0.2}
            />
          ))}
        </g>
      )}
      {input && (
        <g className="jl-input-badge">
          <path d="M-47 50H0" className="jl-packet" />
          <rect x="-101" y="33" width="52" height="33" rx="4" fill="#17282f" stroke="#709da8" />
          <text x="-75" y="54" textAnchor="middle" fill="#ddf5f6" fontSize="12">
            {input}
          </text>
        </g>
      )}
    </g>
  );
}

/** An illustrative state machine: no account data, provider calls, or simulated capacity claims. */
export function JourneyDiagram({ stage, form, useCase }: { stage: number; form: Form; useCase: UseCase }) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)));
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const points = positions[form];
  const connectors = stage === 4;
  const multiple = stage > 0 && !connectors;
  return (
    <figure
      ref={ref}
      className={`jl-diagram jl-form-${form}`}
      data-stage={stage}
      data-case={useCase.id}
      data-visible={visible}
      aria-label={`${useCase.label}: ${pillars[stage]?.label}`}
    >
      <div className="jl-figure-top">
        <span>
          <i /> {useCase.short}
        </span>
        <span>0{stage + 1} / 05</span>
      </div>
      <svg
        viewBox="0 0 780 535"
        role="img"
        aria-label={
          multiple
            ? 'Independent agent worktrees linked to one project'
            : connectors
              ? 'An agent with explicitly granted tools around its workspace'
              : 'A prompt entering an agent with its persistent files'
        }
      >
        <g className="jl-field-grid" aria-hidden="true">
          {Array.from({ length: 16 }, (_, i) => (
            <path key={`v${i}`} d={`M${i * 52} 0V535`} />
          ))}
          {Array.from({ length: 11 }, (_, i) => (
            <path key={`h${i}`} d={`M0 ${i * 52}H780`} />
          ))}
        </g>
        {['terraces', 'strata', 'assembly'].includes(form) && (
          <g className="jl-planes">
            {points.slice(0, 3).map(([x, y], i) => (
              <path key={i} d={`M${x - 80} ${y - 40}H${x + 235}L${x + 285} ${y + 105}H${x - 30}Z`} />
            ))}
          </g>
        )}
        {form === 'aperture' && (
          <g className="jl-frames">
            {[0, 1, 2].map((i) => (
              <rect key={i} x={55 + i * 27} y={45 + i * 22} width={670 - i * 54} height={440 - i * 44} />
            ))}
          </g>
        )}
        {['lanes', 'ledger'].includes(form) && (
          <g className="jl-lanes">
            {points.slice(0, 3).map(([_, y], i) => (
              <g key={i}>
                <rect x="85" y={y - 43} width="620" height="120" rx="4" />
                <text x="101" y={y - 14}>
                  0{i + 1}
                </text>
              </g>
            ))}
          </g>
        )}
        {multiple && (
          <g className="jl-root">
            <FolderGlyph x={50} y={230} size={28} />
            <path d="M79 250H108" className="jl-trace" />
          </g>
        )}
        {connectors && (
          <g className="jl-connector-field">
            {useCase.brands.map((brand, index) => {
              const angle = (index * Math.PI) / 3;
              const x = 390 + Math.cos(angle) * 225,
                y = 265 + Math.sin(angle) * 155;
              return (
                <g key={brand} className="jl-connector-node">
                  <path d={`M390 265H${x}V${y}`} className="jl-wire" />
                  <g transform={`translate(${x} ${y})`}>
                    <g className="jl-mark-counter">
                      <title>{brandNames[brand]}</title>
                      <rect x="-26" y="-26" width="52" height="52" rx="10" fill="#12252d" stroke="#6a929e" />
                      <image
                        href={`/brands/${brand}.svg`}
                        x="-13"
                        y="-13"
                        width="26"
                        height="26"
                        className="jl-svg-mark"
                      />
                    </g>
                  </g>
                </g>
              );
            })}
          </g>
        )}
        {points.map(([x, y], index) => {
          const shown = multiple ? index < (stage >= 3 ? 4 : 3) : index === 0;
          return (
            <g key={index}>
              {multiple && shown && (
                <path d={`M108 250H${Math.max(115, x - 36)}V${y + 40}H${x}`} className="jl-wire" />
              )}
              <g
                className="jl-position"
                style={{
                  opacity: shown ? 1 : 0,
                  transform: multiple
                    ? `translate(${x}px, ${y}px) scale(.72)`
                    : `translate(${connectors ? 262 : 224}px, 203px) scale(${connectors ? 1.2 : 1.55})`,
                }}
              >
                <Unit
                  agent={index}
                  saved={multiple && shown && stage >= 2}
                  prompt={multiple && shown ? useCase.tasks[index] : undefined}
                  input={multiple && shown && stage >= 3 ? ['API', 'API', 'CLI', 'UI'][index] : undefined}
                />
              </g>
            </g>
          );
        })}
        {stage === 0 && (
          <g>
            <path d="M120 281H224" className="jl-packet" />
            <rect x="48" y="264" width="72" height="34" rx="4" fill="#18303a" stroke="#658c95" />
            <text x="84" y="286" textAnchor="middle" className="jl-prompt-label">
              prompt
            </text>
          </g>
        )}
      </svg>
      <figcaption>
        {stage === 0 ? (
          <>
            <Folder size={14} /> {useCase.files.slice(0, 3).join(' · ')}
          </>
        ) : stage === 1 ? (
          <>
            <GitBranch size={14} /> Separate files. Independent work.
          </>
        ) : stage === 2 ? (
          <>
            <Check size={14} /> Checkpoint saved <span>·</span>
            <img src="/brands/git.svg" width={14} height={14} alt="" /> Git sync
          </>
        ) : stage === 3 ? (
          <>
            API + API + CLI + UI <span>→</span> the same project
          </>
        ) : (
          <>Explicit connections. Task-scoped access.</>
        )}
      </figcaption>
    </figure>
  );
}
