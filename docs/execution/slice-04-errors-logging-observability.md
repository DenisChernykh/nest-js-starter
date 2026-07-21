# Slice 04 execution evidence: errors, logging and observability

## Tested implementation

- Date: 2026-07-21 (Asia/Yekaterinburg).
- Branch: `feat/errors-logging-observability`.
- `testedImplementationHead`:
  `fa2ad6eed02774e50683031896a1d7a9bbe53a32`.
- The frozen install was up to date and did not change `pnpm-lock.yaml`.
- Node.js: `24.18.0`; pnpm: `11.15.1`; Docker Engine: `29.4.3`.
- Native production `tsc`: `7.0.2`. The exact compatibility alias remains
  `npm:@typescript/typescript6@6.0.2`; the bridge reports compatibility CLI and
  imported API version `6.0.3` separately from the production compiler.
- NestJS: `11.1.28`; Prisma CLI/Client/adapter: `7.9.0`; `redis`: `6.1.0`;
  `pino`: `10.3.1`.
- OpenTelemetry API: `1.9.1`; Node SDK and OTLP exporters: `0.220.0`; stable
  resources/metrics/trace SDK: `2.9.0`; HTTP instrumentation: `0.220.0`; pg:
  `0.72.0`; Redis: `0.68.0`.
- PostgreSQL:
  `postgres:18.4-trixie@sha256:3a82e1f56c8f0f5616a11103ac3d47e632c3938698946a7ad26da0df1334744a`.
- Redis:
  `redis:8.8.0-trixie@sha256:234c902a2db49461a129e2d4aeff85b28cf20187ed274a67f6e50995fa713c7b`.

The documentation and environment example added after the tested implementation
head do not change runtime or test behavior. The existing nvm installation was
activated explicitly; the global Node default was not changed.

## Automated acceptance

The final worktree passed these required commands:

```text
corepack pnpm@11.15.1 install --frozen-lockfile
corepack pnpm@11.15.1 check:quick
TESTCONTAINERS_REUSE_ENABLE=false corepack pnpm@11.15.1 check
corepack pnpm@11.15.1 build
test -f dist/bootstrap/api/main.js
test -f dist/bootstrap/admin/main.js
```

Test evidence from the final full gate:

- unit: 61 suites, 379 tests;
- generator: 3 suites, 52 tests;
- generator golden: 2 suites, 2 tests;
- architecture: 1 suite, 44 tests;
- real PostgreSQL/Redis integration: 12 suites, 54 tests;
- API/health/auth/observability e2e: 21 suites, 57 tests;
- aggregate runtime coverage: 94 suites, 490 tests.

Coverage exceeded the global 80/80/80/75 gate:

```text
Statements: 90.68% (8300/9153)
Functions:  89.81% (494/550)
Lines:      90.68% (8300/9153)
Branches:   85.92% (1343/1563)
```

The collected-path auth branch gate also passed:

```text
auth application:            90.68% (146/161)
auth session infrastructure: 90.91% (80/88)
auth presentation guards:    91.43% (64/70)
```

The narrow real-dependency runs passed with 10 suites/51 tests for the selected
integration paths and 18 suites/47 tests for the selected e2e paths. Prisma 7's
generated WASM compiler requires Jest to run with VM modules in this repository,
so the plan's direct `pnpm exec jest` spelling was corrected to the same launcher
used by repository scripts:

```text
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config <jest-config> --runInBand <selected-paths>
```

One earlier cumulative coverage attempt hit Testcontainers' internal 10-second
Docker port-binding timeout while starting Redis. No test container remained;
the exact shutdown test then passed in 3.459 seconds, and the complete final gate
above passed without reuse. This was treated as infrastructure flakiness, not as
a relaxed assertion or skipped test.

## HTTP problem and log evidence

The executable problem matrix covers:

