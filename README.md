# nest-js-starter

Reusable NestJS production foundation with PostgreSQL, one auth Redis
connection, opt-in BullMQ/outbox foundations, process-local periodic
maintenance and bounded outbound HTTP Kits, cookie-based auth/RBAC, RFC 9457
errors, protected Swagger and trace-only OpenTelemetry.

## Local workflow

Use Node `24.x`, pnpm `11.15.1` and Docker Compose `2.39.4` or newer. Select
Node 24 with the repository `.nvmrc`, install pnpm through your user-level Node
or package manager, and use the short `pnpm` commands below. The repository
accepts every supported Node 24 patch through `engines`, pins pnpm through
`engines` and `packageManager`, and CI pins the minimum compatible Compose
release.

```sh
node --version
pnpm --version
docker compose version
pnpm install
cp .env.example .env
pnpm dev
```

`pnpm dev` starts PostgreSQL, required auth Redis, the one-shot migrator, the
watched Nest API, Alloy, Loki, Tempo and Grafana. It starts neither queue Redis
nor a worker. The API waits for successful committed migrations and healthy auth
Redis; observability remains fail-open. See the
[local development runbook](docs/runbooks/local-development.md) for Grafana
Explore, Watch behavior, host debugging and shutdown.

Self-service registration, email verification and password recovery remain
disabled by default. Enable `AUTH_SELF_SERVICE_MODE=open` only with a validated
app origin and SMTP/from values. For local testing, start the opt-in Mailpit
profile and follow the [self-service lifecycle runbook](docs/runbooks/self-service-account-lifecycle.md);
SMTP is not an API readiness dependency.

Account administration is also disabled by default. Enable
`AUTH_ACCOUNT_ADMINISTRATION_MODE=enabled` to expose the protected account
catalogue and lifecycle operations. To enable invitations and administrator
password recovery as well, set `AUTH_ACCOUNT_EMAIL_WORKFLOWS_MODE=enabled`
alongside a valid app origin, CORS origin and SMTP/from values.
Operational enablement, lifecycle transitions, retirement and SMTP-failure
handling are documented in the
[account administration runbook](docs/runbooks/account-administration.md).

BullMQ is intentionally opt-in. The default API receives no `REDIS_QUEUE_URL`
and registers no queue. A product that adopts durable jobs starts the separate
local dependency explicitly:

```sh
docker compose --profile queues up -d redis-queue
```

Starting that profile alone does not enable jobs in the API. Read the
[durable-jobs adoption guide](docs/architecture/durable-jobs.md), the
[platform boundary](src/platform/queue/README.md) and the two Redis recovery
runbooks before wiring a product queue.

## Production Compose + Caddy

The production path is a standalone `docker-compose.production.yml` with one
immutable `APP_IMAGE` for the one-shot migrator and API. PostgreSQL and auth
Redis use persistent named volumes; the API joins external Caddy and
observability networks without publishing a host port. Host Caddy remains
outside the repository and proxies its unique upstream alias to port 3000.

Prepare a server `.env` from
[`docs/runbooks/production.env.example`](docs/runbooks/production.env.example),
set mode `0600`, inspect the external networks and verify the GHCR digest and
OCI revision before starting the migration-first sequence. The complete
Compose, manual PostgreSQL role preparation, rollback and hosted-evidence
boundaries are in the [production deployment runbook](docs/runbooks/deployment.md)
and [preparation runbook](docs/runbooks/deployment-preparation.md).

## Initial administrator bootstrap

After applying migrations, create the first administrator through the
PostgreSQL-only one-shot command:

```sh
pnpm auth:create-admin -- --email=admin@example.com
```

The command reads the password from hidden or piped stdin.

## Operator user provisioning

After the initial administrator bootstrap, operators can provision additional
users:

```sh
pnpm auth:create-user -- --email=requester@example.com
pnpm auth:create-user -- --email=reviewer@example.com --role=approval.reviewer
```

The command requires migrated PostgreSQL and reads the password from hidden or
piped stdin. It accepts only roles compiled into the product composition root.
This is operational provisioning, not HTTP registration or invitation.

