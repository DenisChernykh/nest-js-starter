# Slice 03 execution evidence: Redis capabilities and browser auth core

## Tested implementation

- Date: 2026-07-21 (Asia/Yekaterinburg).
- Branch: `feat/redis-auth-core`.
- `testedImplementationHead`: `d225c58a77f3311a105b90c3d76231f9154affbe`.
- Registry and official release evidence was refreshed before installation.
  Direct dependencies use exact stable pins and the frozen lockfile.
- Node.js: `24.18.0`; pnpm: `11.15.1`; Docker Engine: `29.4.3`.
- Native production `tsc`: `7.0.2`. The compatibility alias remains
  `npm:@typescript/typescript6@6.0.2`; the toolchain bridge verifies its CLI and
  imported API separately from the production compiler.
- NestJS: `11.1.28`; Prisma CLI/Client/adapter: `7.9.0`; `redis`: `6.1.0`;
  `argon2`: `0.45.0`; `cookie-parser`: `1.4.7`.
- PostgreSQL:
  `postgres:18.4-trixie@sha256:3a82e1f56c8f0f5616a11103ac3d47e632c3938698946a7ad26da0df1334744a`.
- Redis:
  `redis:8.8.0-trixie@sha256:234c902a2db49461a129e2d4aeff85b28cf20187ed274a67f6e50995fa713c7b`.

The acceptance harness and documentation do not change runtime behavior after
the tested implementation head. In the Codex escalated shell, the system Node
was `22.19.0`; real-dependency gates therefore used the existing nvm install
explicitly, without changing the global default:

```text
NVM_DIR=/Users/denischernykh/.nvm NODE_VERSION=24.18.0 \
  TESTCONTAINERS_REUSE_ENABLE=false \
  /Users/denischernykh/.nvm/nvm-exec corepack pnpm@11.15.1 check
```

## Automated acceptance

All required commands exited 0 against the final worktree:

```text
corepack pnpm@11.15.1 install --frozen-lockfile
corepack pnpm@11.15.1 check:quick
TESTCONTAINERS_REUSE_ENABLE=false corepack pnpm@11.15.1 check
corepack pnpm@11.15.1 build
```

The frozen install reported no lockfile change. Both
`dist/bootstrap/api/main.js` and `dist/bootstrap/admin/main.js` exist after the
clean production build.

Test evidence:

- unit: 42 suites, 225 tests;
- generator: 3 suites, 52 tests;
- generator golden: 2 suites, 2 tests;
- architecture: 1 suite, 44 tests;
- real PostgreSQL/Redis integration: 11 suites, 53 tests;
- API/health/auth e2e: 14 suites, 37 tests;
- aggregate runtime coverage: 67 suites, 315 tests.

Coverage exceeded the global 80/80/80/75 gate:

```text
Statements: 90.37% (5842/6464)
Functions:  90.84% (377/415)
Lines:      90.37% (5842/6464)
Branches:   84.61% (957/1131)
```

The collected-path branch gate also passed:

```text
auth application:            90.35% (103/114)
auth session infrastructure: 90.91% (80/88)
auth presentation guards:    91.43% (64/70)
```

The gate aggregates Istanbul covered/total counters for the reviewed paths,
so type-only ports and index files do not create false zero-percent per-file
thresholds. Decision-table tests remain mandatory and are not replaced by the
percentage.

## Database, Redis and multi-instance evidence

Migration-from-empty applied both `20260720000000_baseline` and
`20260721090000_auth_core`. A second `prisma migrate deploy` kept exactly two
applied migrations. The auth schema verifies normalized-email uniqueness,
credential CAS versioning, user session generation, role keys and the global
session epoch.

Two separately spawned compiled APIs shared the same isolated PostgreSQL and
standalone coordination Redis. The real-process e2e scenarios proved:

- a login on instance A authenticates on B;
- revoke-one on B rejects the session on A;
- logout-all and password change invalidate sessions on both instances;
- status, role, user generation and global epoch changes apply on the next
  request from fresh PostgreSQL state;
- concurrent attempts on A/B share the atomic account rate limit;
- a weak Argon2id hash upgrades only after a successful login;
- missing-user and wrong-password responses are byte-equivalent.

Coordination Redis loss made auth fail closed and readiness return `503`; after
Redis resumed, readiness returned to `200`. A configured but unavailable cache
endpoint was never connected by production startup and did not affect
readiness. The fixture cache adapter remained lazy, validated payloads, used
source fallback and performed post-commit invalidation.

PostgreSQL loss made auth return the safe dependency response without leaking a
driver error or connection URL. A compiled process received real `SIGTERM` and
exited 0 after Redis closed before Prisma. Redis connection admission now
closes synchronously when shutdown begins, preventing a late reconnect.
Non-settling cleanup still means failed shutdown and exit 1 behind the hard
process watchdog.

Redis commands are bounded by deadlines, but an already-written command is not
described as cancelled. Prisma queries likewise are not described as
cancellable.

## Scope review

Production composition opens only required coordination Redis. Cache is lazy;
Pub/Sub and queue capabilities stay disconnected. Opaque session tokens are
stored only as keyed digests, temporary keys receive finite TTLs, session and
rate mutations use reviewed Lua scripts with explicit keys, and no runtime
`KEYS` command is used.

The default-auth policy, public endpoint exceptions, raw duplicate-cookie
rejection, Origin/Referer/Sec-Fetch-Site/content-type checks, CSRF comparison,
all-of permission checks and unknown-role fail-closed behavior are covered by
decision tables. Password/session/CSRF material and dependency URLs are absent
from logs, snapshots and this evidence.

Deferred to later slices: JWT/OAuth, Amazing EKB business logic, durable job
queues, global application Redis access, RFC 9457/Pino/OpenTelemetry,
OpenAPI/Swagger, application images/CI/GHCR and Dokploy.
