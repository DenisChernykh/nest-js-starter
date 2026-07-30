# Later backend-codex adoption of the deployment operator

This document defines a later, separately authorized transfer from
`nest-js-starter` to `backend-codex`. It is documentation only: there is no
execution in this slice. The starter work does not inspect or modify the
`backend-codex` checkout, does not push a branch, and does not call GitHub,
GHCR, Dokploy or a VPS on its behalf.

## Required adoption sequence

1. Inspect the exact target checkout, branch, HEAD, dirty state, worktrees and
   remotes. Record the evidence before changing files.
2. Inventory target workflows, package scripts, OCI build/smoke contracts,
   runtime environment validation, database roles/migrations, Redis ownership,
   telemetry and product modules.
3. Classify every starter CLI, adapter, test and runbook contract:
   - `adopt`: the capability is absent and all invariants should be transferred;
   - `reconcile`: an equivalent target capability exists and must be compared
     invariant-by-invariant;
   - `reject`: the starter contract, identity or assumption is not valid for
     the target.
4. Apply one **atomic identity replacement** across repository/package names,
   GitHub/GHCR coordinates, service and OCI labels, public Problem Details
   namespace, Redis prefixes, PostgreSQL database/role names and telemetry
   service identities. Do not keep starter identity as an alias or fallback.
5. Enforce **product-module preservation**: retain module-local domain,
   application, infrastructure and presentation boundaries. Do not replace
   target features with demo CRUD, generic repository/controller/service
   abstractions or a global Redis service.
6. Regenerate the target-owned example manifest and contract tests, run the
   target repository gates, then obtain fresh target Stage workflow, digest,
   OCI revision and registry evidence. Starter evidence cannot approve the
   target.
7. Stop before push, pull request, merge, GHCR mutation, Dokploy call or VPS
   action unless each has separate explicit authorization.

## Reconciliation checklist

The later change should produce a review table with one row per source
contract:

| Starter contract                | Target state  | Decision                         | Target-owned replacement/evidence  |
| ------------------------------- | ------------- | -------------------------------- | ---------------------------------- |
| Manifest schema and CLI grammar | Inspect first | `adopt` / `reconcile` / `reject` | Target path and test               |
| Stage/GHCR identity             | Inspect first | `adopt` / `reconcile` / `reject` | Target workflow and package        |
| Docker verification/migrator    | Inspect first | `adopt` / `reconcile` / `reject` | Target command contract            |
| Dokploy API contract            | Inspect first | `adopt` / `reconcile` / `reject` | Target application/schema evidence |
| External smoke                  | Inspect first | `adopt` / `reconcile` / `reject` | Target health/auth contract        |
| Atomic evidence publication     | Inspect first | `adopt` / `reconcile` / `reject` | Target evidence schema             |
| Promotion/rollback runbooks     | Inspect first | `adopt` / `reconcile` / `reject` | Target operational owner           |

Do not assume that the starter's Dokploy application ID, public API paths,
database topology, Redis durability or telemetry decision matches
`backend-codex`. Any disagreement is resolved in the target design before
implementation, not through dual-mode compatibility.

## Completion boundary

Repository implementation is complete only after fresh target-local tests and
gates pass. Environment readiness remains separate and requires the target's
own protected live inputs and hosted evidence. A future operator may proceed to
Dokploy or VPS only inside a separately authorized change window.
