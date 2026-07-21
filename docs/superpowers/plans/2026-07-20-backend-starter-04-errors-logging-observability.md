# NestJS Starter Errors, Logging And Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` inline task-by-task. This repository execution
> explicitly forbids subagents. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Добавить единый RFC 9457 HTTP error contract, redacted Pino logging,
security audit events и раннюю OpenTelemetry instrumentation без превращения
collector в runtime dependency.

**Architecture:** API entrypoint сначала валидирует process-specific config,
создаёт Pino sink и запускает OTel SDK, а NestJS, HTTP, Prisma и Redis импортирует
только после instrumentation startup. Request middleware создаёт request ID до
guards/body parsing, завершает ровно один access log и записывает low-cardinality
HTTP metrics по route template. Global exception filter владеет exhaustive
problem mapping и единственным stack-bearing 5xx log; auth application сообщает
audit/telemetry через framework-free ports.

**Tech Stack:** Node.js 24.18.0, pnpm 11.15.1, native TypeScript 7, NestJS 11,
Pino 10, OpenTelemetry JS 2.x/0.220, Prisma 7, PostgreSQL 18, node-redis 6,
Jest 30, Testcontainers 12.

## Global Constraints

- Выполнять работу inline одним агентом; не использовать SDD, subagents или
  parallel agent work.
- Feature branch создаётся от актуального `stage`; изменения вливаются в
  `stage` обычным merge PR. `main` продвигается только fast-forward от `stage`.
- Перед installation повторить official registry `latest`, Node engines,
  peers и OpenTelemetry version-family checks. Direct dependencies содержат
  exact pins без `latest`, `^` и `~`.
- Если refreshed stable version конфликтует с Node 24.18.0, NestJS 11,
  node-redis 6, Prisma 7, native TypeScript 7 или compatibility TypeScript 6,
  остановиться для отдельного compatibility-решения; молчаливый downgrade
  запрещён.
- Первый dependency commit отделён от behavior commits и меняет только
  manifest/lockfile плюс compatibility gate.
- Сохранить hexagonal boundaries из
  `docs/architecture/module-boundaries.md`: `domain` и `application` не
  импортируют NestJS, HTTP, Pino, OpenTelemetry, Prisma или Redis.
- Не добавлять business CRUD, Swagger/OpenAPI generation, JWT/OAuth, queues,
  Docker application image, CI/CD, GHCR или deployment automation.
- Все HTTP failures возвращают `application/problem+json`; raw rejected values,
  dependency details, stack и internal messages клиенту не возвращаются.
- Committed starter problem base URI равен
  `https://nest-js-starter.invalid/problems`. Это reserved starter identity:
  product adoption меняет один committed constant до публикации собственного
  API; runtime host и environment не меняют URI.
- Один request создаёт ровно один final access record. Expected 4xx не создают
  stack log. Unexpected 5xx создаёт один stack-bearing error record плюс
  обязательный final access record.
- Logs — newline-delimited Pino JSON в stdout. Production не пишет log files,
  не использует transport/prettifier и не сериализует request/response body,
  query или полный headers object.
- Central logger удаляет sensitive keys и использует safe error serializer,
  который сохраняет error type и stack frames, но исключает raw message/cause.
- Audit payload не содержит email, raw IP, password, token, cookie, URL или
  secret. CLI/startup не получают фиктивные request/trace identifiers.
- Request ID и trace ID остаются разными полями. Входящий `X-Request-ID`
  принимается только как canonical UUID или uppercase ULID; иначе генерируется
  `crypto.randomUUID()`.
- OTel SDK запускается до imports NestJS/HTTP/Prisma/Redis. Collector outage не
  влияет на liveness/readiness и не блокирует request path.
- `OTEL_SDK_DISABLED` по умолчанию равен `false`; общий test environment helper
  выставляет `true`, а observability integration/e2e suites явно включают SDK.
  Это не позволяет обычным tests случайно отправлять telemetry и одновременно
  проверяет реальный enabled pipeline отдельными suites.
- Каждый span проходит через exporter-boundary sanitizer с allowlist по виду
  instrumentation. HTTP сохраняет method/status/route/protocol, PostgreSQL —
  system/operation/database name, Redis — system/operation. Raw URL/query,
  headers, client IP, SQL statement, Redis args/key и exception event payload
  удаляются до любого real или in-memory exporter.
- Metrics используют finite labels. Route label — template; raw URL, user ID,
  session ID, entity ID, email и Redis key никогда не являются metric
  attributes.
- Redis span serializer экспортирует только command name. Command arguments,
  keys, session records и cache payloads в spans не попадают.
- Telemetry shutdown bounded и участвует в ordered cleanup после Redis/Prisma.
  Deadline не описывается как cancellation exporter request; non-settling
  cleanup сохраняет exit 1/hard-watchdog semantics.
- Все hand-written exported TypeScript contracts получают TSDoc по
  `docs/architecture/tsdoc-guidelines.md` в том же commit.
- `pnpm check:quick` остаётся cumulative gate. Полный `pnpm check`, реальные
  PostgreSQL/Redis, compiled-process e2e и coverage обязательны перед PR.
- Сохранить global coverage 80/80/80/75 и существующие auth collected-path
  branch gates; decision tables покрывают каждую problem/redaction/audit/
  request-ID/cardinality ветку независимо от процента.

---

## Planning snapshot на 2026-07-21

Task 0 обязан повторить запросы перед installation.

