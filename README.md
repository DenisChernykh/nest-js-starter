# nest-js-starter

Reusable NestJS production foundation with PostgreSQL, one auth Redis
connection, an opt-in BullMQ connection foundation, cookie-based auth/RBAC,
RFC 9457 errors, protected Swagger and trace-only OpenTelemetry.

## Local workflow

Use Node `24.18.0`, pnpm `11.15.1` and Docker Compose `2.39.4` or newer.
Install those versions with a user-level Node or package manager and Docker
Desktop, then use the short `pnpm` commands below. The repository pins Node and
pnpm through `engines` and `packageManager`; CI pins the minimum compatible
Compose release.

```sh
node --version
pnpm --version
docker compose version
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

`pnpm dev` starts PostgreSQL, required auth Redis, the one-shot migrator, the
watched Nest API, Alloy, Loki, Tempo and Grafana. It starts neither queue Redis
nor a worker. The API waits for successful committed migrations and healthy auth
Redis; observability remains fail-open. See the
[local development runbook](docs/runbooks/local-development.md) for Grafana
Explore, Watch behavior, host debugging and shutdown.

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
OpenAPI drift and lint, ESLint, TypeScript 6.0.2, unit tests,
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
`.env.example`; local Compose-only `POSTGRES_*` and `REDIS_PORT` inputs remain
there. The API process does not run migrations; local Compose starts a separate
one-shot migrator and gates API startup on its successful exit.

## Repository guide

- `docs/roadmap.md` — accepted foundation, remaining operational milestones and capability adoption rules;
- `docs/architecture/module-boundaries.md` — five module layers and allowed dependencies;
- `docs/architecture/runtime-lifecycle.md` — startup, readiness and shutdown;
- `docs/architecture/durable-jobs.md` — one opt-in BullMQ adoption path;
- `docs/architecture/openapi-contracts.md` — committed wire contract;
- `src/platform/queue/README.md` — platform-only queue connection boundary;
- `docs/runbooks/auth-redis-loss.md` and `docs/runbooks/queue-redis-loss.md` — separate Redis recovery contracts;
- `docs/runbooks/deployment-preparation.md` — repository, GHCR and environment-input readiness before any hosted deployment;
- `docs/runbooks/` — local PostgreSQL, Redis loss, telemetry and image publication.

The core grows only from a concrete consumer and failure model. The BullMQ
platform boundary is available for a product adoption, but it does not supply a
product queue, worker, payload or retry policy. Object storage, self-service
auth and frontend cache invalidation remain independent candidates; none justify
a generator, manifest, recipe engine or global Redis/cache service.

Feature branches start from `stage`, use Conventional Commits and merge to
`stage` through pull requests. No deployment is performed by local checks.
