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

The source baseline used for this roadmap is the clean local `stage` branch at
`8a74ef9245fd1d9d0b8df80f55569ecebd338991` on 2026-08-06. The universal
production foundation and the maintained `approval-requests` reference are
present on that baseline.

- PR [#13](https://github.com/DenisChernykh/nest-js-starter/pull/13)
  simplified the runtime, tooling, test and OCI boundaries while preserving the
  auth/RBAC and OpenAPI contracts.
- PR [#14](https://github.com/DenisChernykh/nest-js-starter/pull/14)
  made the publisher pull the immutable digest before the smoke test.
- PR [#35](https://github.com/DenisChernykh/nest-js-starter/pull/35)
  delivered the repository-owned production Compose, Caddy handoff and
  recovery contract described by Milestone 7.
- The
  [Stage image run for `913fef3`](https://github.com/DenisChernykh/nest-js-starter/actions/runs/30192505866)
  completed successfully.
- The recorded `stage` quick gate had 60 unit suites and 302 tests. Integration
  and e2e suites remain in `pnpm check`; Docker verification remains in
  `pnpm oci:check` and stage publication.

No fresh CI, OCI, hosted deployment or recovery drill was run for this
documentation revision. This snapshot records source presence at the stated
revision; it is not a permanent substitute for checking the current branch,
workflow runs and hosted state.

## Maintained vertical reference

The `approval-requests` slice is production-wired on the current `stage`
baseline as the first maintained vertical reference. It covers authenticated
creation, author-or-reviewer visibility and an authorized non-author
approve/reject decision. Prisma persists the aggregate and enforces the
terminal transition with a pending-only compare-and-set.

The module contributes its permissions to product-owned root role definitions
and its explicit error-class mappings to the root-composed HTTP problem
registry. The committed OpenAPI contract includes the three operations and the
complete composed problem-code enum. Real HTTP tests cover its authentication,
authorization, validation, visibility and business-error responses.

Historical feature-branch evidence was `pnpm check:quick` with 68 unit suites
and 346 tests, followed by `pnpm check` with 12 integration suites/58 tests and
28 e2e suites/85 tests on Node 24.18.0 and pnpm 11.15.1. Those counts identify
that historical run and are not fresh evidence for the current baseline.

The reference is optional product code rather than universal foundation. It
does not implement listing, self-service auth, email, queues or object storage.

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

**Repository status:** delivered on `stage` by PR #35. Hosted Caddy, DNS, TLS,
storage, telemetry and recovery-drill evidence remain environment-specific and
must not be inferred from the repository state.

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
  `docker-compose.production.rollback.yml`, persistent non-secret
  `active-api.env` release metadata and `up --detach --no-deps --wait api`;
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

## Product capability expansion roadmap

The next roadmap phase adds new user, operator or integration scenarios. A
pagination helper, HTTP client, outbox, cache or generic repository does not
qualify on its own; those are implementation details that may be introduced
inside an accepted product capability.

Roadmap status has four meanings:

- **recommended next design** — the strongest current candidate, but not an
  authorization to implement it;
- **queued** — high reuse potential with a stable boundary, still requiring a
  named consumer and approved design;
- **direction-gated** — valuable only after the starter is pulled toward a
  public-product, SaaS/B2B, integration or commerce use case;
- **platform adoption** — existing infrastructure that a product capability
  may adopt without promoting product policy into the core.

### Sequencing model

1. Design, plan, implement and review one capability at a time. A roadmap track
   is not one combined epic or pull request.
2. Keep the universal core unchanged unless the capability proves a missing
   cross-cutting contract through a concrete consumer.
3. Let the consuming module own business ports, policies and durable state.
   Platform code may own only driver configuration, lifecycle, readiness and
   other product-neutral mechanics.
4. Extract a shared platform only after at least two independent consumers
   demonstrate the same contract and failure model. Do not generalize from one
   email, webhook, file or job flow.
5. A capability may depend on a previously accepted capability, but it must
   remain independently removable and have its own acceptance gate.

### Milestone 9: self-service account lifecycle

**Status:** recommended next design.

**Goal:** add the first public account-creation path without replacing the
existing opaque sessions, password hashing, RBAC, session revocation or
operator provisioning flows.

**New product behavior:**

- anonymous email/password registration;
- email verification and bounded resend;
- non-enumerating password-recovery request and single-use reset;
- explicit account states that preserve administrator disablement and existing
  session-generation invalidation;
- a minimal auth-owned transactional mail boundary for verification and
  recovery messages.

**Boundaries:**

- verification and recovery tokens are random, hashed at rest, expiring,
  single-use and invalidated by the relevant account transition;
- public responses do not reveal whether an email already exists;
- mail transport failure does not invent a second user/account source of truth;
- social/OIDC login, passkeys, MFA, organizations, a general notification
  center and billing remain separate capabilities;
- the existing session cookie bytes, CSRF/Origin policy, roles and permissions
  do not change as a side effect.

**Design decisions required before an implementation plan:**

- whether login is allowed before email verification;
- the first mail transport and local test transport;
- delivery reliability and retry behavior;
- rate-limit keys and thresholds for registration, resend and recovery.

**Exit evidence:** focused token and security decision-table tests, real
PostgreSQL/Redis integration where state crosses those boundaries, complete
OpenAPI/problem contracts, browser-style e2e flows, recovery documentation and
fresh unchanged-core gates.

### Milestone 10: files and media

**Status:** queued and independent from Milestone 9.

**Goal:** give one named business module a complete upload, authorization,
retrieval and deletion flow backed by S3-compatible object storage.

**Required boundary:** the consuming module owns attachment/media semantics,
allowed content, visibility and retention. A platform adapter may provide
object put/get/delete or presigning, but the starter does not introduce a
global `Attachment` aggregate or allow arbitrary buckets and keys from HTTP
input.

**Design decisions required before an implementation plan:**

- the first real consumer and whether objects are public, private or mixed;
- proxy upload versus presigned upload;
- size/type validation, malware-scanning hook and quarantine policy;
- database/object-store commit order, orphan detection and reconciliation.

**Exit evidence:** provider-neutral port tests, MinIO or equivalent
S3-compatible integration, authorization and content-policy e2e coverage,
bounded cleanup/reconciliation proof, lifecycle/recovery documentation and
fresh unchanged-core gates.

### Direction-gated product tracks

After Milestone 9, and independently of the queued files/media capability,
select a track only when a real product supplies its ownership and failure
model. Track rows are ordered discovery candidates, not pre-approved delivery
sequences.

| Track             | Candidate order                                                                                                 | Adoption trigger                                                                 | Boundary that must remain explicit                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public/operations | Public inquiries → transactional notifications → business audit                                                 | Anonymous visitors submit leads or service requests that operators must process  | An inquiry is durable truth; anti-abuse, assignment and statuses belong to the module. Do not build a dynamic form or workflow engine.                      |
| SaaS/B2B          | Organizations/invitations → API keys/service accounts → subscription billing/entitlements → notifications/audit | Users collaborate inside workspaces and machines act on an organization's behalf | Organization membership is not automatic global multi-tenancy. Resource ownership and every organization-scoped permission remain explicit.                 |
| Integrations      | API keys/service accounts → webhook management → import/export jobs → business audit                            | Customers, bots or external systems integrate with the API                       | Keys are hashed, scoped, expiring and revocable. Webhook delivery, inbox deduplication and job retry policies are separate reliability contracts.           |
| Commerce          | One-time checkout → payment history/refunds/reconciliation → transactional notifications                        | A concrete order or invoice aggregate needs payment collection                   | The product owns orders and fulfillment. Provider webhooks are authoritative integration input; payment status does not become a generic business workflow. |

Subscription billing is intentionally not folded into the commerce row. It
adds recurring invoices, access entitlements, grace periods, cancellation and
reconciliation behavior and therefore needs its own product design.

### Cross-cutting promotion rules

- **Notifications:** first ship narrow transactional delivery inside a named
  consumer. Promote templates, delivery attempts, preferences or an in-app
  inbox only after a second consumer proves the common contract.
- **External identity:** add one OIDC/social provider, passkeys or MFA as a
  separate auth extension after the account-lifecycle design. Do not redesign
  all credentials in the registration milestone.
- **API keys and service accounts:** choose user-owned or organization-owned
  principals before implementation. Do not emulate browser sessions or reuse
  session cookies for machine access.
- **Business audit:** record explicit business actions and authorized reads. It
  does not replace Pino access logs, traces or security audit events.
- **Payments:** implement one-time payment collection and recurring
  subscription billing as different capabilities. Select one provider and one
  product aggregate before designing an adapter.
- **Import/export:** require a concrete dataset, authorization model, file
  format and partial-failure contract. Do not create a universal ETL system.

### Deferred exploratory candidates

These remain visible without receiving a milestone number or implied delivery
commitment:

| Candidate                                                  | Revisit when                                                                                       | Why it is deferred                                                                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| OIDC/social login, passkeys and MFA                        | The account-lifecycle contract is stable and a concrete client needs another authentication method | Each method has distinct linking, recovery and threat-model decisions.                                         |
| Collaboration: comments, mentions and entity subscriptions | Two products need the same collaboration flow around owned business entities                       | A generic comment model otherwise leaks authorization and moderation policy across modules.                    |
| Search                                                     | A real catalog or knowledge module defines searchable fields, ranking and authorization            | Search indexing and result visibility cannot be designed independently of the owning module.                   |
| Feature entitlements                                       | A subscription or organization product needs feature-level access beyond RBAC                      | Entitlements must follow a concrete billing or contract source of truth rather than become another role table. |

### Execution readiness

No new product capability in this roadmap is implementation-ready merely
because it is listed. Milestone 9 is the recommended next design and still has
the explicit decisions above. Every later candidate remains `NOT READY` until
its adoption trigger, product contract, provider choices and failure model are
resolved in a separate design. There is no automatic continuation from one
milestone or track row to the next.

### Platform adoption candidates

These are not new product capabilities by themselves. They become relevant
only inside an accepted product scenario.

| Candidate                        | Adoption trigger                                                 | Boundary that must remain explicit                                                                                                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product durable jobs with BullMQ | A workflow needs retries, replay or work outside the API process | Adopt the completed platform foundation with a separate `REDIS_QUEUE_URL`, feature-owned queue/payload, BullMQ-owned connections, PostgreSQL outbox only where DB-to-queue durability is required, worker health/shutdown and an explicit rollout order. |
| Public cache invalidation        | A frontend cache has a concrete tag/webhook contract             | Prefer a typed application event and signed HTTP adapter; TTL remains the fallback. Add an outbox/queue only when loss across process failure is unacceptable.                                                                                           |

The Amazing EKB backend demonstrates why these choices remain
requirement-driven. Its public-cache invalidation accepts in-process delivery
because frontend TTL is a fallback, while import workflows require durable
background processing. Those reliability contracts must not be collapsed into
a global Redis/cache/event abstraction.

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
