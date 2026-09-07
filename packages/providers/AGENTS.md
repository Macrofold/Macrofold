# Provider adapter instructions

Follow the repository [AGENTS.md](../../AGENTS.md).

Read [integration boundaries](../../.agents/rules/integrations.md) and [TypeScript rules](../../.agents/rules/typescript.md) before adapter changes.

Keep vendor SDK objects and credentials behind the domain's provider ports. Review the pinned SDK's actual error, pagination and retry behavior before translating it. A lookup failure is not proof that a resource does not exist; preserve execution identity through uncertain outcomes.

Read-only metadata probes belong in explicit scripts with fixed endpoints and bounded responses. They must not inherit credentials, issue paid requests or imply authenticated compatibility. Record untested account, permission, callback and billing behavior in [the pre-deployment checklist](../../docs/operations/pre-deployment.md).

Explicitly authorized authenticated acceptance is a separate opt-in path under `scripts/live/`, documented in [live integration testing](../../docs/engineering/testing/live-integrations.md). Use the user's spending ceiling, synthetic inputs, isolated fixtures and sanitized reports. Install transport guards before constructing SDK clients that capture `fetch`; count metadata and retries as well as execution. Never enable this path in ordinary CI or infer budget authorization from the presence of a key.
