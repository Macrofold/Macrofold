# Database implementation rules

Follow the repository [AGENTS.md](../../AGENTS.md).

Use the restricted runtime role and transaction-local tenant context for domain queries. Keep financial journals immutable and migration roles out of serving processes. Normal tenant transactions take the shared storage maintenance lock; object collection takes it exclusively.

`credentialTransaction` is reserved for OAuth credential refresh, which must commit independently of its caller. It uses a separate bounded pool and no filesystem lock. Never call it while the caller holds a row lock on that connection, and never use it to mutate project files, checkpoints, or storage references. Include all three pool ceilings when calculating per-process database connection budgets.
