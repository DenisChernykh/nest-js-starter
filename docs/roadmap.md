# Production starter roadmap

This document is the single current roadmap for `nest-js-starter`. It replaces
the earlier cross-repository master plan that was drafted alongside the Amazing
EKB backend. The product repository remains a source of proven patterns, but it
is not a second source of truth for the starter.

The roadmap is deliberately smaller than the original ten-slice plan. The
foundation must stay useful without requiring a generator, a starter manifest,
a recipe engine, speculative Redis capabilities, custom runtime metrics or OCI
evidence machinery.

## Status snapshot

As of 2026-07-26, the universal production foundation is implemented on
`stage`.

- PR [#13](https://github.com/DenisChernykh/nest-js-starter/pull/13)
  simplified the runtime, tooling, test and OCI boundaries while preserving the
  auth/RBAC and OpenAPI contracts.
- PR [#14](https://github.com/DenisChernykh/nest-js-starter/pull/14)
  made the publisher pull the immutable digest before the smoke test.
- The
  [Stage image run for `913fef3`](https://github.com/DenisChernykh/nest-js-starter/actions/runs/30192505866)
  completed successfully.
- The recorded `stage` quick gate had 60 unit suites and 302 tests. Integration
  and e2e suites remain in `pnpm check`; Docker verification remains in
  `pnpm oci:check` and stage publication.

This snapshot is evidence for the stated revision, not a permanent substitute
for checking the current branch and workflow runs.

## Maintained vertical reference

As of 2026-07-29, the `approval-requests` slice is implemented and
production-wired on its feature branch as the first maintained vertical
reference. It covers authenticated creation, author-or-reviewer visibility and
an authorized non-author approve/reject decision. Prisma persists the aggregate
and enforces the terminal transition with a pending-only compare-and-set.

The module contributes its permissions to product-owned root role definitions
and its explicit error-class mappings to the root-composed HTTP problem
registry. The committed OpenAPI contract includes the three operations and the
complete composed problem-code enum. Real HTTP tests cover its authentication,
authorization, validation, visibility and business-error responses.

Fresh local Node 24.18.0 and pnpm 11.15.1 evidence for that feature-branch
revision is `pnpm check:quick` with 68 unit suites and 346 tests, followed by
`pnpm check` with 12 integration suites/58 tests and 28 e2e suites/85 tests.
This is local implementation evidence only: no remote CI, merge, image
publication, deployment or hosted verification is recorded for the slice.
The current toolchain policy accepts every supported Node 24.x patch release;
the version above identifies the runtime used for this historical run.

The reference is optional product code rather than universal foundation. It
does not implement listing, user provisioning, self-service auth, email,
queues or object storage.

## Accepted foundation

The following contracts are complete and remain in the core:

1. Five module-local layers enforced by dependency-cruiser.
2. TypeScript 7.0.2 is the production compiler (`tsc`), while the exact
   `typescript: npm:@typescript/typescript6@6.0.2` alias remains only for
   tooling that still requires the TypeScript 6 API/CLI, plus one typed
   runtime-defaults catalog.
3. PostgreSQL with explicit lifecycle, readiness and a separate migrator role.
4. One auth Redis connection for opaque sessions and distributed login
   limits, preserving the existing key format.
5. Argon2id, cookie sessions, CSRF/Origin checks, revocation, logout-all, RBAC
   and protected Swagger.
6. RFC 9457 problems, Pino correlation and trace-only OpenTelemetry.
7. A committed OpenAPI document with drift and lint gates.
8. A non-root SHA-published GHCR image, one digest smoke and a Trivy
   High/Critical scan.
9. An opt-in BullMQ platform foundation with an independent queue Redis URL,
   producer/worker connection policies, queue readiness, standalone worker
   lifecycle support, a local `queues` Compose profile and a real-Redis proof.

The universal foundation does not include registration, password recovery,
product queues, object storage, application caching, durable events or
mandatory project-specific business modules.

## Optional durable-jobs platform foundation

The starter-level BullMQ foundation is complete. It provides exact BullMQ and
ioredis dependencies, an opt-in `REDIS_QUEUE_URL`, separate queue Redis
connections, bounded readiness and standalone worker lifecycle support. The
default API keeps its existing auth Redis dependency only: it does not receive
the queue URL, import the queue connection module, register a queue or run a
worker. Local queue Redis is available only through the explicit `queues`
Compose profile.

Product adoption remains deferred. A product still must add its feature-owned
queue and payload, producer adapter, worker composition and processor, durable
authoritative state, idempotency policy and operational evidence. An outbox,
scheduling, dashboards and queue deployment topology are likewise deferred.
The adoption and recovery contracts are `docs/architecture/durable-jobs.md` and
`docs/runbooks/queue-redis-loss.md`.

## Roadmap rules

- A roadmap item is not complete because a plan or pull request exists. It
  needs passing gates and, for external operations, runtime evidence.
- Production or hosted-environment mutations require explicit authorization.
- New capabilities start from a real consumer and a narrow contract. A generic
  framework is not built first.
- Optional infrastructure must remain outside the existing auth Redis
  manager unless it has exactly the same availability, persistence and
  lifecycle requirements.
- Core wire contracts, Prisma schema and Redis session/rate-limit key bytes do
  not change as a side effect of an optional capability.
- Every implementation slice updates its configuration, architecture, test and
  recovery documentation in the same pull request.

## Milestone 7: deployment and recovery contract

**Goal:** prove that the existing immutable image can be promoted, migrated,
rolled back and recovered without changing the application core.

**Deliverables:**

- repository-owned `deployment:preflight`, offline `deployment:promote`
  dry-run, explicit apply and `deployment:rollback` mechanics with strict
  non-secret manifests, bounded adapters and atomic redacted evidence;
- `docs/runbooks/deployment.md` for exact-digest promotion and bounded terminal
  polling;
- `docs/runbooks/rollback.md` for returning to the previous digest without
  database down-migrations;
- `docs/runbooks/failed-prisma-migration.md` for a failed one-shot migrator;
- `docs/runbooks/postgres-backup-restore.md` for daily backups, retention and a
  restore into a separate database;
- `docs/runbooks/session-secret-compromise.md` for invalidating every active
  session after secret exposure;
- deployment-specific documentation for TLS/domain, least-privilege runtime and
  migration credentials, and auth Redis persistence;
- an environment-owned schedule for quarterly restore drills.

**Required sequence:**

1. Resolve one image digest produced by the successful `stage` workflow.
2. Run the one-shot Prisma migrator using the migration role.
3. Stop the rollout if migration fails.
4. Roll out the API using the same digest and wait for readiness with a bounded
   deadline.
5. Run an external health/auth smoke.
6. On application failure, restore the previous image digest; do not attempt an
   automatic schema rollback.

**Exit evidence:**

- the runtime database role cannot apply schema migrations;
- a controlled migration failure leaves the previous API revision available;
- a healthy promotion and digest rollback are recorded;
- the latest PostgreSQL backup restores into an isolated database and supports
  representative application queries;
- the auth Redis loss and session-secret compromise procedures are
  executed and recorded.

Dokploy may be the first deployment adapter, but the contract above is the
stable boundary. Dokploy identifiers, credentials and polling details belong
to its runbook or deployment automation, not to application code.

As of 2026-07-30, the repository-owned operator mechanics and local contract
tests are implemented on the deployment feature branch. This is local
repository evidence only. A hosted Stage promotion/rollback drill, Dokploy
runtime observation, production PostgreSQL/Redis verification and recovery
record remain unperformed Milestone 7 exit evidence.

## Milestone 8: clean-copy certification

**Goal:** prove that the core is reusable after the historical generator,
manifest, golden fixtures and custom certification engine have been removed.

**Deliverables:**

- a customization checklist covering service identity, origins, secrets,
  database/Redis URLs, image coordinates and initial admin creation;
- a Git-free smoke procedure that uses existing package scripts instead of a
  new doctor framework;
- a documentation audit linking every supported runtime, security, OpenAPI,
  image and recovery contract to one authoritative document.

**Exit evidence:**

1. Copy the repository without `.git`, `node_modules`, generated output or local
   environment files.
2. Install with the frozen lockfile on Node 24.x and pnpm 11.15.1.
3. Validate/generate Prisma, run `pnpm check`, start local dependencies, apply
   migrations and create the initial admin.
4. Run `pnpm oci:check` and verify API/migrator roles.
5. Confirm that no script reads sibling repositories, Git history or removed
   generator/manifest artifacts.

This milestone may add one small orchestration script only if the manual
procedure proves error-prone. It must not recreate the deleted architecture or
evidence engines.

## Capability candidates

Candidates are independent product slices, not a sequential recipe program.
Each candidate needs a consumer, its own design decision and an isolated
acceptance gate before it enters the starter.

| Candidate                        | Adoption trigger                                                        | Boundary that must remain explicit                                                                                                                                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product durable jobs with BullMQ | A real workflow needs retries, replay or work outside the API process   | Adopt the completed platform foundation with a separate `REDIS_QUEUE_URL`, feature-owned queue/payload, BullMQ-owned connections, PostgreSQL outbox where DB-to-queue durability is required, worker health/shutdown and a migrator → worker → API rollout |
| Auth self-service                | A browser product needs registration, verification or password recovery | Builds on current auth without changing opaque session cookies; hashed single-use tokens, non-enumerating responses and a mail port are required                                                                                                           |
| Object storage                   | A real module needs uploads or presigned access                         | Module-local storage port, S3 adapter, size/type policy and MinIO integration tests; no generic attachment business model                                                                                                                                  |
| Public cache invalidation        | A frontend cache has a concrete tag/webhook contract                    | Prefer a typed application event and signed HTTP adapter; TTL remains the fallback. Add an outbox/queue only when loss across process failure is unacceptable                                                                                              |

The Amazing EKB backend demonstrates why these choices must remain
requirement-driven. Its public-cache invalidation intentionally uses
in-process events and a signed fire-and-forget webhook because frontend TTL is
an acceptable fallback; its import workflows need durable background
processing. Those are two different reliability contracts and must not be
collapsed into a global Redis/cache/event abstraction.

The current product reference is its
[event-driven cache invalidation design](https://github.com/DenisChernykh/amazing-ekb-hub-backend/blob/stage/docs/superpowers/specs/2026-07-19-cache-invalidation-events-design.md).
It is evidence for that reliability choice, not a starter dependency.

Yandex/Telegram imports, catalog entities and frontend-specific cache tags stay
in the product repository. Only reusable infrastructure boundaries may be
extracted, with product names and policies removed.

## Candidate acceptance protocol

An optional capability can be proposed only with:

1. a named consumer and failure model;
2. ports owned by the consuming module, not a global service locator;
3. exact configuration additions and an explicit persistence/availability
   model;
4. focused unit and integration tests plus any required worker/e2e smoke;
5. lifecycle, observability and recovery documentation;
6. proof that the unchanged core still passes `pnpm check:quick`, `pnpm check`
   and the relevant OCI gate.

Distribution starts with documented commits or a maintained branch. A manifest,
overlay engine or apply/removal matrix may be reconsidered only after at least
two independently adopted capabilities demonstrate the same repeated,
error-prone installation steps.

## Test growth policy

The suite protects contracts rather than a target test count. Security
decision tables, Redis Lua semantics, PostgreSQL/Redis/tracing integration,
auth/health/problem/OpenAPI e2e behavior and graceful shutdown remain covered.
Tests for removed production or tooling code stay removed.

Each new capability adds the narrowest useful unit tests, integration tests at
real dependency boundaries and e2e coverage only for a new wire or process
contract. A duplicated compatibility matrix or arbitrary global coverage
percentage is not an acceptance criterion.

## Deliberately retired work

The following items from the earlier roadmap remain retired:

- module generator, templates, starter manifest and golden fixtures;
- custom AST architecture engine and TypeScript bridge/native-preview checks;
- general Redis cache/pub/sub capabilities in the core;
- runtime metrics and auth telemetry adapters;
- OCI pin validators, attestations, evidence schemas and digest resolvers;
- historical execution plans distributed with the starter;
- a framework-first recipe protocol and mandatory combination matrix;
- test-count growth or broad coverage thresholds without a named risk.

They may be reconsidered only with current measured evidence that the simpler
contracts cannot satisfy an adopted use case.
