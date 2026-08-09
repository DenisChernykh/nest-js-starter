# Production foundation scope

This starter keeps a small production boundary: configuration, PostgreSQL,
auth Redis, HTTP lifecycle/health, auth/RBAC, structured logging,
trace-only OpenTelemetry and opt-in BullMQ, transactional-outbox and periodic
maintenance foundations.
The five local module layers remain `domain`, `application`, `infrastructure`,
`presentation` and `composition`; their boundaries are documented in
`module-boundaries.md`.

Runtime defaults live in one typed immutable `runtime-defaults.ts` object.
Deployment environment variables describe connectivity, public URLs, process
identity and four auth secrets; internal deadlines and tuning stay in code.

The repository gate uses Prettier, Prisma, non-mutating OpenAPI drift/lint,
ESLint, the TypeScript 7.0.2 production compiler, unit tests, standard
dependency-cruiser and the compiled build. The exact TypeScript 6 alias remains
available only to tooling that still requires its API or CLI. Integration and
e2e suites are added by `check`; OCI smoke is separate and runs during stage
publication.

The foundation intentionally excludes a generator/manifest system, generic
cache or pub/sub services, product queues, object storage, runtime metrics and
custom OCI evidence machinery. The auth module contains one opt-in
self-service registration, verification and password-recovery capability; it
does not become a universal notification or identity platform. Product modules
own their ports and adapters; shared infrastructure is introduced only after a
real consumer and failure model are known.

The optional BullMQ layer is a connection, readiness and worker-lifecycle
boundary only. It has a dedicated `REDIS_QUEUE_URL`, separate from auth Redis,
but no registered queue, processor, enqueue service, payload, retry policy or
worker bootstrap in the starter. The default API does not import it. A copied
product owns those additions through the adoption contract in
`durable-jobs.md`.

The optional outbox layer atomically appends broker-neutral messages inside a
PostgreSQL business transaction and provides claim/lease/retry/recovery relay
mechanics plus a BullMQ publisher adapter. It remains outside the default API
composition and defines no product event types, destinations, consumers,
fan-out or exactly-once guarantee. The adopting module owns message
versioning/payload and consumer idempotency through the contract in
`transactional-outbox-adoption.md`.

The periodic maintenance layer is a framework-free, process-local sequencing
Kit. It runs one injected task at a time, waits after successful settlement and
supports abortable idle waits plus bounded active-cycle drain. It adds no Nest
module, timer, daemon, environment input or default composition by itself. It
does not provide cron, durable schedules, retries or distributed ownership;
adopters retain those policies under `periodic-maintenance.md`.

`approval-requests` is the production-wired maintained vertical reference, not
universal foundation and not a generic CRUD abstraction. It demonstrates an
authenticated create/get/decision workflow across all five module-local
layers: product-owned permissions and roles, module-owned HTTP problems, a
Prisma repository with a pending-only compare-and-set, explicit OpenAPI
operations and real HTTP business-error coverage. Products may replace or
remove this reference while retaining the universal runtime, auth and HTTP
contracts.

The reference does not add a list endpoint, self-service endpoints, email
templates, a product queue or object storage. The independent auth lifecycle is
documented in `docs/runbooks/self-service-account-lifecycle.md`; external
identity, notification-center and product-specific delivery remain absent
until a concrete consumer and failure model exists.

`docs/capability-catalog.md` records the wider inventory of available and
candidate capabilities, while `docs/roadmap.md` remains the canonical source
for selected delivery order and remaining deployment/recovery work. Product
repositories may provide proven patterns, but they do not define starter
scope.
