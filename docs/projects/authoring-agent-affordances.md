# Application authoring agent affordances

Implementation in progress for the approved OpenLegend context integration (WW21). Keep its original checkout and running runtime unchanged. This isolated branch starts from refreshed main `8c6797decca2e9b71ab376594b59e35a2e67a55f`.

## Plan and boundaries

1. Reuse the separately implemented permission-derived filesystem work; do not copy its uncommitted changes into this branch.
2. Replace opaque connector aliases with bounded readable names and a digest of the complete connection/tool identity. Discovery and dispatch share one owner. Reject ambiguous catalogs and rotate the warm compatibility key so a cached old tool interface is not reused.
3. Resolve the native question-selection contract before changing it. Existing permission patterns are documented for connector IDs/tool names; silently extending them to native questions would change their meaning. The owner approved an optional explicit question permission with unchanged defaults. Add `permissions.questions: allow | deny`; any layer denying questions wins. Implement OpenCode native schema removal first, rejecting deny for other harnesses before reservation until their mappings are verified. This is independent of connector tool patterns.
4. Verify alias normalization, truncation, connection/name separation, actual MCP discovery/invocation and revoked-grant denial using existing isolated fixtures. Review the complete diff, run affected static/docs checks, and publish a separate PR without merging.

Expected alias scope: approximately 40 changed logic lines plus focused tests/docs, across broker discovery/dispatch and warm placement identity. Risk is incorrect connector selection or stale cached names. Alias text never grants authority; current connection access and invocation accounting remain authoritative. Activate only after existing runs drain, with matching control-plane code. Existing historical events retain their original names.

Completion requires the above evidence and an explicit accounting of any unimplemented question-permission or live rollout gap. This branch does not claim the caller's full invention journey or deployed runtime acceptance.

## Maintained records

- [Tool security](../features/identity-integrations/tools-security.md)
- [Native harness tool permissions](../maintainers/TODO.md#native-harness-tool-permissions)

## Verification

Three naming cases and 21 broker integration cases pass. The existing fixture wrapper created and removed its own database on a separate loopback PostgreSQL 14 cluster, used restricted runtime authorization, and disabled paid execution; mocked remote transports prove protocol behavior, not a live provider. Full production PostgreSQL 17 and warm/native live activation remain unverified. The original Macrofold source checkout and runtime configuration were not modified. TypeScript and documentation checks pass after resolving isolated-checkout dependency links and restoring small tracked documentation targets. The caller verification separately recovered Docker after disk exhaustion; no agent request was automatically replayed.

CI follow-up: all 148 domain/contract files passed, as did SDK, policy-mutation and native image gates. Browser acceptance exposed an unchanged clipboard-fixture clock race: the host timestamp could precede the browser clock after installation. The fixture now installs a fixed time and pauses at a later fixed time before the first copy. Its existing exact three-second/reset assertions remain unchanged. A no-network headless clock check with delayed setup passed at the 2,000/2,999/3,000 ms boundaries; full browser acceptance remains a CI gate. Staging deployment was blocked separately.

## Approved question-control implementation

Estimated 60–100 changed logic lines plus generated contracts and focused tests. Owners: OpenAPI/public validators, permission translation at admission, native OpenCode configuration, and existing frozen-session/warm compatibility. Risk: silently ignored denial, stale native configuration, or changing default interactive behavior. Update generated clients from OpenAPI; verify HTTP admission/inheritance/session rejection, native model-visible tool omission, default question availability, and warm continuation with network-disabled fixtures. Run SDK verification and affected type/documentation checks; preserve current file/connector restrictions. The OpenLegend caller opts in only after the deployed control plane and runtime support the field. No new native permission framework or reinterpretation of connector patterns.

Question-control evidence: 18 unit/startup cases, eight disposable-PostgreSQL API cases and TypeScript pass. Actual network-disabled OpenCode verifies default interactive answers, denied question schema omission with checked files, restored continuation, simultaneous Run/cancel isolation, warm reuse and replacement-host restore. All generated clients were regenerated from OpenAPI. SDK verification initially lacked PATH toolchains; the installed dedicated toolchains were found, then a Rust debug build exhausted available disk. Only that task-owned build output was removed; all five SDK journeys/transport suites now pass without debug symbols/incremental cache, including 201 Python checks and type checking. No assertion or production behavior was weakened. Live activation remains separate. Review also gates the OpenCode native question feature at worker startup, so project configuration cannot reintroduce a denied question tool.
