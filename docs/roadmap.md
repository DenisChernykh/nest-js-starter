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

## Milestone 7: Compose+Caddy deployment and recovery contract

**Goal:** leave one explicit production Compose path with host-owned Caddy,
separate PostgreSQL roles and image-only rollback, without changing the
application core.

**Deliverables:**

- standalone `docker-compose.production.yml` using one immutable image for the
  migrator and API, persistent PostgreSQL/auth Redis volumes, internal network,
  external Caddy/observability networks and bounded json-file logs;
- `docs/runbooks/production.env.example` with symbolic input placeholders only;
- tracked idempotent SQL for manual role preparation and post-migration grant
  verification, plus Docker-backed integration proof;
- `docs/runbooks/deployment.md` for VPS file installation, digest verification,
  manual role preparation, migration-first startup, Caddy handoff and bounded
  status/log inspection;
- `docs/runbooks/deployment-preparation.md` and
  `docs/runbooks/deployment-security.md` for the input and secret boundaries;
- `docs/runbooks/rollback.md` for schema-compatible API-only recreation with
  the canonical production Compose prefix plus
  `docker-compose.production.rollback.yml` and `up --detach --no-deps --wait api`;
- `docs/runbooks/stage-image-publication.md` preserving the full Stage gate,
  immutable digest, Trivy, same-digest pull and OCI smoke order.

**Required sequence:**

1. Install the tracked Compose, SQL and env-template files on a normal VPS.
2. Copy the template to the server `.env`, verify mode `0600`, then enter
   secrets through the protected server path.
3. Create or inspect external Caddy and observability networks.
4. Pull `APP_IMAGE` by digest and compare its OCI revision byte-for-byte with
   `SERVICE_REVISION`.
5. Start healthy PostgreSQL/auth Redis, run manual role preparation, execute
   the migrator and inspect exit `0`, then finalize/verify grants.
6. Start and wait for the API, then verify host Caddy and the public health/auth
   contract.
7. For rollback, require explicit schema compatibility and change only the API
   image/revision; never invoke a migrator or down-migration.

**Exit evidence:**

- runtime PostgreSQL role integration proves DML/sequence access and DDL,
  ownership and `_prisma_migrations` denial;
- Compose config and focused tests pass, while local/OCI development paths and
  the Stage workflow remain unchanged;
- previous image/revision metadata is non-secret and rollback is API-only;
- repository documentation names hosted Caddy, Loki and Tempo verification as
  hosted verification remains unperformed until an authorized drill supplies
  fresh evidence.

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
