'use client';
import { useId, useState, type ReactNode } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { Copy, Pause, Play, ScanLine, ArrowRight, Terminal, Folder, GitBranch, Check } from 'lucide-react';
import { copyText } from '../../lib/clipboard';

export function AnimationStudy({
  name,
  description,
  technique,
  children,
}: {
  name: string;
  description: string;
  technique: string;
  children: ReactNode;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [pinned, setPinned] = useState(false);
  return (
    <figure
      className="concept-study"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setVisible(true);
      }}
      onPointerLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setVisible(false);
          setPinned(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setVisible(false);
          setPinned(false);
        }
      }}
    >
      {children}
      <figcaption>
        <button
          className="concept-study-trigger"
          type="button"
          aria-expanded={visible || pinned}
          aria-controls={id}
          aria-label={`${name} animation concept`}
          onClick={() => {
            setPinned(!pinned);
            setVisible(false);
          }}
        >
          <ScanLine size={14} /> Animation concept <span aria-hidden="true">↗</span>
        </button>
        <div id={id} className="concept-study-note" hidden={!visible && !pinned}>
          <span>PROPOSED MOTION · STATIC CONCEPT FRAME</span>
          <p>{description}</p>
          <small>{technique}</small>
        </div>
        <noscript>
          <p className="concept-study-fallback">Proposed animation: {description}</p>
        </noscript>
      </figcaption>
    </figure>
  );
}

const flowStages = [
  {
    title: 'Request',
    icon: Terminal,
    label: 'Your app, CLI, or dashboard',
    detail: 'Choose a workspace and a native harness. Submit a task with execution and spending limits.',
    rows: ['POST /v1/runs', 'harness: codex', 'workspace: your-project'],
  },
  {
    title: 'Execute',
    icon: ArrowRight,
    label: 'Native agent · cloud sandbox',
    detail:
      'When capacity is available, the agent works in its sandbox. Stream output and tool activity as it happens.',
    rows: ['Claude Code / Codex / OpenCode', 'Files + permitted tools', 'Stream output and events'],
  },
  {
    title: 'Keep',
    icon: Folder,
    label: 'Persistent project files',
    detail:
      'After execution, inspect the checkpoint outcome. Saved files and retained run history are ready for the next task.',
    rows: ['Source, notes, artifacts', 'Verified checkpoints', 'Retained output and tool history'],
  },
  {
    title: 'Continue',
    icon: GitBranch,
    label: 'Version, inspect, work again',
    detail:
      'Review changes, synchronize an optional GitHub repository, or start independent work in a worktree. Git conflicts stay visible.',
    rows: ['Review changes', 'Optional GitHub synchronization', 'Continue from the saved project'],
  },
] as const;