| Package                                     | Stable candidate | Engines/peers and evidence                              |
| ------------------------------------------- | ---------------: | ------------------------------------------------------- |
| `pino`                                      |         `10.3.1` | npm `latest`; official Pino 10 JSON/redaction/child API |
| `@opentelemetry/api`                        |          `1.9.1` | npm `latest`; Node `>=8`; SDK peer `<1.10.0`            |
| `@opentelemetry/sdk-node`                   |        `0.220.0` | npm `latest`; Node `^18.19                              |     | >=20.6`; API peer `>=1.3 <1.10` |
| `@opentelemetry/sdk-metrics`                |          `2.9.0` | npm `latest`; exact family used by SDK Node 0.220       |
| `@opentelemetry/sdk-trace-base`             |          `2.9.0` | exact SDK family; in-memory acceptance exporter         |
| `@opentelemetry/resources`                  |          `2.9.0` | exact SDK family; committed service metadata resource   |
| `@opentelemetry/semantic-conventions`       |         `1.43.0` | npm `latest`; SDK accepts `^1.29`                       |
| `@opentelemetry/exporter-trace-otlp-http`   |        `0.220.0` | npm `latest`; HTTP/protobuf OTLP                        |
| `@opentelemetry/exporter-metrics-otlp-http` |        `0.220.0` | npm `latest`; HTTP/protobuf OTLP                        |
| `@opentelemetry/instrumentation-http`       |        `0.220.0` | npm `latest`; inbound/outbound root spans               |
| `@opentelemetry/instrumentation-pg`         |         `0.72.0` | npm `latest`; Node 24-compatible                        |
| `@opentelemetry/instrumentation-redis`      |         `0.68.0` | npm `latest`; current source includes node-redis 6      |

`nestjs-pino`, `pino-http`, `pino-pretty`, auto-instrumentations, NestJS core
instrumentation and Express layer instrumentation are intentionally excluded.
The starter owns one access log, one request context and route-template metric
finalization; extra framework loggers/spans would duplicate records and widen
the attribute surface.

## Result boundary

После Slice 4 доступны:

- canonical problem registry and `docs/api/problem-types.md`;
- `application/problem+json` for validation, auth, not-found, dependency and
  unknown failures;
- trusted `X-Request-ID`, response correlation and `urn:request:<id>` instance;
- Pino stdout logger, Nest adapter, safe error serializer and one access log;
- typed security audit events for existing auth/admin flows;
- pre-Nest OTel SDK with HTTP/pg/redis spans, custom auth spans and finite
  metrics;
- collector-outage isolation and bounded telemetry shutdown evidence.

Не входят OpenAPI artifact/Swagger, docs access audit, role/status HTTP mutation
events, log shipping backend, alert rules, dashboards или queue metrics. Docs
access denial появляется в Slice 5 вместе с реальным docs middleware. Role/
status audit emitters появляются вместе с соответствующими mutation use cases;
Slice 4 фиксирует допустимую schema и валидатор без выдуманного endpoint.

## Normative contracts

### RFC 9457

```ts
export interface ProblemFieldError {
  readonly pointer: string
  readonly code: string
  readonly detail: string
}

export interface ProblemDocument {
  readonly type: string
  readonly title: string
  readonly status: number
  readonly detail: string
  readonly instance: string
  readonly code: string
  readonly requestId: string
  readonly errors?: readonly ProblemFieldError[]
}

export interface ProblemDefinition {
  readonly slug: string
  readonly title: string
  readonly status: number
  readonly code: string
  readonly detail: string
}
```

Problem type is
`https://nest-js-starter.invalid/problems/<slug>`. Registry rejects duplicate
slug/code, non-absolute types, mismatched status and field errors on non-
validation definitions.

### Request and logging context

```ts
export interface RequestContextState {
  readonly requestId: string
}

export interface CorrelationFields {
  readonly requestId?: string
  readonly traceId?: string
  readonly spanId?: string
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export interface StructuredLogRecord {
  readonly level: LogLevel
  readonly event: string
  readonly module: string
  readonly attributes?: Readonly<Record<string, string | number | boolean>>
  readonly error?: unknown
}

export interface StructuredLogger {
  write(record: StructuredLogRecord): void
}
```

Every emitted JSON record contains `timestamp`, string `level`, `service`,
`version`, `revision`, `environment`, `event`, `module`; correlation fields are
added only when active.

### Audit and application telemetry

```ts
export type AuthAuditAction =
  | 'login'
  | 'logout'
  | 'logout_all'
  | 'session_revoke'
  | 'password_change'
  | 'initial_admin_create'
  | 'role_change'
  | 'status_change'

export interface AuthAuditEvent {
  readonly action: AuthAuditAction
  readonly outcome: 'success' | 'denied' | 'partial' | 'conflict'
  readonly reasonCode: string
  readonly actorId?: string
  readonly sessionId?: string
  readonly targetType?: 'user' | 'session'
  readonly targetId?: string
}

export interface AuthAuditPort {
  emit(event: AuthAuditEvent): void
}

export interface TelemetryPort {
  runSpan<T>(name: string, operation: () => Promise<T>): Promise<T>
  recordAuthOutcome(
    operation: 'login' | 'logout' | 'logout_all' | 'password_change' | 'revoke',
    outcome: 'success' | 'denied' | 'limited' | 'dependency_error',
  ): void
}
```

Ports remain framework-free. Implementations never throw into the owning auth
operation; logging/export failure is surfaced through internal diagnostics,
not by changing a successful security mutation.

### Observability lifecycle

```ts
export interface ObservabilityRuntime {
  readonly name: 'observability'
  readonly order: 400
  start(): void
  close(signal: AbortSignal): Promise<void>
}
```

`close()` observes the shared shutdown signal and rejects on deadline. It does
not claim an in-flight exporter request was cancelled.

## Task 0: Repeat preflight and create execution branch

**Files:** none

**Interfaces:**

- Consumes: clean `stage` containing merge `76085c9` or a reviewed successor.
- Produces: clean `feat/errors-logging-observability` plus refreshed evidence.

- [ ] **Step 1: Verify topology and base**

Run:

```bash
git fetch --prune origin
git switch stage
git merge --ff-only origin/stage
git status --short --branch
git merge-base --is-ancestor origin/main stage
```

Expected: clean `stage`; main is an ancestor; no local divergence.

