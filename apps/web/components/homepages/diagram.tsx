'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Code2, Layers, Terminal } from 'lucide-react';
import { stages, type DiagramStyle } from './catalog';

type Point = { x: number; y: number };
const agents = [
  { name: 'Codex', branch: 'feature/api', task: 'Build the endpoint' },
  { name: 'Claude Code', branch: 'feature/ui', task: 'Create the interface' },
  { name: 'OpenCode', branch: 'test/coverage', task: 'Add the tests' },
] as const;
const inputs = [
  { name: 'API', icon: Code2, target: 'Codex and Claude Code', targets: [0, 1] },
  { name: 'CLI', icon: Terminal, target: 'OpenCode', targets: [2] },
  { name: 'Dashboard', icon: Layers, target: 'Claude Code', targets: [1] },
];

/** Each figure owns its observer so looping animations pause while it is offscreen. */
export function FeatureDiagram({ stage, style }: { stage: number; style: DiagramStyle }) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [input, setInput] = useState(0);
  const id = useId().replaceAll(':', '');
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const lanes = style === 'lanes';
  const root: Point = stage === 0 ? { x: 246, y: 165 } : lanes ? { x: 24, y: 210 } : { x: 246, y: 90 };
  const trees: Point[] = lanes
    ? [
        { x: 292, y: 92 },
        { x: 292, y: 242 },
        { x: 292, y: 392 },
      ]
    : [
        { x: 28, y: 275 },
        { x: 264, y: 275 },
        { x: 500, y: 275 },
      ];
  const git = lanes ? { x: 535, y: 247 } : { x: 246, y: 463 };
  const route = inputs[input] ?? inputs[0];
  const step = stages[stage] ?? stages[0];
  const show = (at: number) => ({ opacity: stage >= at ? 1 : 0 });
  function connector(from: Point, to: Point) {
    return lanes
      ? `M ${from.x} ${from.y} C ${from.x + 55} ${from.y}, ${to.x - 55} ${to.y}, ${to.x} ${to.y}`
      : `M ${from.x} ${from.y} C ${from.x} ${from.y + 45}, ${to.x} ${to.y - 45}, ${to.x} ${to.y}`;
  }

  return (
    <figure ref={ref} className={`hp-diagram hp-diagram-${style}`} data-stage={stage} data-visible={visible}>
      <div className="hp-diagram-bar">
        <span>
          <i /> workspace / acme
        </span>
        <span>Illustration</span>
      </div>
      <svg viewBox="0 0 720 575" role="img" aria-label={`${step.label}: ${step.cloud}. ${step.detail}`}>
        <defs>
          <pattern id={`${id}-grid`} width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.8" fill="currentColor" opacity=".15" />
          </pattern>
          <linearGradient id={`${id}-panel`} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#1a242b" />
            <stop offset="1" stopColor="#0b1015" />
          </linearGradient>
        </defs>
        <rect width="720" height="575" fill={`url(#${id}-grid)`} className="hp-diagram-grid" />

        <g className="hp-scene-layer" style={show(1)} aria-hidden={stage < 1}>
          {trees.map((tree, i) => {
            const from = lanes ? { x: root.x + 216, y: root.y + 55 } : { x: root.x + 108, y: root.y + 110 };
            const to = lanes ? { x: tree.x, y: tree.y + 48 } : { x: tree.x + 96, y: tree.y };
            const d = connector(from, to);
            return (
              <g key={i}>
                <path className="hp-wire" d={d} />
                <path className="hp-packet" d={d} style={{ animationDelay: `${i * 0.5}s` }} />
              </g>
            );
          })}
        </g>

        <g className="hp-workspace-shape" style={{ transform: `translate(${root.x}px, ${root.y}px)` }}>
          {style === 'layers' && (
            <>
              <rect x="10" y="-13" width="216" height="110" rx="9" className="hp-layer-back" />
              <rect x="5" y="-6" width="216" height="110" rx="9" className="hp-layer-back" />
            </>
          )}
          <rect width="216" height="110" rx="8" fill={`url(#${id}-panel)`} className="hp-workspace-border" />
          <path d="M18 20h18l7 8h20v21H18z" className="hp-folder-glyph" />
          <text x="77" y="40" className="hp-diagram-title">
            acme /
          </text>
          <text x="20" y="73" className="hp-diagram-detail">
            src/ · AGENTS.md
          </text>
          <text x="20" y="94" className="hp-diagram-detail">
            README.md · notes/
          </text>
        </g>

        <g className="hp-scene-layer" style={show(1)} aria-hidden={stage < 1}>
          {trees.map((tree, i) => {
            const agent = agents[i];
            if (!agent) return null;
            const selected = stage < 4 || route.targets.includes(i);
            return (
              <g
                key={agent.name}
                transform={`translate(${tree.x},${tree.y})`}
                className={`hp-tree ${selected ? 'hp-tree-selected' : ''}`}
              >
                {style === 'layers' && (
                  <rect x="7" y="-7" width="192" height="106" rx="7" className="hp-layer-back" />
                )}
                <rect width="192" height="106" rx="7" fill={`url(#${id}-panel)`} className="hp-tree-border" />
                <text x="16" y="26" className="hp-diagram-branch">
                  {agent.branch}
                </text>
                <circle cx="21" cy="54" r="4" className="hp-agent-light" />
                <text x="35" y="61" className="hp-diagram-agent">
                  {agent.name}
                </text>
                <text x="16" y="88" className="hp-diagram-detail">
                  {agent.task}
                </text>
                <g className="hp-scene-layer" style={show(2)} aria-hidden={stage < 2}>
                  <path d="M18 121H173" className="hp-version-line" />
                  {[24, 87, 151].map((x, j) => (
                    <circle
                      key={x}
                      cx={x}
                      cy="121"
                      r="4"
                      className="hp-commit"
                      style={{ animationDelay: `${j * 0.35}s` }}
                    />
                  ))}
                </g>
              </g>
            );
          })}
        </g>

        <g className="hp-scene-layer hp-git-scene" style={show(2)} aria-hidden={stage < 2}>
          {trees.map((tree, i) => {
            const from = lanes ? { x: tree.x + 192, y: tree.y + 121 } : { x: tree.x + 96, y: tree.y + 125 };
            const to = lanes ? { x: git.x, y: git.y + 32 } : { x: git.x + 108, y: git.y };
            const d = connector(from, to);
            return (
              <g key={i}>
                <path className="hp-wire hp-sync-wire" d={d} />
                <path className="hp-packet hp-sync-packet" d={d} style={{ animationDelay: `${i * 0.7}s` }} />
              </g>
            );
          })}
          <g transform={`translate(${git.x},${git.y})`}>
            <rect width={lanes ? 161 : 216} height="63" rx="7" className="hp-git-box" />
            <text x="18" y="27" className="hp-diagram-title">
              GitHub
            </text>
            <text x="18" y="47" className="hp-diagram-detail">
              optional sync
            </text>
          </g>
        </g>

        <g className="hp-scene-layer" style={show(3)} aria-hidden={stage < 3}>
          {inputs.map((source, i) => (
            <g key={source.name} transform={`translate(${52 + i * 235},16)`}>
              <rect
                width="144"
                height="39"
                rx="5"
                className={input === i ? 'hp-input-active' : 'hp-input-idle'}
              />
              <text x="72" y="26" textAnchor="middle" className="hp-diagram-input">
                {source.name}
              </text>
            </g>
          ))}
        </g>
        <g className="hp-scene-layer" style={show(4)} aria-hidden={stage < 4}>
          {route.targets.map((target) => {
            const tree = trees[target];
            if (!tree) return null;
            const from = { x: 124 + input * 235, y: 55 };
            const to = { x: tree.x + 175, y: tree.y };
            const d = `M ${from.x} ${from.y} C ${from.x + 40} 120, ${to.x} ${to.y - 80}, ${to.x} ${to.y}`;
            return (
              <g key={target}>
                <path className="hp-route-wire" d={d} />
                <path className="hp-packet hp-route-packet" d={d} />
              </g>
            );
          })}
        </g>
        {style === 'terminal' && (
          <text x="24" y="555" className="hp-terminal-caption">
            acme / {step.id} · hosted worktree
          </text>
        )}
      </svg>
      <figcaption>
        {stage >= 3 ? (
          <>
            <div className="hp-input-picker" role="group" aria-label="Explore interface routes">
              {inputs.map(({ name, icon: Icon }, i) => (
                <button key={name} type="button" aria-pressed={input === i} onClick={() => setInput(i)}>
                  <Icon size={14} />
                  {name}
                </button>
              ))}
            </div>
            <p aria-live="polite">
              {stage === 4
                ? `${route.name} → ${route.target} worktrees`
                : 'Choose an interface. The hosted workspace stays the same.'}
            </p>
          </>
        ) : (
          <p>
            {stage === 0
              ? 'Files and instructions, in a working directory.'
              : stage === 1
                ? 'Independent worktrees · one writer in each'
                : 'Checkpoint history belongs to each worktree.'}
          </p>
        )}
      </figcaption>
    </figure>
  );
}
