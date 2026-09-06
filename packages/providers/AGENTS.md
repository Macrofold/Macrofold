# Provider adapter instructions

Follow the repository [AGENTS.md](../../AGENTS.md).

Keep vendor SDK objects and credentials behind the domain's provider ports. Review the pinned SDK's actual error, pagination and retry behavior before translating it. A lookup failure is not proof that a resource does not exist; preserve execution identity through uncertain outcomes.

Read-only metadata probes belong in explicit scripts with fixed endpoints and bounded responses. They must not inherit credentials, issue paid requests or imply authenticated compatibility. Record untested account, permission, callback and billing behavior in [the pre-deployment checklist](../../docs/21-pre-deployment-checklist.md).
