# NestJS Starter

Production-oriented NestJS backend foundation with a runnable HTTP process,
typed configuration, PostgreSQL/Prisma, capability-scoped Redis, opaque browser
sessions, explicit migrations, three health contracts and bounded graceful
shutdown. Repository architecture and the exact toolchain are enforced by
executable gates.

Included: HTTP runtime, typed config, PostgreSQL/Prisma, migrations, transaction
boundary, required coordination Redis, Argon2id credentials, server-side
sessions, session-bound CSRF, code-owned RBAC, health, graceful shutdown and
architecture/toolchain foundation.

Not included yet: registration/recovery/account administration, JWT/OAuth,
RFC 9457 errors, Pino/OTel, OpenAPI/Swagger, Docker application image, CI/GHCR,
Dokploy and recipes. The starter deliberately contains no fake CRUD or business
model.

## Prerequisites

- Node.js `24.18.0`.
- Corepack with pnpm `11.15.1`.
- Docker for PostgreSQL, Redis, integration, e2e and aggregate coverage tests.

Production source is compiled and type-checked by native TypeScript 7
(`@typescript/native` exposed as `tsc`). TypeScript 6 exists only as the exact
compatibility API required by `ts-jest` and related tooling; `toolchain:check`
guards that split.

## Local runtime

```bash
cp .env.example .env
corepack pnpm@11.15.1 install --frozen-lockfile
docker compose up -d --wait postgres redis-coordination
corepack pnpm@11.15.1 start:migrate
corepack pnpm@11.15.1 auth:create-admin -- --email admin@example.com
corepack pnpm@11.15.1 dev:api
```

The long-running `start:api`/`dev:api` role never migrates. Run the one-shot
`start:migrate` role explicitly before the API. See
`docs/runbooks/local-postgres.md` and `docs/runbooks/initial-admin.md` for
verification, failure paths and cleanup. Generate four independent 32-byte
base64url auth secrets for every deployed environment; `.env.example` values
are development-only.

Health endpoints are outside the `/v1` application prefix:

- `GET /health/live` — process is alive;
- `GET /health/startup` — irreversible startup latch;
- `GET /health/ready` — lifecycle and required dependencies are ready.

The eight `/v1/auth` endpoints are default-authenticated except login. Browser
cookies are opaque and host-only; unsafe requests require exact trusted origin,
JSON content type and the session-bound `X-CSRF-Token`. See
`docs/architecture/auth-core.md` and
`docs/runbooks/coordination-redis-loss.md`.

## Verification

```bash
corepack pnpm@11.15.1 check:quick
TESTCONTAINERS_REUSE_ENABLE=false corepack pnpm@11.15.1 check
```

`check:quick` is the non-Docker developer gate: formatting, exact toolchain,
Prisma validation/generation, lint, TypeScript 7 checks, unit/generator/
architecture tests, manifest and production build. `check` additionally runs
real PostgreSQL/Redis integration and multi-instance e2e suites plus the
aggregate 80/80/80/75 runtime coverage gate and 90% auth security branch
thresholds.

Useful focused commands:

- `corepack pnpm@11.15.1 test` — unit, generator and architecture suites.
- `corepack pnpm@11.15.1 test:integration` — real PostgreSQL/Redis integration tests.
- `corepack pnpm@11.15.1 test:e2e` — clean build and API lifecycle tests.
- `corepack pnpm@11.15.1 test:coverage` — aggregate Docker-backed coverage.
- `corepack pnpm@11.15.1 architecture:check` — dependency graph and public-entrypoint rules.
- `corepack pnpm@11.15.1 generate:module <kebab-case-name>` — subject-neutral module shell.

## Git flow

Feature branches start from `stage` and merge into `stage` through a regular
merge pull request. `main` advances from `stage` by fast-forward only.
