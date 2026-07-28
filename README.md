# nest-js-starter

Reusable NestJS production foundation with PostgreSQL, one coordination Redis
connection, cookie-based auth/RBAC, RFC 9457 errors, protected Swagger and
trace-only OpenTelemetry.

## Local workflow

Use Node `24.18.0` and pnpm `11.15.1`. Install those exact versions with a
user-level Node or package manager, then use the short `pnpm` commands below.
The repository pins both versions through `engines` and `packageManager`.

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d --wait postgres redis-coordination
pnpm start:migrate
pnpm dev
```

`pnpm dev` generates Prisma Client, then starts the API with the standard
Nest CLI watch flow. It does not start or stop Docker services and does not
apply migrations. Bring the infrastructure up and run `pnpm start:migrate`
explicitly when preparing a local environment. PostgreSQL and
`redis-coordination` must both be available before the API becomes ready.

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

Startup opens the HTTP listener, then connects PostgreSQL followed by Redis;
traffic remains gated until both are ready. Startup rollback is Redis then
PostgreSQL. Shutdown drains HTTP requests, then closes Redis, PostgreSQL and
OpenTelemetry within bounded deadlines.

`HealthRegistry` receives PostgreSQL and Redis probes once. The health wire
contract is `/health/live`, `/health/startup` and `/health/ready`. Auth keeps
opaque Redis sessions, distributed login limits, Argon2, CSRF/Origin/Sec-Fetch
policy, session generation and fresh PostgreSQL status/role/epoch checks on
authenticated requests.

Internal timeouts and tuning are typed code defaults in
`src/platform/config/runtime-defaults.ts`. Deployment inputs are documented in
`.env.example`; local Compose-only `POSTGRES_*` and `REDIS_PORT` inputs remain
there. The API does not run migrations; run the migrator role first.

## Repository guide

- `docs/roadmap.md` — accepted foundation, remaining operational milestones and capability adoption rules;
- `docs/architecture/module-boundaries.md` — five module layers and allowed dependencies;
- `docs/architecture/runtime-lifecycle.md` — startup, readiness and shutdown;
- `docs/architecture/openapi-contracts.md` — committed wire contract;
- `docs/runbooks/` — local PostgreSQL, Redis loss, telemetry and image publication.

The core grows only from a concrete consumer and failure model. Queues, object
storage, self-service auth and frontend cache invalidation are documented as
independent candidates; they do not justify a generator, manifest, recipe
engine or global Redis/cache service.

Feature branches start from `stage`, use Conventional Commits and merge to
`stage` through pull requests. No deployment is performed by local checks.