- [ ] **Step 2: Refresh registry metadata**

Run `npm view <package> version engines peerDependencies dist-tags --json` for
every package in the snapshot. Additionally inspect `sdk-node` dependencies to
confirm `sdk-metrics`, `sdk-trace-base` and `resources` remain one exact family.

Expected: stable tags and compatible peers. Any family mismatch is resolved
before package installation and documented in the dependency commit.

- [ ] **Step 3: Reconfirm instrumentation support from official sources**

Check that Redis instrumentation includes node-redis `^6.0.0`, HTTP
instrumentation supports Node 24 and `dbStatementSerializer` remains available.
Do not substitute ioredis instrumentation.

- [ ] **Step 4: Activate exact toolchain**

Run:

```bash
source /Users/denischernykh/.nvm/nvm.sh
nvm use 24.18.0
node --version
corepack pnpm@11.15.1 --version
```

Expected: `v24.18.0`, `11.15.1`; global default unchanged.

- [ ] **Step 5: Create execution branch**

```bash
git switch -c feat/errors-logging-observability
```

## Task 1: Pin the logging and telemetry dependency family

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `scripts/toolchain/check-typescript-bridge.ts`
- Modify: `test/unit/toolchain/typescript-bridge.spec.ts`

**Interfaces:**

- Consumes: refreshed Task 0 matrix.
- Produces: exact coherent packages and a manifest gate rejecting family drift.

- [ ] **Step 1: Write the failing package-family gate**

Extend the toolchain test with an `assertObservabilityDependencyFamily()`
case that receives the exact refreshed Task 0 pins and rejects ranges, any
exporter/instrumentation-http version different from the refreshed SDK Node
compatibility line, any SDK metrics/trace/resources version different from its
refreshed exact family, an incompatible API peer, and forbidden `nestjs-pino`/
`pino-http`/auto-instrumentations. The gate compares complete versions, not
only family prefixes.

- [ ] **Step 2: Verify RED**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/toolchain/typescript-bridge.spec.ts
```

Expected: FAIL because required exact packages are absent.

- [ ] **Step 3: Install exact refreshed pins**

Use `pnpm add --save-exact` for Pino, API, NodeSDK, metrics, trace-base,
resources, semantic conventions, two OTLP HTTP exporters and HTTP/pg/redis
instrumentations. Do not add a prettier or framework logger.

- [ ] **Step 4: Verify peers and compiler bridge**

```bash
corepack pnpm@11.15.1 install --frozen-lockfile
corepack pnpm@11.15.1 toolchain:check
corepack pnpm@11.15.1 typecheck
```

Expected: no peer warnings; native TS7 build path and TS6 compatibility API
remain unchanged.

- [ ] **Step 5: Commit dependency baseline**

```bash
git add package.json pnpm-lock.yaml scripts/toolchain test/unit/toolchain
git commit -m "chore(deps): pin logging observability foundation"
```

## Task 2: Build process-specific typed configuration and early composition

**Files:**

- Modify: `src/platform/config/runtime-environment.schema.ts`
- Modify: `src/platform/config/runtime-environment.ts`
- Modify: `src/platform/config/runtime-config.types.ts`
- Modify: `src/platform/config/runtime-config.service.ts`
- Modify: `src/platform/config/runtime-config.module.ts`
- Modify: `src/platform/config/postgres-command-config.ts`
- Modify: `src/bootstrap/api/api.module.ts`
- Modify: `src/bootstrap/api/configure-api.ts`
- Modify: `test/support/required-runtime-environment.ts`
- Modify: `test/unit/platform/config/runtime-environment.spec.ts`
- Modify: `test/unit/platform/config/runtime-config.service.spec.ts`

**Interfaces:**

- Produces: `buildApiRuntimeConfig()`, `buildPostgresCommandConfig()`,
  `RuntimeConfigModule.forRoot(config)` and immutable logging/OTel groups.
- Removes: synthetic Redis/auth placeholders from PostgreSQL-only commands.

- [ ] **Step 1: Write failing config decision tables**

Cover exact levels, service metadata, standard OTLP HTTP endpoint URL rules,
`http/protobuf`, metric/export/shutdown bounds, `OTEL_SDK_DISABLED`, defensive
copies and redacted validation errors. Prove PostgreSQL command validation needs
only database plus logging metadata and rejects neither absent Redis nor absent
auth secrets.

Assert default `OTEL_SDK_DISABLED=false`. Update the common test environment
helper to set `true`; observability integration/e2e harnesses override it to
`false` intentionally.

- [ ] **Step 2: Verify RED**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/platform/config
```

Expected: FAIL for missing config builders/groups.

- [ ] **Step 3: Extract one validation source with two projections**

Create shared Joi fragments, an API schema containing HTTP/database/Redis/auth/
logging/OTel keys, and a PostgreSQL-command schema containing database/logging
only. Both errors retain path/rule but never rejected values.

- [ ] **Step 4: Make runtime module explicit**

`RuntimeConfigService` receives an immutable `ApplicationRuntimeConfig` token;
`RuntimeConfigModule.forRoot(config)` owns the global provider. `ApiModule` is a
dynamic composition root receiving a prevalidated config. Child modules no
longer initialize `ConfigModule.forRoot()` independently.