Run the remaining local checks separately:

```sh
pnpm check:quick
pnpm check
pnpm oci:check
```

`check:quick` runs formatting, Prisma validation/generation, non-mutating
OpenAPI drift and lint, ESLint, the TypeScript 7.0.2 production compiler, unit tests,
dependency-cruiser and the compiled build. `check` adds PostgreSQL/Redis
integration and e2e suites. Docker smoke is separate because it needs a
running Docker daemon.

## Runtime model

The default API opens the HTTP listener, then connects PostgreSQL followed by
auth Redis; traffic remains gated until both are ready. Queue Redis is never a
default API dependency. Startup rollback is auth Redis then PostgreSQL.
Shutdown drains HTTP requests, then closes auth Redis, PostgreSQL and
OpenTelemetry within bounded deadlines. A product worker has its own application
context and bounded lifecycle.

`HealthRegistry` receives PostgreSQL and Redis probes once. The health wire
contract is `/health/live`, `/health/startup` and `/health/ready`. Auth keeps
opaque Redis sessions, distributed login limits, Argon2, CSRF/Origin/Sec-Fetch
policy, session generation and fresh PostgreSQL status/role/epoch checks on
authenticated requests.

Internal timeouts and tuning are typed code defaults in
`src/platform/config/runtime-defaults.ts`. Deployment inputs are documented in
`.env.example`; local Compose-only `POSTGRES_*` and `REDIS_AUTH_PORT` inputs remain
there. The API process does not run migrations; local Compose starts a separate
one-shot migrator and gates API startup on its successful exit.

## Repository guide

- `docs/capability-catalog.md` — inventory of available and candidate capabilities, their consumers, failure models and dependencies;
- `docs/roadmap.md` — accepted foundation, remaining operational milestones and capability adoption rules;
- `docs/architecture/module-boundaries.md` — five module layers and allowed dependencies;
- `docs/architecture/runtime-lifecycle.md` — startup, readiness and shutdown;
- `docs/architecture/durable-jobs.md` — one opt-in BullMQ adoption path;
- `docs/architecture/transactional-outbox-adoption.md` — atomic database-to-queue adoption, relay and idempotent consumer boundaries;
- `docs/architecture/periodic-maintenance.md` — process-local maintenance sequencing, shutdown and recovery boundaries;
- `docs/architecture/bounded-outbound-http.md` — explicit native-fetch attempt, body, deadline, classifier, recovery and removal boundaries;
- `docs/architecture/openapi-contracts.md` — committed wire contract;
- `src/platform/queue/README.md` — platform-only queue connection boundary;
- `docs/runbooks/auth-redis-loss.md` and `docs/runbooks/queue-redis-loss.md` — separate Redis recovery contracts;
- `docs/runbooks/deployment-preparation.md` — Compose, Caddy, GHCR and environment-input readiness before any hosted deployment;
- `docs/runbooks/production.env.example` — symbolic production input names;
- `docs/runbooks/self-service-account-lifecycle.md` — enable, local smoke,
  outage/recovery, disable, rollback and frontend fragment handling;
- `docs/runbooks/transactional-outbox.md` — outbox delivery semantics,
  diagnostics, redrive, retention and incident recovery;
- `docs/runbooks/` — local PostgreSQL, Redis loss, telemetry, Compose deployment and image publication.

The core grows only from a concrete consumer and failure model. The BullMQ
platform boundary does not supply a product queue, worker, payload or retry
policy. The periodic maintenance Kit does not supply durable scheduling,
retries or distributed ownership. The bounded outbound HTTP Kit supplies only
explicit native-fetch attempt/body limits and a classifier-owned finite retry
sequence; it registers no global `HttpService`, provider SDK, status policy,
durable state or adopter. Object storage and frontend cache invalidation remain
independent candidates; none justify a generator, manifest, recipe engine or
global Redis/cache service.

Feature branches start from `stage`, use Conventional Commits and merge to
`stage` through pull requests. No deployment is performed by local checks.
