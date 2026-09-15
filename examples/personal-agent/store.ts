import { createHash, randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

export const agentRecord = z.object({
  id: z.uuid(),
  customerId: z.string().min(1),
  name: z.string().min(1).max(80),
  status: z.enum(['setting_up', 'active', 'paused', 'deleted']),
  projectId: z.uuid().optional(),
  workspaceId: z.uuid().optional(),
  presetId: z.uuid().optional(),
  connectionActionId: z.uuid().optional(),
  scheduleActionId: z.uuid().optional(),
  connectionId: z.uuid().optional(),
  triggerId: z.uuid().optional(),
  conversations: z.array(z.uuid()).default([]),
  runs: z.array(z.uuid()).default([]),
});
export type AgentRecord = z.infer<typeof agentRecord>;
const stepRecord = z.object({
  fingerprint: z.string(),
  request_id: z.uuid(),
  revision: z.string().nullable(),
  result: z.string().nullable(),
  created_at: z.number(),
});

/** Single-process reference store. SQLite writes are atomic; remote calls never hold a transaction.
 * Replace this store + the service's per-agent lock together when moving to multiple app processes. */
export class AgentStore {
  private db: DatabaseSync;
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, record TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS agents_customer ON agents(customer_id);
      CREATE TABLE IF NOT EXISTS steps (agent_id TEXT NOT NULL, name TEXT NOT NULL, fingerprint TEXT NOT NULL,
        request_id TEXT NOT NULL, revision TEXT, result TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY(agent_id,name));`);
  }
  close() {
    this.db.close();
  }
  list(customerId: string) {
    return this.db
      .prepare('SELECT record FROM agents WHERE customer_id=? ORDER BY rowid')
      .all(customerId)
      .map((row) => agentRecord.parse(JSON.parse(z.string().parse(row.record))));
  }
  get(customerId: string, id: string) {
    const row = this.db.prepare('SELECT record FROM agents WHERE id=? AND customer_id=?').get(id, customerId);
    if (!row) throw new AppError(404, 'Agent not found.');
    return agentRecord.parse(JSON.parse(z.string().parse(row.record)));
  }
  create(customerId: string, id: string, name: string) {
    const record = agentRecord.parse({ id, customerId, name, status: 'setting_up' });
    this.db
      .prepare('INSERT OR IGNORE INTO agents(id,customer_id,record) VALUES(?,?,?)')
      .run(id, customerId, JSON.stringify(record));
    const existing = this.get(customerId, id);
    if (existing.name !== name) throw new AppError(409, 'Reuse the original name when retrying setup.');
    return existing;
  }
  save(record: AgentRecord) {
    const parsed = agentRecord.parse(record);
    this.db
      .prepare('UPDATE agents SET record=? WHERE id=? AND customer_id=?')
      .run(JSON.stringify(parsed), parsed.id, parsed.customerId);
  }
  /** Persist only a fingerprint, request identity, conditional revision and small typed result.
   * Credentials are supplied again on retry; never journal API keys or full requests. */
  async step<T>(
    agentId: string,
    name: string,
    input: unknown,
    schema: z.ZodType<T>,
    execute: (options: { idempotencyKey: string; revision: string | null }) => Promise<T>,
    revision?: () => Promise<string>,
  ) {
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    let row = this.db.prepare('SELECT * FROM steps WHERE agent_id=? AND name=?').get(agentId, name);
    if (!row) {
      this.db
        .prepare('INSERT INTO steps(agent_id,name,fingerprint,request_id,revision) VALUES(?,?,?,?,?)')
        .run(agentId, name, fingerprint, randomUUID(), revision ? await revision() : null);
      row = this.db.prepare('SELECT * FROM steps WHERE agent_id=? AND name=?').get(agentId, name);
    }
    const step = stepRecord.parse(row);
    if (step.fingerprint !== fingerprint)
      throw new AppError(
        409,
        'This action has already started. Retry its original values; use a new action ID for a different action.',
      );
    if (step.result !== null) return schema.parse(JSON.parse(step.result));
    // Platform idempotency responses expire after 30 days. Never replay an older ambiguous action.
    if (Date.now() / 1000 - step.created_at > 29 * 86400)
      throw new AppError(
        409,
        'This pending action is too old to retry safely. Reconcile its platform request ID before continuing.',
      );
    const result = schema.parse(await execute({ idempotencyKey: step.request_id, revision: step.revision }));
    this.db
      .prepare('UPDATE steps SET result=? WHERE agent_id=? AND name=?')
      .run(JSON.stringify(result), agentId, name);
    return result;
  }
}
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public correctable = false,
  ) {
    super(message);
  }
}