- [ ] **Step 5: Verify config and cumulative architecture**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/platform/config test/unit/bootstrap/api.module.spec.ts
corepack pnpm@11.15.1 architecture:check
```

- [ ] **Step 6: Commit**

```bash
git add src/platform/config src/bootstrap/api test/support test/unit/platform/config test/unit/bootstrap/api.module.spec.ts
git commit -m "feat(config): validate logging and telemetry settings"
```

## Task 3: Add the redacted Pino sink and Nest logger adapter

**Files:**

- Create: `src/platform/logging/logging.contracts.ts`
- Create: `src/platform/logging/safe-error.serializer.ts`
- Create: `src/platform/logging/pino-log.sink.ts`
- Create: `src/platform/logging/nest-logger.adapter.ts`
- Create: `src/platform/logging/logging.module.ts`
- Modify: `src/platform/logging/README.md`
- Create: `test/unit/platform/logging/safe-error.serializer.spec.ts`
- Create: `test/unit/platform/logging/pino-log.sink.spec.ts`
- Create: `test/unit/platform/logging/nest-logger.adapter.spec.ts`

**Interfaces:**

- Produces: `StructuredLogger`, `PinoLogSink`, `NestLoggerAdapter` and root
  `LoggingModule.forRoot()`.
- Consumes later: optional request/trace correlation providers.

- [ ] **Step 1: Write failing JSON/redaction tests**

Capture stdout in a memory `Writable`. Assert exactly one JSON object per line;
required base fields; string level; deterministic injected clock; no pid/
hostname; removal of authorization/cookie/set-cookie/password/token/apiKey/
databaseUrl/redisUrl/secret keys at nested array/object depths.

- [ ] **Step 2: Write safe-error decision tests**

Use errors whose message/cause contain credentials and URLs. Expected output
contains only stable error type plus sanitized frame lines; it contains no raw
message, cause payload, URL credentials or secret substring.

- [ ] **Step 3: Verify RED**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/platform/logging
```

- [ ] **Step 4: Implement direct Pino stdout sink**

Configure custom ISO `timestamp`, string level formatter, committed service
metadata, central `redact.remove=true`, safe error serializer and direct stdout
destination. `StructuredLogRecord.attributes` accepts primitives only and
validates finite numbers/event/module names before emission.

- [ ] **Step 5: Implement Nest adapter without automatic HTTP logging**

Map Nest methods to structured events with module from Nest context. Never pass
arbitrary objects through; unknown Nest payloads become safe type-only errors or
bounded strings after sanitizer.

- [ ] **Step 6: Verify and commit**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/platform/logging
git add src/platform/logging test/unit/platform/logging
git commit -m "feat(logging): add redacted structured logger"
```

## Task 4: Establish request ID and correlation context before guards

**Files:**

- Create: `src/platform/http/context/request-id.ts`
- Create: `src/platform/http/context/request-context.ts`
- Create: `src/platform/http/context/request-context.middleware.ts`
- Create: `src/platform/http/context/correlation-fields.provider.ts`
- Modify: `src/platform/http/bootstrap/configure-http-application.ts`
- Modify: `src/bootstrap/api/api.module.ts`
- Create: `test/unit/platform/http/context/request-id.spec.ts`
- Create: `test/unit/platform/http/context/request-context.spec.ts`
- Create: `test/e2e/http/request-correlation.e2e.spec.ts`

**Interfaces:**

- Produces: request-scoped `requestId`, response `X-Request-ID`, trace/span
  correlation lookup and `urn:request:<requestId>`.
- Middleware order: request context before Helmet/CORS/body parser/cookies.

- [ ] **Step 1: Write request-ID decision table**

Accept canonical UUID and 26-character uppercase ULID only. Reject lowercase
ULID, whitespace, multiple headers, arrays, overlength and arbitrary strings;
generate UUID when rejected. Assert response echo only for accepted value.

- [ ] **Step 2: Verify RED**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/platform/http/context
```

- [ ] **Step 3: Implement ALS context and middleware**

Use one `AsyncLocalStorage<RequestContextState>`. Bind response header before
calling `next`; preserve context for guards/interceptors/handlers and response
listeners. Do not store request/response objects, auth tokens or IP.

- [ ] **Step 4: Add trace correlation provider**

Read active span context through `@opentelemetry/api`; return trace/span only
when valid. Logger merges request and trace fields at write time without
inventing absent values.

- [ ] **Step 5: Verify e2e and commit**

```bash
corepack pnpm@11.15.1 exec jest --config jest.e2e.config.mjs --runInBand test/e2e/http/request-correlation.e2e.spec.ts
git add src/platform/http/context src/platform/http/bootstrap src/bootstrap/api test/unit/platform/http/context test/e2e/http/request-correlation.e2e.spec.ts
git commit -m "feat(http): add request correlation context"
```

## Task 5: Create canonical RFC 9457 registry and validation errors

**Files:**

- Create: `src/platform/http/errors/problem.contracts.ts`
- Create: `src/platform/http/errors/problem-registry.ts`
- Create: `src/platform/http/errors/request-validation.error.ts`
- Create: `src/platform/http/errors/validation-error.mapper.ts`
- Create: `docs/api/problem-types.md`
- Modify: `src/platform/http/bootstrap/configure-http-application.ts`
- Create: `test/unit/platform/http/errors/problem-registry.spec.ts`
- Create: `test/unit/platform/http/errors/validation-error.mapper.spec.ts`

**Interfaces:**

- Produces: immutable definitions for malformed request, authentication,
  authorization, not found, conflict, payload too large, unsupported media,
  validation, rate limit, dependency unavailable and internal error.
- Validation errors use escaped RFC 6901 JSON Pointer and never include values.

- [ ] **Step 1: Write failing registry invariants**

Assert stable absolute type, code/title/status/detail, unique slug/code, frozen
lookups and exact docs parity. Unknown registry code is rejected at startup.

- [ ] **Step 2: Write validation flattening table**

Cover nested objects, arrays, `~` and `/` escaping, multiple constraints,
stable sorting and deduplication. Map class-validator constraint names to a
reviewed finite client code set; detail is constant per constraint.

- [ ] **Step 3: Verify RED**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/platform/http/errors
```

- [ ] **Step 4: Implement registry and validation exception factory**

Configure global `ValidationPipe` to throw `RequestValidationError` with only
mapped field issues and status 422. Keep malformed JSON at 400 and body limit at 413.

- [ ] **Step 5: Generate human problem catalogue manually from registry values**

Document type, code, status, title, detail and optional `errors`; no OpenAPI
artifact is introduced in this slice. Unit parity test reads the Markdown table
and rejects missing/extra registry rows.

- [ ] **Step 6: Verify and commit**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/platform/http/errors
git add src/platform/http/errors src/platform/http/bootstrap docs/api/problem-types.md test/unit/platform/http/errors
git commit -m "feat(http): add canonical problem registry"
```

