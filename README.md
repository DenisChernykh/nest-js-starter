# NestJS Starter

Production-oriented NestJS backend foundation with a runnable HTTP process,
typed configuration, PostgreSQL/Prisma, capability-scoped Redis, opaque browser
sessions, explicit migrations, three health contracts and bounded graceful
shutdown, RFC 9457 errors, structured Pino JSON logs and an explicit
OpenTelemetry pipeline. Repository architecture and the exact toolchain are
enforced by executable gates. The same gates produce a non-root OCI image with
registry-attached SBOM/provenance and an immutable GHCR digest on `stage`.

Included: HTTP runtime, typed config, PostgreSQL/Prisma, migrations, transaction
boundary, required coordination Redis, Argon2id credentials, server-side
sessions, session-bound CSRF, code-owned RBAC, health, graceful shutdown and
architecture/toolchain foundation, request correlation, normalized problems,
security audit events, traces, low-cardinality runtime metrics and a committed
OpenAPI 3.0.3 contract with policy-controlled Swagger UI, Docker image roles,
pull-request CI and build-once stage publication.

Not included yet: registration/recovery/account administration, JWT/OAuth,
Dokploy environments, production rollout, backup/rollback and recipes. The
starter deliberately contains no fake CRUD or business model.

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

Production logs are newline-delimited Pino JSON on stdout. Every HTTP response
has a validated/generated `X-Request-ID`; RFC 9457 problem bodies carry the same
identifier. OpenTelemetry is enabled by default and uses OTLP HTTP/protobuf.
Set `OTEL_EXPORTER_OTLP_ENDPOINT` (or signal-specific endpoints), or explicitly
set `OTEL_SDK_DISABLED=true` when telemetry must be disabled. Collector health
is intentionally absent from liveness/readiness. See
`docs/architecture/errors-logging-observability.md` and
`docs/runbooks/telemetry-collector-loss.md`.

Health endpoints are outside the `/v1` application prefix:

- `GET /health/live` — process is alive;
- `GET /health/startup` — irreversible startup latch;
- `GET /health/ready` — lifecycle and required dependencies are ready.

The eight `/v1/auth` endpoints are default-authenticated except login. Browser
cookies are opaque and host-only; unsafe requests require exact trusted origin,
JSON content type and the session-bound `X-CSRF-Token`. See
`docs/architecture/auth-core.md` and
`docs/runbooks/coordination-redis-loss.md`.

## OCI image and CI

The Dockerfile produces one image used in one role at a time. Its canonical
commands are:

- API: `node dist/bootstrap/api/main.js` (the image default);
- migrator: `corepack pnpm@11.15.1 run start:migrate` (an explicit one-shot
  command that must finish before API rollout).

Build and exercise both roles locally with the repository-owned smoke:

```bash
corepack pnpm@11.15.1 run oci:check
```

`oci:check` validates immutable pins, applies Dockerfile build checks, builds
the runtime target, rejects a bad migration, runs the real migration, waits for
readiness, verifies the auth problem contract and confirms a graceful non-root
stop. Runtime environment values still come from the typed configuration
contract in `.env.example`; secrets are runtime inputs and never Docker build
arguments. The root docker-compose.yml is local infrastructure, not production
deployment.

Pull requests into `stage` run the complete `check` gate with read-only
repository permissions and no package write. A push merge commit on `stage`
runs the same gate in a read-only job. Only the dependent publisher receives
`packages: write`; queued stage commits use `concurrency.queue: max`, and a
registry preflight rejects an already published SHA before build. The publisher
then builds and pushes exactly one `linux/amd64` image tagged with the
40-character Git SHA. It scans the resulting digest for fixable High/Critical
vulnerabilities and uploads
`image-evidence.json`, SPDX SBOM, SLSA provenance, Trivy JSON and the canonical
OpenAPI artifact.

The SHA tag is a lookup pointer. `Digest references are the only deployment input`:

```text
ghcr.io/owner/repository@sha256:<64-hex-digest>
```

Resolve an already published SHA without build, tag or push:

```bash
corepack pnpm@11.15.1 oci:resolve -- \
  --image ghcr.io/owner/repository \
  --revision <40-hex>
```

External actions and base images are immutable pins. Update
`scripts/oci/oci-pins.json` only in a reviewed pull request after resolving a
stable release tag to its exact commit or digest and rerunning the supply-chain
tests. Native attestations: `private repositories require GitHub Enterprise Cloud`.
This starter therefore treats BuildKit attestations attached to the GHCR digest
plus uploaded evidence as its Slice 6 contract.
See `docs/architecture/oci-supply-chain.md` and
`docs/runbooks/stage-image-publication.md`.

## API contract and Swagger UI

Controllers, request/response DTOs and their explicit Swagger decorators are
the source of truth. The reviewed artifact is committed at
`docs/api/openapi.json`; generation constructs the complete Nest graph in
memory without opening a listener or connecting PostgreSQL/Redis. See
`docs/architecture/openapi-contracts.md` for ownership, review and consumer
pinning rules.

`API_DOCS_MODE` controls the runtime routes `/docs` and `/openapi.json`:

- `public` serves both routes without authentication and is allowed only in
  development/test;
- `protected` requires a valid browser session with `system.docs.read`;
- `off` registers neither route and is the production default.

Stage must set `API_DOCS_MODE=protected` explicitly. Production rejects
`public` during configuration validation. In protected mode, sign in through
the normal application flow, open `/docs`, fetch the CSRF token through
`GET /v1/auth/csrf`, then enter only that token in Swagger's `csrfToken`
authorization field. The HttpOnly session cookie is sent by the browser through
`withCredentials`; it must never be copied into Swagger UI. Authorization is
not persisted by the UI.

## Verification

```bash
corepack pnpm@11.15.1 check:quick
OPENAPI_BREAKING_BASE_REF=origin/stage \
  TESTCONTAINERS_REUSE_ENABLE=false corepack pnpm@11.15.1 check
```

`check:quick` is the non-Docker developer gate: formatting, exact toolchain,
Prisma validation/generation, lint, TypeScript 7 checks, unit/generator/
architecture tests, manifest and production build. `check` additionally runs
real PostgreSQL/Redis integration and multi-instance e2e suites plus the
aggregate 80/80/80/75 runtime coverage gate and 90% auth security branch
thresholds, then builds and exercises the OCI image. The full gate has no
implicit OpenAPI comparison base: CI and local release verification must supply
exactly one reviewed base through
`OPENAPI_BREAKING_BASE_REF` or `OPENAPI_BREAKING_BASE_FILE`.

Normal contract-development commands:

- `corepack pnpm@11.15.1 openapi:generate` — rewrite the canonical committed artifact;
- `corepack pnpm@11.15.1 openapi:drift` — fail when committed bytes differ from fresh offline generation;
- `corepack pnpm@11.15.1 openapi:lint` — lint the committed OpenAPI document;
- `corepack pnpm@11.15.1 openapi:operations` — enforce explicit, unique stable operation IDs;
- `corepack pnpm@11.15.1 openapi:client:check` — generate a temporary fetch client and compile its consumer fixture.

CI/release comparison is intentionally explicit and fail-closed:

```bash
corepack pnpm@11.15.1 openapi:breaking -- --base-ref origin/stage
# Git-free certification against an explicitly materialized reviewed artifact:
corepack pnpm@11.15.1 openapi:breaking -- --base-file /secure/base/openapi.json
```

`openapi:conformance` is an internal/full-gate command: it validates real health,
auth and RFC 9457 responses against the committed document. It complements, but
does not replace, the Docker-backed integration/e2e suites.

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
