# Worker implementation and verification

This is the implementation record for the [Worker architecture](../../../architecture/worker-execution.md). It is not a shipped-feature claim. Update this record with actual code/tests in the same branch. Release/provider activation belongs in [maintainer TODO](../../../maintainers/TODO.md).

## Current work

- [x] Replace the fixed-one-Host/short-lived Worker design with stable autoscaling targets, explicit economics, tenancy and sibling isolation, graceful desired-state lifecycle, cost ceilings, and predictable pooled resource rates.
- [ ] Implement and test typed Worker input, exact rate arithmetic, and reactive allocation decisions.
- [ ] Add tenant-owned Worker/Host/HostRun data and independent use/read/manage authorization.
- [ ] Integrate new routes, current schemas, SDK generation, CLI/MCP and dashboard controls.
- [ ] Replace worktree-bound sandbox scheduling/provider control end to end.
- [ ] Implement scoped native containment and live harness handles; prove cancel/capture A leaves B running.
- [ ] Fix hidden continuation persistence with cold-restore regression tests and no secret persistence.
- [ ] Implement rate-fenced dedicated/server provisioning and bounded autoscaling; separately qualify pooled meters and tenant boundaries.
- [ ] Remove obsolete sandbox tests/docs after replacement behavior passes, not before.
- [ ] Run formatting, typecheck, docs/SDK generation and drift checks, unit/domain/native/load/client acceptance.

## Decisions requiring deployment input

- Production resource rate cards, supported server sizes/regions, and chosen default spending ceiling are operator/product inputs. Do not invent retail prices or enable paid pooled compute from examples.
- Shared cross-customer hosting and per-Run strong isolation remain unavailable until the concrete provider/container boundary and resource meters pass acceptance. Do not silently substitute trusted sharing.

## Deferred unless measurement justifies them

Traffic forecasting, multi-region optimization, live process migration, retrospective fleet-cost rebates, a generic Kubernetes fleet, shared writable Worktrees, custom privileged runtime images, and new public residency resources.

## Verification

No Worker implementation acceptance has been recorded yet. The existing main branch's native cold-continuation exclusion and dependency-install failure must not be mistaken for passes. Record reproducible commands and limitations here as work lands.