## Task 6: Replace temporary auth mapping with one global problem filter

**Files:**

- Create: `src/platform/http/errors/http-problem.mapper.ts`
- Create: `src/platform/http/errors/problem-exception.filter.ts`
- Create: `src/platform/http/errors/http-errors.module.ts`
- Delete: `src/modules/auth/presentation/auth-http-error.mapper.ts`
- Modify: `src/modules/auth/presentation/auth.controller.ts`
- Modify: `src/modules/auth/composition/auth.module.ts`
- Modify: `test/e2e/auth/auth-test-harness.ts`
- Create: `test/unit/platform/http/errors/http-problem.mapper.spec.ts`
- Create: `test/unit/platform/http/errors/problem-exception.filter.spec.ts`
- Create: `test/e2e/problems/problem-contract.e2e.spec.ts`
- Modify: `test/e2e/auth/authentication.e2e.spec.ts`
- Modify: `test/e2e/auth/csrf.e2e.spec.ts`
- Modify: `test/e2e/auth/dependency-failures.e2e.spec.ts`
- Modify: `test/e2e/auth/multi-instance.e2e.spec.ts`
- Modify: `test/e2e/auth/password-rehash.e2e.spec.ts`
- Modify: `test/e2e/auth/session-management.e2e.spec.ts`

**Interfaces:**

- `APP_FILTER` catches all HTTP exceptions/errors and replies through
  `HttpAdapterHost` with exact problem content type.
- Known framework-free auth errors map by exhaustive `AuthFailureCode`; default
  branch is compile-time `never` plus runtime internal fallback.

- [ ] **Step 1: Write failure matrix before filter**

Cover malformed JSON 400, missing/failed auth 401, CSRF/permission 403, route or
session 404, state conflict 409, body limit 413, content type 415, validation
422, rate limit 429, PostgreSQL/Redis unavailable 503 and unknown 500.

- [ ] **Step 2: Assert safe response shape**

For each row assert content type, exact fields, status equality, stable type,
request ID and instance. Unknown error with secret-bearing message must produce
byte-safe constant problem detail and no stack.

- [ ] **Step 3: Verify RED**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/platform/http/errors
corepack pnpm@11.15.1 exec jest --config jest.e2e.config.mjs --runInBand test/e2e/problems
```

- [ ] **Step 4: Implement exhaustive mapper/filter**

Filter writes status/header/body once. Expected 4xx are not error-logged.
Unknown 5xx writes one `http_unhandled_error` record through StructuredLogger
with safe error serializer, then sends `INTERNAL_ERROR`.

- [ ] **Step 5: Remove module-local transport mapper**

Controllers allow framework-free auth errors to reach the global filter. Cookie
clear/set behavior remains in the adapter/controller and is regression-tested.

- [ ] **Step 6: Verify full auth/problem e2e and commit**

```bash
corepack pnpm@11.15.1 exec jest --config jest.e2e.config.mjs --runInBand test/e2e/auth test/e2e/problems
git add src/platform/http/errors src/modules/auth test/unit/platform/http/errors test/e2e/auth test/e2e/problems
git commit -m "feat(http): standardize problem responses"
```

## Task 7: Emit exactly one final access log and finite HTTP metrics

**Files:**

- Create: `src/platform/logging/http-access-log.middleware.ts`
- Create: `src/platform/logging/http-route-template.ts`
- Create: `src/platform/observability/http-metrics.ts`
- Modify: `src/platform/logging/logging.module.ts`
- Modify: `src/platform/http/bootstrap/configure-http-application.ts`
- Create: `test/unit/platform/logging/http-route-template.spec.ts`
- Create: `test/unit/platform/logging/http-access-log.middleware.spec.ts`
- Create: `test/e2e/logging/access-log.e2e.spec.ts`

**Interfaces:**

- Final attributes: `route`, `method`, `status`, `durationMs`.
- Route is `request.baseUrl + request.route.path`, health template or
  `unmatched`; never `originalUrl`, query or concrete parameter value.

- [ ] **Step 1: Write finish/close race table**

Assert one record for success, validation, guard rejection, 404, 500, aborted
socket and duplicate finish/close callbacks. Inject monotonic clock and reject
negative/non-finite durations.

- [ ] **Step 2: Verify RED**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/platform/logging/http-access-log.middleware.spec.ts test/unit/platform/logging/http-route-template.spec.ts
```

- [ ] **Step 3: Implement idempotent finalizer**

Attach listeners before `next()`, latch completion synchronously and remove the
other listener. Status determines level (`info` below 500, `error` at 500+) but
access record carries no stack/error object. Snapshot the valid inbound
trace/span identifiers into the finalizer closure while the HTTP span is active;
do not depend on ambient OTel context still being active at `finish`/`close`.

- [ ] **Step 4: Record HTTP metrics with finite attributes**

Increment count/error and duration histogram using method, route template and
status class only. The access finalizer and HTTP instrumentation share the same
pure route-template resolver; neither reads `originalUrl` or query.

- [ ] **Step 5: Prove expected 4xx and unknown 5xx log counts**

Expected 4xx: one access, zero stack records. Unknown 5xx: one access and one
`http_unhandled_error`, with matching request/trace IDs.

- [ ] **Step 6: Commit**

```bash
git add src/platform/logging src/platform/observability src/platform/http/bootstrap test/unit/platform/logging test/e2e/logging
git commit -m "feat(logging): add final request records"
```

## Task 8: Add typed security audit events to existing auth flows

**Files:**

