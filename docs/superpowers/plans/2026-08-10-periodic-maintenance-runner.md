# Periodic Maintenance Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the inert `REL-03` periodic maintenance Kit and preserve the existing outbox runner contract through a first in-repository adoption.

**Architecture:** A framework-free runner owns only process-local sequencing, abortable delay, bounded drain and telemetry events. `OutboxRelayRunner` delegates those mechanics while outbox retry, lease and publication policy remain unchanged.

**Tech Stack:** Node.js 24, TypeScript 7 production compiler, Jest 30 fake timers, NestJS 11 composition retained only by the outbox adapter.

## Global Constraints

- Use Node major 24 and pnpm 11.15.1 through plain `pnpm` commands.
- Add no dependencies, environment variables, Nest module or default runtime composition.
- Keep the Kit framework-free and outside all business modules.
- Preserve `OutboxRelayRunner`, `OUTBOX_RELAY_RUNNER`, constructor defaults `1000/10000` and fail-fast behavior before shutdown.
- Do not add cron, persisted schedules, retries, distributed locks, queues or product policy.
- Do not add or update TSDoc as part of this change.
- Do not change Gift Bot or Amazing EKB repositories.

---

### Task 1: Add the framework-free runner through TDD

**Files:**

- Create: `src/platform/maintenance/periodic-maintenance-runner.ts`
- Create: `test/unit/platform/maintenance/periodic-maintenance-runner.spec.ts`

**Interfaces:**

- Produces: `PeriodicMaintenanceTask`, `PeriodicMaintenanceEvent`, `PeriodicMaintenanceObserver`, `PeriodicMaintenanceOptions` and `PeriodicMaintenanceRunner` exactly as specified by the design.

- [ ] Write focused failing tests for option validation and single-use admission.
- [ ] Run the new suite and confirm it fails because the module is absent.
- [ ] Implement only validation, defaults and the single-use guard; rerun to green.
- [ ] Add failing tests for immediate/delayed start and fixed-delay non-overlap; implement and rerun to green.
- [ ] Add failing tests for abort before start, abortable idle wait and active-cycle drain; implement and rerun to green.
- [ ] Add failing tests for fail-fast error identity, grace expiry and safe late rejection; implement and rerun to green.
- [ ] Add failing tests for typed observer ordering, duration and observer isolation; implement and rerun to green.
- [ ] Run `pnpm run test:unit:run --runTestsByPath test/unit/platform/maintenance/periodic-maintenance-runner.spec.ts`.

### Task 2: Adopt the runner in outbox without changing its contract

**Files:**

- Modify: `src/platform/outbox/outbox-relay-runner.ts`
- Modify: `test/unit/platform/outbox/outbox-relay-runner.spec.ts`
- Verify: `test/integration/platform/outbox/outbox-relay-runtime.module.integration.spec.ts`

**Interfaces:**

- Consumes: `PeriodicMaintenanceRunner` from Task 1.
- Preserves: `OutboxRelayRunnerPort.run(signal)`, `OutboxRelayRunner` and its current constructor signature/defaults.

- [ ] Add a failing outbox regression proving synchronous relay throws preserve fail-fast error identity.
- [ ] Replace the outbox-specific loop with delegation to `PeriodicMaintenanceRunner`.
- [ ] Run the maintenance and outbox unit suites together.
- [ ] Run the focused outbox runtime-module integration suite.
- [ ] Commit code and tests as `feat(platform): add periodic maintenance runner`.

### Task 3: Publish adoption and recovery documentation

**Files:**

- Create: `docs/architecture/periodic-maintenance.md`
- Modify: `README.md`, `docs/architecture/foundation-scope.md`, `docs/architecture/transactional-outbox-adoption.md`, `docs/runbooks/transactional-outbox.md`, `docs/capability-catalog.md`, `docs/roadmap.md`

**Interfaces:**

- Documents: selection, adoption, shutdown, recovery, multi-replica and removal boundaries for the Task 1 API.

- [ ] Add the architecture/adoption document with one product-owned task example.
- [ ] Link the document from README and foundation scope.
- [ ] Update outbox adoption and shutdown guidance to name the shared runner without changing outbox policy.
- [ ] Change `REL-03` to `Available` and record the in-repository outbox adopter.
- [ ] Record the optional Kit in the roadmap without claiming merge, hosted or CI evidence.
- [ ] Commit documentation as `docs(platform): document periodic maintenance adoption`.

### Task 4: Verify, review and publish the branch

**Files:**

- Verify all files changed from the exact `origin/stage` base to feature HEAD.

- [ ] Run focused unit and integration tests, `git diff --check`, `pnpm check:quick`, `pnpm check` and `pnpm oci:check` on a clean committed HEAD.
- [ ] Dispatch one read-only `gpt-5.6-sol` reviewer with `ultra` reasoning and no inherited conversation history.
- [ ] If required, apply one consolidated fix wave, rerun all gates and re-review; allow no more than three reviewer turns total.
- [ ] Require reviewer verdict `PASS`; otherwise stop before push and PR.
- [ ] Push `feat/periodic-maintenance-runner`, open one PR into `stage`, wait for hosted checks and address actionable review threads without merging.