| Status | Stable code               |
| -----: | ------------------------- |
|    400 | `MALFORMED_REQUEST`       |
|    401 | `AUTHENTICATION_REQUIRED` |
|    403 | `AUTHORIZATION_DENIED`    |
|    404 | `NOT_FOUND`               |
|    409 | `CONFLICT`                |
|    413 | `PAYLOAD_TOO_LARGE`       |
|    415 | `UNSUPPORTED_MEDIA_TYPE`  |
|    422 | `VALIDATION_FAILED`       |
|    429 | `RATE_LIMIT_EXCEEDED`     |
|    500 | `INTERNAL_ERROR`          |
|    503 | `DEPENDENCY_UNAVAILABLE`  |

Every case returns `application/problem+json`, the response `X-Request-ID`, the
same `requestId`, and `instance=urn:request:<requestId>`. Validation assertions
prove that raw values and validator text do not enter the response. The unknown
500 fixture contains a password and PostgreSQL URL: neither reaches the problem
body, while exactly one `http_unhandled_error` record reaches the sanitized sink.

Access-log assertions prove exactly one final `http_request_completed` record
for a success, an expected 422 and an unknown 500. Expected failures have zero
stack records; unknown 500 has one access plus one error record. Route attributes
use templates such as `/v1/technical/access/ok/:itemId`, never concrete IDs or
query strings.

Auth audit fixtures prove a denied login has no actor/session identifier and a
successful login may contain optional audit-only identifiers. Email, IP,
password, cookie and URL material is absent. Audit actions, outcomes and reason
codes are finite and emitted only through the framework-free application port.

## Trace, metric and privacy evidence

The in-memory pipeline proves this topology under one incoming trace:

```text
POST /v1/auth/login
└── auth.login
    ├── PostgreSQL client span
    └── redis.command client span
```

Problem, access and audit records share the accepted request ID. Active records
also carry the incoming trace ID and a span ID. PostgreSQL enhanced reporting is
disabled. Redis statement text, when present after exporter sanitization, is one
uppercase command token only; keys, arguments and arbitrary operation names are
absent.

Application metric attributes are restricted to this tested allowlist:

- `dependency`;
- `event`;
- `http.request.method`;
- `http.response.status_class`;
- `http.route`;
- `operation`;
- `outcome`.

The combined problem/log/span/metric snapshot excludes email, password, cookies,
CSRF and query secrets, database/Redis URLs, full URL attributes, SQL text,
exception messages, span links and exception events. Static scans also found no
request body/query/header serialization and no user/session/email/key/full-URL
metric fields in `src/platform/observability`.

## Collector outage and shutdown evidence

With an unused local OTLP port, exporter timeout `50ms` and telemetry enabled:

- startup completed and `/health/ready` returned `200`;
- a login request returned its expected `401` in less than `1000ms`;
- a safe `otel_diagnostic` record appeared;
- readiness remained `200` after the failed export;
- real `SIGTERM` settled in less than `12s` with `{ code: 1, signal: null }`
  because the required final telemetry flush failed.

The generic compiled-process shutdown fixture disables OTel explicitly and
still proves clean real `SIGTERM` exit 0. Ordered participants close Redis at
200, Prisma/pool at 300 and OpenTelemetry at 400 within the shared hard watchdog.
Neither an exporter deadline nor a watchdog is described as cancellation of an
in-flight OTLP request, Redis command or Prisma query.

## Scope and static review

Architecture checks found no dependency violations across 182 source modules
and 533 dependencies. Domain/application code has no NestJS, Pino,
OpenTelemetry, Prisma or Redis imports; auth uses only framework-free audit and
telemetry ports.

The forbidden-package scan found no forbidden dependency in `package.json` or
production source. Its only matches are negative toolchain tests that reject
`nestjs-pino`, `pino-http`, `pino-pretty` and auto-instrumentations, plus a
manifest-validation fixture named `jobs-bullmq`. Marker/skip scans and
`git diff --check` were clean. No OpenAPI/Swagger, JWT/OAuth, queue, application
image, CI/GHCR, Dokploy, Amazing EKB business logic or demo CRUD was introduced.