- Create: `src/modules/auth/application/auth-audit.port.ts`
- Create: `src/platform/logging/auth-audit.logger.ts`
- Modify: `src/modules/auth/application/login.use-case.ts`
- Modify: `src/modules/auth/application/logout.use-case.ts`
- Modify: `src/modules/auth/application/logout-all.use-case.ts`
- Modify: `src/modules/auth/application/revoke-session.use-case.ts`
- Modify: `src/modules/auth/application/change-password.use-case.ts`
- Modify: `src/modules/auth/application/create-initial-admin.use-case.ts`
- Modify: `src/modules/auth/composition/auth.module.ts`
- Modify: `src/modules/auth/composition/initial-admin.module.ts`
- Modify: `src/bootstrap/admin/main.ts`
- Create: `test/unit/platform/logging/auth-audit.logger.spec.ts`
- Modify: `test/unit/modules/auth/application/login.use-case.spec.ts`
- Modify: `test/unit/modules/auth/application/change-password.use-case.spec.ts`
- Modify: `test/unit/modules/auth/application/session-management.spec.ts`
- Modify: `test/unit/bootstrap/admin/create-admin.cli.spec.ts`
- Modify: `test/integration/modules/auth/create-initial-admin.integration.spec.ts`
- Create: `test/e2e/logging/auth-audit.e2e.spec.ts`

**Interfaces:**

- Audit JSON has `kind=audit`, event/action/outcome/reasonCode and only
  contextually valid optional identifiers.
- `AuthAuditPort.emit()` is synchronous/non-throwing; implementation catches
  sink failures and increments an internal diagnostic counter.

- [ ] **Step 1: Write audit schema decision table**

Cover login success/failure/rate/dependency, logout, logout-all complete/
partial, revoke found/not-found, password success/denied/conflict/partial and
initial-admin success/conflict/failure. Reject unknown action/outcome/reason and
all forbidden fields.

- [ ] **Step 2: Verify RED in application tests**

Add mock port expectations before constructor changes. Assert ordering: durable
mutation completes before success audit; denied login never emits actorId/email;
partial Redis cleanup emits durable success with partial audit.

- [ ] **Step 3: Implement port and adapter**

Use cases emit finite events only. Logger adds request/trace context when active;
admin CLI event contains no request/trace/session. Role/status actions remain
schema-valid but have no producer until real mutation use cases exist.

- [ ] **Step 4: Verify no secret data**

Snapshot parsed JSON keys, not raw lines. Static scan rejects email/password/
token/IP/cookie/URL keys in audit contracts and fixtures.

- [ ] **Step 5: Verify and commit**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/modules/auth test/unit/platform/logging test/unit/bootstrap/admin
TESTCONTAINERS_REUSE_ENABLE=false corepack pnpm@11.15.1 exec jest --config jest.integration.config.mjs --runInBand test/integration/modules/auth/create-initial-admin.integration.spec.ts
corepack pnpm@11.15.1 exec jest --config jest.e2e.config.mjs --runInBand test/e2e/logging/auth-audit.e2e.spec.ts
git add src/modules/auth src/platform/logging src/bootstrap/admin test/unit/modules/auth test/unit/platform/logging test/unit/bootstrap/admin test/integration/modules/auth/create-initial-admin.integration.spec.ts test/e2e/logging
git commit -m "feat(auth): emit structured security audit events"
```

## Task 9: Start OpenTelemetry before instrumented imports and close it last

**Files:**

- Create: `src/bootstrap/observability/start-observability.ts`
- Create: `src/bootstrap/observability/observability-bootstrap.types.ts`
- Modify: `src/bootstrap/observability/README.md`
- Create: `src/platform/observability/observability.runtime.ts`
- Create: `src/platform/observability/otel-diag.logger.ts`
- Create: `src/platform/observability/sanitizing-span.exporter.ts`
- Create: `src/bootstrap/api/run-api.ts`
- Modify: `src/bootstrap/api/main.ts`
- Modify: `src/bootstrap/api/api-runtime.ts`
- Modify: `src/bootstrap/api/configure-api.ts`
- Modify: `src/platform/lifecycle/shutdown-registry.ts`
- Create: `test/unit/bootstrap/observability/start-observability.spec.ts`
- Create: `test/unit/platform/observability/observability.runtime.spec.ts`
- Create: `test/unit/platform/observability/sanitizing-span.exporter.spec.ts`
- Modify: `test/unit/bootstrap/api/api-runtime.spec.ts`
- Modify: `test/e2e/shutdown/graceful-shutdown.e2e.spec.ts`

**Interfaces:**

- `main.ts` statically imports only framework-free config/logging and
  observability bootstrap; it dynamically imports `run-api.js` after SDK start.
- OTel shutdown participant order 400 follows Redis 200 and PostgreSQL 300.

- [ ] **Step 1: Write import-order contract test**

Spawn compiled API with an instrumentation probe. Assert SDK start marker occurs
before loading Nest core, `http`, `pg` and `redis`; a static import of
`run-api/configure-api` from main fails the source contract.

- [ ] **Step 2: Write SDK configuration tests**

Assert service resource metadata, W3C propagation, BatchSpanProcessor through
NodeSDK, periodic metric reader, HTTP/protobuf exporters and disabled-mode no-op
runtime. Assert the span exporter wrapper applies an instrumentation-specific
allowlist to attributes and events before forwarding shallow immutable copies:
HTTP raw URL/query/headers/IP, SQL statement, Redis args/key and exception
message/stack are absent. OTel diag records are bounded safe Pino events without
exporter payloads.

- [ ] **Step 3: Verify RED**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/bootstrap/observability test/unit/platform/observability
```

- [ ] **Step 4: Implement pre-import bootstrap**

Register HTTP, pg and Redis instrumentations explicitly. Redis
`dbStatementSerializer` returns uppercase command name only. Pg enhanced
database reporting stays disabled. Wrap both OTLP and in-memory span exporters
with `SanitizingSpanExporter`; no test-only bypass is allowed. No collector
connection is attempted during readiness/startup checks.

