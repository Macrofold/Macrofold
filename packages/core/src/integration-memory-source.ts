import type { Tx } from '../../db';
import { boundedMemoryExcerpt, memoryText } from '../../providers/src/memory-service';
import { assert } from './errors';

type SourceRun = {
  id: string;
  workspace_id: string;
  worktree_id: string;
  session_id: string;
  status: string;
  prompt: string;
  output: string;
  execution_outcome: string | null;
  failure_code: string | null;
  persistence_status: string | null;
  completed_at: Date | null;
  checkpoint_id: string | null;
  checkpoint_role: string | null;
  git_commit: string | null;
  repository: { repository_id?: unknown; target_branch?: unknown; worktree_branch?: unknown } | null;
};
type ToolOutcome = {
  id: string;
  sequence: string;
  tool_call_id: string | null;
  name: string | null;
  is_error: string | null;
  outcome: string | null;
  exit_code: string | null;
  code: string | null;
  occurred_at: Date;
};
const identifier = (value: unknown, limit = 160) =>
  typeof value === 'string' && /^[A-Za-z0-9_.:/-]+$/.test(memoryText(value))
    ? memoryText(value).slice(0, limit)
    : null;
const code = (value: string | null) => (value && /^[a-z][a-z0-9_]{0,95}$/.test(value) ? value : null);
const commit = (value: string | null) => (value && /^[0-9a-f]{40,64}$/i.test(value) ? value : null);

/** Background-only projection of committed authority. SQL never transfers raw
 * tool arguments/results, and current Worktree state cannot rewrite Run history. */
export async function captureMemorySource(tx: Tx, runId: string, engineering: boolean) {
  const run = (
    await tx.query<SourceRun>(
      `SELECT r.id,r.workspace_id,r.worktree_id,r.session_id,r.status,r.completed_at,
    r.config->>'prompt' AS prompt,coalesce(r.result->>'output_text','') AS output,
    r.result->>'execution_outcome' AS execution_outcome,r.result->>'failure_code' AS failure_code,
    r.result->>'persistence_status' AS persistence_status,r.config->'integration_context'->'repository' AS repository,
    c.id AS checkpoint_id,CASE WHEN c.id::text=r.result->>'checkpoint_id' THEN 'run_output' ELSE 'last_verified_baseline' END AS checkpoint_role,
    CASE WHEN c.data->>'git_status'='ready' THEN c.data->>'git_commit' ELSE NULL END AS git_commit
    FROM runs r LEFT JOIN checkpoints c ON c.id=nullif(coalesce(r.result->>'checkpoint_id',r.result->>'last_verified_checkpoint_id'),'')::uuid
      AND c.organization_id=r.organization_id AND c.data->>'worktree_id'=r.worktree_id::text AND c.data->>'verification'='verified'
    WHERE r.id=$1 AND r.kind='native_agent' AND r.status IN ('succeeded','failed','cancelled','timed_out')
      AND ($2 OR r.status='succeeded' AND coalesce(r.result->>'output_text','')<>'')
      AND octet_length(r.config->>'prompt')+octet_length(coalesce(r.result->>'output_text',''))<=262144`,
      [runId, engineering],
    )
  ).rows[0];
  assert(
    run,
    409,
    'memory_source_unavailable_or_large',
    'The committed conversation is unavailable or exceeds the 256 KiB automatic capture bound. Add selected confirmed notes explicitly.',
  );
  let outcomes: ToolOutcome[] = [];
  if (engineering)
    outcomes = (
      await tx.query<ToolOutcome>(
        `WITH outcomes AS (
    SELECT id,sequence,left(data->>'tool_call_id',160) AS tool_call_id,left(data->>'name',160) AS name,
      data->>'is_error' AS is_error,left(data->>'outcome',32) AS outcome,left(data#>>'{result,exit_code}',16) AS exit_code,
      left(data->>'code',96) AS code,occurred_at
    FROM run_events WHERE run_id=$1 AND type='tool.completed' ORDER BY sequence DESC LIMIT 33
    ), names AS (
      SELECT DISTINCT ON (data->>'tool_call_id') left(data->>'tool_call_id',160) AS tool_call_id,left(data->>'name',160) AS name
      FROM run_events WHERE run_id=$1 AND type='tool.started' AND data->>'tool_call_id' IN (SELECT tool_call_id FROM outcomes)
      ORDER BY data->>'tool_call_id',sequence DESC
    ) SELECT o.id,o.sequence,o.tool_call_id,coalesce(o.name,n.name) AS name,o.is_error,o.outcome,o.exit_code,o.code,o.occurred_at
    FROM outcomes o LEFT JOIN names n USING(tool_call_id) ORDER BY o.sequence DESC`,
        [runId],
      )
    ).rows;
  const tools = outcomes
    .slice(0, 32)
    .reverse()
    .map((event) => ({
      source_event_id: event.id,
      sequence: event.sequence,
      tool_call_id: identifier(event.tool_call_id),
      name: identifier(event.name),
      occurred_at: event.occurred_at.toISOString(),
      reported_outcome:
        event.outcome === 'unknown'
          ? 'unknown'
          : event.is_error === 'true' || (event.exit_code && event.exit_code !== '0')
            ? 'reported_error'
            : event.is_error === 'false' || event.exit_code === '0'
              ? 'reported_completion'
              : 'unverified_completion',
      effect_verified: false,
      error_code: code(event.code),
    }));
  const provenance = {
    source_run_id: run.id,
    workspace_id: run.workspace_id,
    worktree_id: run.worktree_id,
    session_id: run.session_id,
    completed_at: run.completed_at?.toISOString() ?? null,
    verified_checkpoint_id: run.checkpoint_id,
    checkpoint_role: run.checkpoint_id ? run.checkpoint_role : null,
    git_commit: commit(run.git_commit),
    repository: run.repository
      ? {
          repository_id: identifier(run.repository.repository_id),
          target_branch: identifier(run.repository.target_branch),
          worktree_branch: identifier(run.repository.worktree_branch),
        }
      : null,
  };
  const base = {
    kind: engineering ? 'engineering-history' : 'successful-conversation',
    source_run_id: run.id,
    provenance,
    ...(engineering
      ? {
          run_outcome: {
            status: run.status,
            execution_outcome: run.execution_outcome,
            partial: run.status !== 'succeeded',
            failure_code: code(run.failure_code),
            persistence_status: run.persistence_status,
          },
          tool_outcomes: tools,
        }
      : {}),
    omissions: {
      tool_outcomes_omitted: outcomes.length > 32,
      user_original_characters: run.prompt.length,
      assistant_original_characters: run.output.length,
      text_projected: false,
    },
  };
  const user = memoryText(run.prompt),
    assistant = memoryText(run.output);
  const text = JSON.stringify({ ...base, user, assistant });
  if (Buffer.byteLength(text) <= 262144) return text;
  for (const limit of [65536, 32768, 16384, 8192]) {
    const projected = JSON.stringify({
      ...base,
      user: boundedMemoryExcerpt(user, limit),
      assistant: boundedMemoryExcerpt(assistant, limit),
      omissions: { ...base.omissions, text_projected: true },
    });
    if (Buffer.byteLength(projected) <= 262144) return projected;
  }
  throw new Error('memory_source_projection_unavailable');
}
