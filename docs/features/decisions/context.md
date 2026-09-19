# Context and reusable definitions

[Explicit-context decisions](README.md) include only the evidence supplied or explicitly granted by your backend. Workspace files, actor memories and native conversation state are never included implicitly.

## Evidence semantics

Every envelope records schema/template revisions, asserted audience, observation time, optional expiry, consistency/completeness, and opaque dependency tokens. Each item identifies its source and revision, evidence kind (`observation`, `inference`, `correction`, or `instruction`), and status. Unknown, conflicting, not-applicable and omitted values remain distinct; a known value requires an explicit `value`. Missing an item never establishes absence or zero.

`required_records` requires presence, including an explicitly unknown record. `required_known` requires known evidence. `require_complete` rejects truncated/incomplete envelopes; `require_snapshot` rejects a read interval. For interval reads, supply `read_completed_at`; do not invent a common revision. Macrofold checks these structural assertions, not the truth or completeness of the application's perception.

Use fine-grained entity tokens and query/collection tokens when membership matters. Preserve them with any application-side committed result and compare them immediately before applying effects. A single world-wide revision needlessly invalidates unrelated decisions; entity revisions alone cannot prove no new matching entity appeared. Application time is opaque data; real worker deadlines use wall time.

## Immutable snapshots

Publish an envelope once, then reference its exact revision and audience:

```ts
const snapshot = await client.inferences.createContextArtifact({
  workspace_id: workspaceId,
  name: 'Case evidence, revision 7',
  context,
});
const reference = {
  artifact_id: snapshot.id,
  revision: snapshot.revision,
  audience: snapshot.audience,
};
const accepted = await client.inferences.create({
  workspace_id: workspaceId,
  definition,
  input,
  context: reference,
  model_binding,
});
```

References require `files:read`; publishing requires `files:write`. Content is encrypted in existing object storage and verified against its digest on read. Reference authorization runs at submission, commit and dispatch. Same-workspace audience substitution is denied. Identical actor IDs in different workspace namespaces do not share evidence. A narrower audience needs a new snapshot, not a relabelled history.

After an admitted artifact is released or permission is revoked, new disclosure stops. Revocation cannot make previously sent text unread. The typed context-reader port currently implements stored snapshots only: no arbitrary callback URLs, SQL, paths, remote registry, or automatic retrieval service.

## Named definition revisions

```ts
const published = await client.inferences.createDecisionDefinition({
  workspace_id: workspaceId,
  name: 'Exception triage',
  definition,
});
const accepted = await client.inferences.create({
  workspace_id: workspaceId,
  definition: { definition_id: published.id, revision: definition.revision },
  input,
  context,
  model_binding,
});
```

A workspace/name/revision can be published once. A correction is a new revision. The definition pins the prompt, input/output schemas, primitive, allowed models, unknown policy, completeness requirements, ceilings, and optional bounded-tool policy. Requests may select permitted bindings and narrow ceilings; they cannot expand authority. Export the returned definition as ordinary JSON. There are no mutable aliases or visual workflow definitions in this version.

Withdrawing a definition prevents new reference resolution while retaining its immutable record and the snapshots already admitted by runs. It does not cancel an existing run; use cancellation for that purpose.

## Retention and deletion

| Record                                              | Owner and lifetime                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Run input, provider request/response, tool receipts | Run diagnostics; expire under account history retention                                       |
| Published definition                                | Workspace; withdrawal hides future resolution, workspace purge removes content                    |
| Published context or proposal                       | Independent workspace artifact; source run is provenance only                                   |
| Active task evidence                                | Explicit pins through its configured evidence horizon; release at cycle completion or closure |
| Application outcome                                 | Separate task receipt; does not rewrite provider evidence                                     |

`artifacts.delete(artifactId)` releases independently published artifacts. `inferences.deleteContextArtifact` is the context-specific equivalent. A live task pin produces `evidence_in_use`; complete or close the task first. Physical collection follows the existing asynchronous object-storage grace policy. Deleting a diagnostic is governed by run retention, not this release operation.

Workspace purge removes published content as well as diagnostics and task evidence, preserving financial identifiers. Revoking access, expiring diagnostics, withdrawing a definition and deleting its workspace are distinct actions.

Your application must retain the minimal accepted decision/effect and required evidence under its own authorized policy if future replay needs them. An expiring diagnostic URL is not a durable application database. Retaining a decision does not authorize retaining every source conversation or restoring intentionally forgotten information.

## Bring a decision-provider key

An authorized setup credential with `connections:write` can save an exact model account. An existing healthy OpenRouter model connection can be reused for Jev; otherwise create one:

```ts
const connection = await client.connections.create({
  name: 'OpenRouter decisions', kind: 'model', provider: 'openrouter',
  auth_method: 'api_key', secret: process.env.OPENROUTER_API_KEY!,
});
const model_binding = {
  provider: 'openrouter' as const, model: 'typesafe/jev-1.13',
  billing_mode: 'byok' as const, provider_connection_id: connection.id,
};
```

Include the same provider/model in the definition's `allowed_models`, then pass `model_binding` to `inferences.create`. Direct TypeSafe uses `provider: 'typesafe'`, `model: 'jev-1.13.0'` and a TypeSafe key; the conventional adapter uses `anthropic`. These credentials are never interchangeable.

Save secrets only from a trusted backend or secure setup environment. A saved key is not proof of provider entitlement; the first explicitly authorized execution validates it. The invoking application's credential must belong to the connection owner. Jev remains decision-only and does not become a native harness model.