Configure `HttpInstrumentation.responseHook` to resolve the route from
`ServerResponse.req` with the same pure helper used by access logging, set the
stable route attribute and update the server span name before the instrumentation
ends the span. Missing routes become `unmatched`; no response-listener ordering
assumption is used for span naming.

- [ ] **Step 5: Implement bounded lifecycle**

`close(signal)` shares one SDK shutdown promise and rejects if shared signal
wins. Register after database; preserve overall coordinator exit-1 semantics on
failed/non-settling shutdown.

- [ ] **Step 6: Verify shutdown and commit**

```bash
corepack pnpm@11.15.1 exec jest --config jest.e2e.config.mjs --runInBand test/e2e/shutdown
git add src/bootstrap/observability src/bootstrap/api src/platform/observability src/platform/lifecycle test/unit/bootstrap test/unit/platform/observability test/e2e/shutdown
git commit -m "feat(observability): initialize opentelemetry before api imports"
```

## Task 10: Instrument critical operations with low-cardinality metrics/spans

**Files:**

- Create: `src/shared/application/telemetry.port.ts`
- Create: `src/platform/observability/otel-telemetry.adapter.ts`
- Create: `src/platform/observability/runtime-metrics.ts`
- Modify: `src/modules/auth/application/login.use-case.ts`
- Modify: `src/modules/auth/application/authenticate-session.use-case.ts`
- Modify: `src/modules/auth/application/change-password.use-case.ts`
- Modify: `src/modules/auth/application/logout-all.use-case.ts`
- Modify: `src/modules/auth/application/revoke-session.use-case.ts`
- Modify: `src/modules/auth/composition/auth.module.ts`
- Modify: `src/platform/database/prisma-client.provider.ts`
- Modify: `src/platform/redis/redis-command.executor.ts`
- Modify: `src/platform/redis/redis-connection.registry.ts`
- Modify: `src/platform/redis/redis-cache.client.ts`
- Modify: `src/platform/redis/redis-cache.events.ts`
- Create: `test/unit/platform/observability/otel-telemetry.adapter.spec.ts`
- Create: `test/unit/platform/observability/runtime-metrics.spec.ts`
- Create: `test/unit/platform/database/prisma-client.provider.spec.ts`
- Modify: `test/unit/platform/redis/redis-command.executor.spec.ts`
- Modify: `test/unit/platform/redis/redis-connection.registry.spec.ts`
- Modify: `test/unit/platform/redis/redis-cache.client.spec.ts`
- Modify: `test/unit/modules/auth/application/login.use-case.spec.ts`
- Modify: `test/unit/modules/auth/application/authenticate-session.use-case.spec.ts`
- Modify: `test/unit/modules/auth/application/change-password.use-case.spec.ts`
- Modify: `test/unit/modules/auth/application/session-management.spec.ts`

**Interfaces:**

- Span names are fixed: `auth.login`, `auth.authenticate`,
  `auth.change_password`, `auth.logout_all`, `auth.revoke_session`.
- Metrics labels are finite enums: dependency/outcome, cache event, auth
  operation/outcome. IDs, keys and operationName strings are not labels.

- [ ] **Step 1: Write cardinality contract tests**

Attempt to pass arbitrary route, user, key and operation values; compile-time
fixtures and runtime validator reject them. Inspect exported metric points and
assert the exact allowlisted attribute keys/values.

- [ ] **Step 2: Write non-interference tests**

Exporter/metric adapter throws: auth/cache/database/Redis result remains owned
by the underlying operation. Telemetry diagnostic records the adapter failure
without recursively calling the failed metric path.

- [ ] **Step 3: Verify RED**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/platform/observability test/unit/modules/auth test/unit/platform/redis test/unit/platform/database
```

- [ ] **Step 4: Implement framework-free application port**

Auth use cases depend only on `TelemetryPort`. Adapter starts active spans,
marks failure without recording raw exception messages and records finite auth
outcomes.

- [ ] **Step 5: Add runtime metrics hooks**

Measure database/Redis latency and errors, Redis reconnects, cache hit/miss/
invalid/error and auth/rate-limit outcomes. Use monotonic durations and never
turn health/readiness into telemetry health.

- [ ] **Step 6: Verify and commit**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/platform/observability test/unit/modules/auth test/unit/platform/redis test/unit/platform/database
git add src/shared/application src/platform/observability src/platform/database src/platform/redis src/modules/auth test/unit
git commit -m "feat(observability): instrument runtime operations"
```

## Task 11: Prove correlation, privacy and collector isolation

**Files:**

- Create: `test/integration/platform/observability/telemetry-pipeline.integration.spec.ts`
- Create: `test/e2e/observability/correlation.e2e.spec.ts`
- Create: `test/e2e/observability/collector-outage.e2e.spec.ts`
- Create: `test/e2e/observability/privacy.e2e.spec.ts`
- Modify: `test/e2e/support/create-auth-test-runtime.ts`
- Modify: `test/e2e/support/spawn-built-api.ts`

**Interfaces:**

- Uses in-memory span/metric exporters for deterministic attribute inspection.
- Uses unreachable loopback OTLP endpoint for real exporter outage behavior.

- [ ] **Step 1: Write in-memory pipeline acceptance**

Issue request with valid `traceparent` and request ID. Assert response/log/
problem share request ID, logs contain active trace/span, root HTTP span uses
route template, child auth/pg/redis spans have the same trace, Redis statement
is command-only and metrics contain no forbidden attributes.

- [ ] **Step 2: Write privacy matrix**

Use password, cookie, CSRF token, database URL, Redis URL, query string and
secret-bearing thrown error. Search parsed logs and exported span/metric
attributes/events; none may contain raw fixtures. Assert specifically that
`url.full`, legacy `http.url`, request-target/query/header/IP attributes, SQL
statements, Redis arguments and exception event payloads are absent. Problem
body is constant and safe.

