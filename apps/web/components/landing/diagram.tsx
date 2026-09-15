import { Check, Folder, Monitor, Terminal, Braces } from 'lucide-react';
import type { CSSProperties } from 'react';
import { connectorLabels, type Scenario } from './content';
import './diagram.css';

const agents = [
  { name: 'Codex', mark: 'codex' },
  { name: 'Claude Code', mark: 'claude' },
  { name: 'OpenCode', mark: 'opencode' },
  { name: 'Codex', mark: 'codex' },
] as const;

function TypedPrompt({ text }: { text: string }) {
  // Full text reserves its final wrapping. CSS reveals letters without a React
  // render per keystroke; the diagram has one accessible summary.
  return (
    <span className="mf-typed-prompt">
      {Array.from(text).map((letter, index) => (
        <span className="mf-letter" key={index} style={{ '--letter': index } as CSSProperties}>
          {letter}
        </span>
      ))}
    </span>
  );
}

export function Diagram({
  scenario,
  stage,
  animated = false,
}: {
  scenario: Scenario;
  stage: number;
  animated?: boolean;
}) {
  return (
    <div
      className="mf-diagram"
      data-stage={stage}
      data-animated={animated}
      data-case={scenario.id}
      role="img"
      aria-label={`${scenario.label}: ${stage === 0 ? 'a prompt enters a Codex workspace with five context files' : stage === 1 ? 'three agents work in parallel worktrees' : stage === 2 ? 'saved agent worktrees connect to the same project and Git main branch' : stage === 3 ? 'API, CLI, and UI requests reach separate agent worktrees' : 'one agent surrounded by ten available tool integrations'}`}
    >
      <div className="mf-project-canvas" aria-hidden="true">
        <span>Project context</span>
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="mf-flow" aria-hidden="true">
        <svg className="mf-sync-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path
            className="mf-sync-path"
            pathLength={1}
            d="M 89 16.667 H 93 V 50 H 98 M 89 50 H 98 M 89 83.333 H 93 V 50"
          />
          <path className="mf-sync-flow" d="M 89 16.667 H 93 V 50 H 98 M 89 50 H 98 M 89 83.333 H 93 V 50" />
        </svg>
        <div className="mf-main">
          <Folder size={26} />
          <img src="/brands/git.svg" width={19} height={19} alt="" />
          <span>main</span>
        </div>
        <div className="mf-orbit">
          {scenario.connectors.map((brand, index) => (
            <div
              className="mf-orbit-position"
              key={brand}
              style={{ '--angle': `${(index * 360) / scenario.connectors.length}deg` } as CSSProperties}
            >
              <div className="mf-orbit-upright">
                <img
                  src={`/brands/color/${brand}.svg`}
                  alt={connectorLabels[brand] || brand}
                  width={26}
                  height={26}
                  title={connectorLabels[brand]}
                />
              </div>
            </div>
          ))}
        </div>
        {agents.map((agent, index) => (
          <div className="mf-unit" key={index} data-agent={index} style={{ '--row': index } as CSSProperties}>
            <div className="mf-agent-prompt">
              <div className="mf-interface">
                {index < 2 ? (
                  <Braces size={12} />
                ) : index === 2 ? (
                  <Terminal size={12} />
                ) : (
                  <Monitor size={12} />
                )}
                <span>{index < 2 ? 'API' : index === 2 ? 'CLI' : 'UI'}</span>
              </div>
              <TypedPrompt text={scenario.prompts[index]} />
            </div>
            <div className="mf-prompt-feed">
              <i />
            </div>
            <div className="mf-agent-shell">
              <div className="mf-agent-heading">
                <strong>{agent.name}</strong>
                <span className="mf-agent-status" />
              </div>
              <div className="mf-agent-body">
                <img
                  className="mf-harness-mark"
                  src={`/brands/${agent.mark}.svg`}
                  width={29}
                  height={29}
                  alt=""
                />
                <svg className="mf-file-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <path
                    pathLength={1}
                    d="M 17 50 H 30 M 37 10 H 30 V 90 H 37 M 30 30 H 37 M 30 50 H 37 M 30 70 H 37"
                  />
                </svg>
                <div className="mf-files">
                  {scenario.files.map((file) => (
                    <span key={file}>
                      <Folder size={12} />
                      <span className="mf-file-name" style={{ '--letters': file.length } as CSSProperties}>
                        {file}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="mf-checkpoint">
              <Check size={12} />
              <img src="/brands/git.svg" width={15} height={15} alt="" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