/** A user-controlled explanation, not a simulated live dashboard or provider call. */
export function ProductFlow() {
  return (
    <Tabs.Root defaultValue="Request" className="concept-flow">
      <div className="concept-flow-heading">
        <span>ONE PROJECT. EVERY INTERFACE.</span>
        <span>INTERACTIVE WALKTHROUGH</span>
      </div>
      <Tabs.List aria-label="Product workflow">
        {flowStages.map(({ title, icon: Icon }, i) => (
          <Tabs.Trigger key={title} value={title}>
            <span>0{i + 1}</span>
            <Icon size={19} />
            {title}
            <ArrowRight size={14} />
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {flowStages.map(({ title, label, detail, rows }) => (
        <Tabs.Content value={title} key={title}>
          <div>
            <p className="concept-kicker">{label}</p>
            <h3>{title === 'Keep' ? 'The run ends. The work stays.' : label}</h3>
            <p>{detail}</p>
          </div>
          <div className="concept-flow-schematic">
            {rows.map((row) => (
              <div key={row}>
                <Check size={14} />
                <span>{row}</span>
              </div>
            ))}
            <div className="concept-flow-trace" aria-hidden="true">
              <i />
            </div>
          </div>
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

export function MotionSurface({ className, children }: { className: string; children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  return (
    <div className={className} data-motion={paused ? 'paused' : 'playing'}>
      {children}
      <button
        className="concept-motion"
        type="button"
        aria-pressed={paused}
        onClick={() => setPaused(!paused)}
      >
        {paused ? <Play size={13} /> : <Pause size={13} />}
        {paused ? 'Play motion' : 'Pause motion'}
      </button>
    </div>
  );
}
const examples = {
  TypeScript: `import { Client } from 'macrofold';

const { AGENT_HOST, AGENT_API_KEY, WORKSPACE_ID, AGENT_MODEL } = process.env;
if (!AGENT_HOST || !AGENT_API_KEY || !WORKSPACE_ID || !AGENT_MODEL) {
  throw new Error('Set host, API key, workspace, and model first.');
}
const agent = new Client({ baseURL: AGENT_HOST, token: AGENT_API_KEY });

const run = await agent.request('createRun', {
  body: {
    workspace_id: WORKSPACE_ID,
    harness: 'codex', model: AGENT_MODEL,
    billing_mode: 'managed',
    prompt: 'Read the project and save a progress note.',
    limits: { timeout_seconds: 300, max_cost_micro_usd: '1000000' },
  },
});
for await (const event of agent.stream(run.run_id)) {
  console.log(event);
}`,
  Python: `import os
from macrofold import Client

agent = Client(os.environ['AGENT_HOST'], os.environ['AGENT_API_KEY'])
run = agent.request('createRun', body={
    'workspace_id': os.environ['WORKSPACE_ID'],
    'harness': 'codex',
    'model': os.environ['AGENT_MODEL'],
    'billing_mode': 'managed',
    'prompt': 'Read the project and save a progress note.',
    'limits': {'timeout_seconds': 300,
               'max_cost_micro_usd': '1000000'},
})
for event in agent.stream(run['run_id']):
    print(event)
agent.close()`,
  cURL: `# Keep this key to recover a lost response.
REQUEST_KEY="$(uuidgen)"
jq -n --arg ws "$WORKSPACE_ID" --arg model "$AGENT_MODEL" \\
  '{workspace_id:$ws, harness:"codex", model:$model,
    billing_mode:"managed",
    prompt:"Read the project and save a progress note.",
    limits:{timeout_seconds:300, max_cost_micro_usd:"1000000"}}' | \\
  curl --fail-with-body "$AGENT_HOST/v1/runs" \\
    -H "Authorization: Bearer $AGENT_API_KEY" \\
    -H "Idempotency-Key: $REQUEST_KEY" \\
    -H 'Content-Type: application/json' --data-binary @-`,
  CLI: `# From a source checkout, using the local simulator.
pnpm cli login --host http://localhost:3210
pnpm cli project list
pnpm cli link PROJECT_ID

pnpm cli run "Read the project and save a progress note." \\
  --harness codex --model fixture-model \\
  --timeout 300 --max-cost 1

pnpm cli files list`,
};
export function CodeExample() {
  const [language, setLanguage] = useState<keyof typeof examples>('TypeScript');
  return (
    <Tabs.Root
      className="concept-code"
      value={language}
      onValueChange={(value) => {
        const match = (Object.keys(examples) as (keyof typeof examples)[]).find((key) => key === value);
        if (match) setLanguage(match);
      }}
    >
      <div className="concept-code-toolbar">
        <Tabs.List aria-label="Example language">
          {Object.keys(examples).map((key) => (
            <Tabs.Trigger key={key} value={key}>
              {key}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <button
          type="button"
          aria-label="Copy code example"
          onClick={() => void copyText(examples[language], 'Example copied')}
        >
          <Copy size={15} />
        </button>
      </div>
      {(Object.keys(examples) as (keyof typeof examples)[]).map((key) => (
        <Tabs.Content key={key} value={key}>
          <pre tabIndex={0} aria-label={`${key} code example`}>
            <code>{examples[key]}</code>
          </pre>
        </Tabs.Content>
      ))}
      <div className="concept-code-footer">
        <span className="concept-live-dot" /> YOUR CODE → NATIVE AGENT → SAVED WORK
      </div>
    </Tabs.Root>
  );
}