- [ ] **Step 3: Write collector outage process test**

Start compiled API with OTLP endpoint on an unused loopback port and short
export timeout. Assert startup/ready 200, request latency stays below configured
HTTP budget, readiness remains 200 after export attempts and shutdown settles
within global grace with documented exit result.

- [ ] **Step 4: Run acceptance suites**

```bash
TESTCONTAINERS_REUSE_ENABLE=false corepack pnpm@11.15.1 exec jest --config jest.integration.config.mjs --runInBand test/integration/platform/observability
TESTCONTAINERS_REUSE_ENABLE=false corepack pnpm@11.15.1 exec jest --config jest.e2e.config.mjs --runInBand test/e2e/problems test/e2e/logging test/e2e/observability
```

Expected: no skips, retries, sleeps, developer services or collector fallback.

- [ ] **Step 5: Commit**

```bash
git add test/integration/platform/observability test/e2e/observability test/e2e/support
git commit -m "test(observability): prove correlation and collector isolation"
```

## Task 12: Run cumulative gates and record execution evidence

**Files:**

- Modify: `README.md`
- Modify: `.env.example`
- Modify: `docs/architecture/runtime-lifecycle.md`
- Create: `docs/architecture/errors-logging-observability.md`
- Create: `docs/runbooks/telemetry-collector-loss.md`
- Create: `docs/execution/slice-04-errors-logging-observability.md`
- Modify: `jest.runtime-coverage.config.mjs` only if collected paths changed.

**Interfaces:**

- Produces: reproducible operator/developer documentation and exact exit
  evidence for Slice 4.

- [ ] **Step 1: Document runtime contracts**

Explain problem catalogue, request IDs, one-access-log rule, audit privacy,
OTEL standard env, explicit instrumentation set, collector-loss behavior and
ordered telemetry shutdown. Do not claim exporter requests, Redis commands or
Prisma queries are cancellable.

- [ ] **Step 2: Run frozen install and narrow real gates**

```bash
corepack pnpm@11.15.1 install --frozen-lockfile
corepack pnpm@11.15.1 check:quick
TESTCONTAINERS_REUSE_ENABLE=false corepack pnpm@11.15.1 exec jest --config jest.integration.config.mjs --runInBand test/integration/platform/observability test/integration/modules/auth test/integration/platform/redis test/integration/platform/database
TESTCONTAINERS_REUSE_ENABLE=false corepack pnpm@11.15.1 exec jest --config jest.e2e.config.mjs --runInBand test/e2e/problems test/e2e/logging test/e2e/observability test/e2e/auth test/e2e/health test/e2e/shutdown
```

- [ ] **Step 3: Run full cumulative gate**

```bash
TESTCONTAINERS_REUSE_ENABLE=false corepack pnpm@11.15.1 check
corepack pnpm@11.15.1 build
test -f dist/bootstrap/api/main.js
test -f dist/bootstrap/admin/main.js
```

Expected: all exit 0; global and existing auth coverage thresholds pass.

- [ ] **Step 4: Run static scope/privacy scans**

```bash
rg -n "nestjs-pino|pino-http|pino-pretty|auto-instrumentations|jsonwebtoken|passport|oauth|bullmq|ioredis" package.json src test
rg -n "originalUrl|req\.body|request\.body|req\.query|request\.query|headers:" src/platform/logging src/platform/observability
rg -n "userId|sessionId|email|redis.*key|url\.full" src/platform/observability
rg -n "(TO|FIX|HA)(DO|ME|CK)|\.skip\(|describe\.skip|it\.skip" src test docs
git diff --check
git status --short
```

Expected: forbidden packages/markers absent. Any identifier match in audit code
is reviewed as a log-only optional ID, never a metric attribute. No full
request/header/body/query serialization exists.

- [ ] **Step 5: Record exact evidence**

Execution report contains tested implementation SHA, Node/pnpm/package
versions, suite/test counts, coverage, problem matrix, log-count assertions,
redaction/privacy fixtures, trace topology, metric attribute allowlist,
collector outage latency/readiness and real SIGTERM result.

- [ ] **Step 6: Commit evidence**

```bash
git add README.md .env.example docs jest.runtime-coverage.config.mjs
git commit -m "docs(observability): record slice 4 evidence"
```

## Final review and exit evidence

- [ ] Re-read approved design sections 12–13 and map every rule to a plan task
      and executable test.
- [ ] Confirm `domain`/`application` have no Nest/Pino/OTel imports; auth uses
      framework-free audit/telemetry ports only.
- [ ] Confirm every problem definition is documented and every known auth code
      maps exhaustively.
- [ ] Confirm errors contain no raw values and unknown 5xx has one stack-bearing
      log plus one access record.
- [ ] Confirm every emitted JSON log has required base fields and redaction is
      applied centrally before stdout.
- [ ] Confirm no email/IP/password/token/cookie/URL/secret enters audit payload.
- [ ] Confirm HTTP metrics use route template and no IDs/keys/raw URLs become
      metric attributes.
- [ ] Confirm Redis spans contain command name only; pg enhanced reporting is
      disabled.
- [ ] Confirm collector is absent from health registry and outage does not turn
      readiness red or block requests.
- [ ] Confirm OTel starts before instrumented imports and closes after Redis/
      Prisma within the existing hard watchdog.
- [ ] Confirm every hand-written exported TypeScript contract has accurate
      TSDoc.
- [ ] Confirm frozen install, `pnpm check:quick`, full `pnpm check`, build,
      coverage and clean Git status on the reported implementation.
- [ ] Push `feat/errors-logging-observability`, create a regular PR into
      `stage`, copy concise evidence into PR and do not merge/deploy without a
      separate user request.

## Plan approval checkpoint

Implementation begins only after this plan is committed, published in a
regular PR to `stage`, merged, and explicitly approved for inline execution.
