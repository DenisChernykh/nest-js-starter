# NestJS Starter Redis Capabilities And Auth Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` inline task-by-task. This repository execution
> explicitly forbids subagents. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Добавить capability-based Redis infrastructure и production-grade
browser `auth-core` с opaque sessions, Argon2id, session-bound CSRF,
code-defined permissions и немедленной PostgreSQL-проверкой security state.

**Architecture:** `platform/redis` владеет соединениями, key namespace,
bounded commands, typed codecs, atomic scripts, health и shutdown, но не
предоставляет application-level `RedisService`. Модуль `auth` сохраняет
durable identity/credentials/roles/generation/epoch в PostgreSQL через Prisma
adapters, а coordination Redis использует как authoritative session/rate-limit
store. Presentation получает только application API, а все Redis/Prisma и
Argon2 details остаются в infrastructure.

**Tech Stack:** Node.js 24.18.0, pnpm 11.15.1, native TypeScript 7,
NestJS 11, Prisma 7, PostgreSQL 18, Redis 8.8, node-redis 6, node-argon2,
Jest 30, Testcontainers 12.

## Global Constraints

- Выполнять работу inline одним агентом; не использовать SDD, subagents или
  parallel agent work.
- Feature branch создаётся от актуального `stage`; изменения вливаются в
  `stage` обычным merge PR. `main` продвигается только fast-forward от `stage`.
- Перед package installation заново проверить official registry `latest`,
  engines и peers. Committed dependencies содержат только exact pins без
  `latest`, `^` и `~`.
- Если latest stable конфликтует с Node 24.18.0, NestJS 11, Prisma 7, native
  TypeScript 7 или compatibility TypeScript 6, остановиться для отдельного
  compatibility-решения; молчаливый downgrade запрещён.
- Первый dependency/rebaseline commit отделён от behavior commits и содержит
  только manifest, lockfile и проверяемую container version matrix.
- Сохранить module-local hexagonal boundaries из
  `docs/architecture/module-boundaries.md`. `domain` и `application` не
  импортируют NestJS, Prisma, Redis, HTTP, Argon2, Joi или OpenTelemetry.
- Не добавлять global application `RedisService`, generic repository/service/
  controller, demo CRUD, JWT, OAuth/OIDC, passkeys, MFA, service tokens,
  registration, email verification, password reset, queues или business logic.
- Coordination Redis обязателен и fail-closed. Cache connection остаётся lazy,
  не блокирует readiness и не открывается без module-owned cache adapter.
  Pub/Sub и queue connection в этом slice не открываются.
- Auth projection, credentials, roles, permissions, session tokens и account
  status не кэшируются.
- Raw session token существует только в browser cookie. Redis key использует
  HMAC-SHA256 digest; CSRF использует отдельный HMAC secret.
- Password hashing — Argon2id с `memoryCost=19456`, `timeCost=2`,
  `parallelism=1`, `hashLength=32`; salt генерирует библиотека.
- Browser topology — same-site trusted origins. Production cookie:
  `__Host-session`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, без
  `Domain`.
- Unsafe cookie-authenticated requests требуют exact trusted Origin/Referer,
  запрет `Sec-Fetch-Site: cross-site`, JSON content type и constant-time
  session-bound CSRF. Login освобождён только от session token requirement.
- Session idle timeout по умолчанию 7 дней, absolute timeout 30 дней;
  absolute deadline не сдвигается. Touch атомарно ограничивает TTL значением
  `min(idleRemaining, absoluteRemaining)`.
- Смена пароля и logout-all сначала увеличивают `sessionGeneration` в той же
  PostgreSQL transaction, что durable change, и только затем best-effort
  удаляют Redis records. Частичная Redis-очистка не возвращает старым sessions
  валидность.
- `globalSessionEpoch` хранится в единственной строке
  `AuthSecurityState`. Отсутствие, дублирование или неверный singleton ID
  заставляет auth fail closed.
- Security-critical Redis commands используют `disableOfflineQueue: true`,
  bounded command deadlines и socket destruction после in-flight deadline.
  node-redis command timeout до записи в socket нельзя описывать как
  cancellation уже отправленной команды.
- Slice 3 принимает один standalone coordination Redis endpoint и не заявляет
  Redis Cluster support. Multi-key Lua atomicity проверяется на этой явно
  задокументированной topology; переход на Cluster потребует отдельного key-slot
  design review.
- Graceful shutdown закрывает subscriber/command Redis connections перед
  Prisma. Non-settling cleanup означает exit 1; hard watchdog остаётся
  process-level последней границей.
- Все hand-written exported TypeScript contracts получают TSDoc по
  `docs/architecture/tsdoc-guidelines.md` в том же commit.
- Slice 4 владеет окончательным RFC 9457/Pino/OTel mapping. Этот slice создаёт
  framework-free auth error codes и временный безопасный presentation mapping,
  не раскрывающий Prisma/Redis/Argon2 errors.
- `pnpm check:quick` остаётся cumulative gate. Полный `pnpm check`, реальные
  PostgreSQL/Redis, multi-instance e2e и coverage обязательны перед PR.
- Global coverage: statements/functions/lines не ниже 80%, branches не ниже
  75%. Auth/session/permission branches не ниже 90%, а security decision
  tables покрывают все перечисленные исходы.

---

## Зафиксированный planning snapshot на 2026-07-21

Snapshot нужен для review плана, но Task 0 обязан повторить запросы перед
installation.

| Capability              |                                                          Stable candidate | Registry/official evidence                              |
| ----------------------- | ------------------------------------------------------------------------: | ------------------------------------------------------- |
| `redis`                 |                                                                   `6.1.0` | npm `latest`; Node engine `>=20.0.0`                    |
| `argon2`                |                                                                  `0.45.0` | npm `latest`; `1.0.0-alpha.1` исключён                  |
| `cookie-parser`         |                                                                   `1.4.7` | npm `latest`                                            |
| `@types/cookie-parser`  |                                                                  `1.4.10` | npm `latest`; Express peer unrestricted                 |
| `@testcontainers/redis` |                                                                  `12.0.4` | npm `latest`, совпадает с PostgreSQL package            |
| Redis server            |                                                            `8.8.0-trixie` | official Redis GA 8.8.0                                 |
| Redis image             | `sha256:234c902a2db49461a129e2d4aeff85b28cf20187ed274a67f6e50995fa713c7b` | official multi-arch OCI index, включая amd64 и arm64/v8 |

`@nestjs/throttler`, Passport и JWT packages не добавляются. Login limiter
должен быть атомарным между instances и реализуется module-owned Redis adapter
через reviewed Lua script.

## Граница результата

После slice доступны:

- `POST /v1/auth/login`;
- `POST /v1/auth/logout`;
- `GET /v1/auth/me`;
- `GET /v1/auth/csrf`;
- `PUT /v1/auth/password`;
- `GET /v1/auth/sessions`;
- `DELETE /v1/auth/sessions/:sessionId`;
- `DELETE /v1/auth/sessions` для logout-all;
- `pnpm auth:create-admin -- --email admin@example.com`, где пароль читается
  только из TTY/stdin;
- required coordination Redis health/startup/shutdown;
- lazy cache mechanics, доказанные test-only fixture module;
- default-authenticated HTTP policy и typed permission guard.

Не входят registration, password reset, email verification, dynamic role
editor, account administration HTTP API, JWT, Swagger protection, final RFC
9457 filter, audit/Pino/OTel и deployment Redis provisioning.

## Нормативные contracts

### Redis platform

```ts
export type RedisCapability = 'coordination' | 'cache' | 'pubsub'

export interface RedisCodec<T> {
  encode(value: T): string
  decode(payload: string): T | undefined
}

export interface RedisCommandClient {
  sendCommand<T>(command: readonly string[]): Promise<T>
}

export interface RedisCommandExecutor {
  execute<T>(
    operationName: string,
    operation: (client: RedisCommandClient) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>
}

export interface CacheEntryPolicy {
  readonly ttlMs: number
  readonly jitterRatio: number
}
```

`RedisClientType` не экспортируется за пределы `platform/redis`; executor
принимает только platform-owned narrowed `RedisCommandClient`.

Key format:

```text
nest-js-starter:<environment>:<capability>:v<schema>:<resource>:<id>
```

Runtime paths не используют `KEYS`, logical database numbers, unbounded keys,
unchecked JSON casts или offline queue.

### Auth application

```ts
declare const permissionKeyBrand: unique symbol
export type PermissionKey = string & { readonly [permissionKeyBrand]: true }

export interface AuthenticatedPrincipal {
  readonly userId: string
  readonly sessionId: string
  readonly normalizedEmail: string
  readonly roleKeys: readonly string[]
  readonly permissions: ReadonlySet<PermissionKey>
}

export interface IssuedBrowserSession {
  readonly rawToken: string
  readonly publicId: string
  readonly csrfToken: string
  readonly absoluteExpiresAt: Date
}

export type AuthFailureCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHENTICATION_FAILED'
  | 'AUTHORIZATION_DENIED'
  | 'AUTH_DEPENDENCY_UNAVAILABLE'
  | 'AUTH_RATE_LIMITED'
  | 'AUTH_SESSION_NOT_FOUND'
  | 'AUTH_STATE_CONFLICT'
  | 'AUTH_CSRF_REJECTED'
```

No application contract returns Prisma models, Redis payloads, password hashes
or raw infrastructure errors.

### Durable model

```prisma
enum UserStatus {
  ACTIVE
  DISABLED
}

model User {
  id                String             @id @default(uuid()) @db.Uuid
  email             String
  normalizedEmail   String             @unique @map("normalized_email")
  status            UserStatus         @default(ACTIVE)
  sessionGeneration BigInt             @default(0) @map("session_generation")
  createdAt         DateTime           @default(now()) @map("created_at")
  updatedAt         DateTime           @updatedAt @map("updated_at")
  credential        PasswordCredential?
  roles             UserRole[]

  @@map("users")
}

model PasswordCredential {
  userId       String   @id @map("user_id") @db.Uuid
  passwordHash String   @map("password_hash")
  version      Int      @default(0)
  updatedAt    DateTime @updatedAt @map("updated_at")
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("password_credentials")
}

model UserRole {
  userId    String   @map("user_id") @db.Uuid
  roleKey   String   @map("role_key")
  createdAt DateTime @default(now()) @map("created_at")
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, roleKey])
  @@map("user_roles")
}

model AuthSecurityState {
  id                        Int      @id
  globalSessionEpoch        BigInt   @default(0) @map("global_session_epoch")
  adminBootstrapCompletedAt DateTime? @map("admin_bootstrap_completed_at")
  updatedAt                 DateTime @updatedAt @map("updated_at")

  @@map("auth_security_state")
}
```

Migration manually adds `CHECK (id = 1)` and inserts exactly `(id = 1)` in the
same transaction. Repository reads `findUnique({ where: { id: 1 } })` and
treats absence as integrity failure.

### Session record

```ts
export interface StoredSessionRecord {
  readonly schema: 1
  readonly publicId: string
  readonly userId: string
  readonly sessionGeneration: string
  readonly globalSessionEpoch: string
  readonly csrfSeed: string
  readonly createdAtMs: number
  readonly lastSeenAtMs: number
  readonly absoluteExpiresAtMs: number
  readonly deviceLabel: string
  readonly networkFingerprint: string
}
```

BigInt values сериализуются как canonical decimal strings. Codec отклоняет
неизвестные keys, неправильный schema/version, некорректные UUID/base64url,
negative timestamps и `absoluteExpiresAtMs <= createdAtMs`.

## Task 0: Повторить preflight и создать execution branch

**Files:** none

**Interfaces:**

- Consumes: clean `stage` containing merge `350c046` or its later
  fast-forward successor.
- Produces: clean `feat/redis-auth-core` and refreshed version evidence.

- [ ] **Step 1: Verify repository topology and clean state**

Run:

```bash
git fetch --prune origin
git switch stage
git merge --ff-only origin/stage
git status --short --branch
git merge-base --is-ancestor origin/main stage
```

Expected: clean `stage`, no divergence, last command exits 0. If remote SSH is
interrupted, verify `gh auth status`, `gh repo view` and repeat one read-only
`git ls-remote` before changing transport.

- [ ] **Step 2: Refresh registry metadata**

Run for every candidate:

```bash
npm view redis version engines peerDependencies dist-tags --json
npm view argon2 version engines peerDependencies dist-tags --json
npm view cookie-parser version engines peerDependencies dist-tags --json
npm view @types/cookie-parser version engines peerDependencies dist-tags --json
npm view @testcontainers/redis version engines peerDependencies dist-tags --json
```

Expected: stable `latest`, no incompatible Node/Nest/TypeScript peer. Resolve
official Redis GA and inspect its digest-qualified multi-arch image. Record any
change from the planning snapshot before installation.

- [ ] **Step 3: Activate exact repository toolchain**

Run:

```bash
source /Users/denischernykh/.nvm/nvm.sh
nvm use 24.18.0
node --version
corepack pnpm@11.15.1 --version
```

Expected: `v24.18.0` and `11.15.1`; global default remains unchanged.

- [ ] **Step 4: Create the execution branch**

Run:

```bash
git switch -c feat/redis-auth-core
```

Expected: branch starts exactly from updated `stage`.

## Task 1: Pin Redis/auth dependencies and local Redis image

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Create: `test/integration/support/redis-image.ts`
- Create: `test/integration/support/redis-container.ts`

**Interfaces:**

- Consumes: refreshed Task 0 version matrix.
- Produces: exact packages, one digest-qualified local coordination Redis and
  reusable isolated Testcontainers Redis helper.

- [ ] **Step 1: Add exact package pins**

Run with refreshed versions substituted only when registry evidence changed:

```bash
corepack pnpm@11.15.1 add --save-exact redis@6.1.0 argon2@0.45.0 cookie-parser@1.4.7
corepack pnpm@11.15.1 add --save-dev --save-exact @types/cookie-parser@1.4.10 @testcontainers/redis@12.0.4
```

Expected: manifest contains plain versions; lockfile contains one coherent
node-redis/Testcontainers graph.

- [ ] **Step 2: Pin the Redis image and local security policy**

Use this exact image unless Task 0 produced a reviewed replacement:

```yaml
image: redis:8.8.0-trixie@sha256:234c902a2db49461a129e2d4aeff85b28cf20187ed274a67f6e50995fa713c7b
command:
  - redis-server
  - --appendonly
  - 'yes'
  - --appendfsync
  - always
  - --maxmemory-policy
  - noeviction
  - --requirepass
  - local-development-only
```

Expose `${REDIS_PORT:-6379}:6379`, add a password-authenticated healthcheck and
retain a named coordination volume. `.env.example` uses
`redis://default:local-development-only@127.0.0.1:6379` and documents
`REDIS_CACHE_URL` as optional and normally separate in production.

- [ ] **Step 3: Add a non-reused Redis test helper**

`redis-image.ts` exports the full digest string. `redis-container.ts` starts a
fresh password-protected container, waits for authenticated `PING`, returns a
redacted URL factory and closes in `afterAll`; it never falls back to a local
developer Redis and never enables reuse.

- [ ] **Step 4: Verify dependency-only baseline**

Run:

```bash
corepack pnpm@11.15.1 install --frozen-lockfile
corepack pnpm@11.15.1 toolchain:check
docker compose config
corepack pnpm@11.15.1 check:quick
```

Expected: all commands exit 0 and no source behavior changed.

- [ ] **Step 5: Commit the reviewable baseline**

```bash
git add package.json pnpm-lock.yaml docker-compose.yml .env.example test/integration/support/redis-image.ts test/integration/support/redis-container.ts
git commit -m "chore(deps): pin redis auth capability baseline"
```

## Task 2: Extend typed config for Redis and browser auth

**Files:**

- Modify: `src/platform/config/runtime-config.types.ts`
- Modify: `src/platform/config/runtime-environment.schema.ts`
- Modify: `src/platform/config/runtime-config.service.ts`
- Modify: `test/unit/platform/config/runtime-environment.spec.ts`
- Modify: `test/unit/platform/config/runtime-config.service.spec.ts`
- Modify: `.env.example`

**Interfaces:**

- Consumes: single Joi environment schema and `RuntimeConfigService`.
- Produces: immutable `RedisRuntimeConfig` and `AuthRuntimeConfig`; no consumer
  gets raw `ConfigService`.

- [ ] **Step 1: Write failing config decision tables**

Cover valid `redis://` and `rediss://` URLs, ACL username/password, rejection of
fragments and production logical DB numbers, missing coordination URL, distinct
32-byte base64url secrets, timeout bounds, idle <= absolute timeout, production
cookie invariants and exact CSRF origins. Assert validation errors contain only
key paths/rules and never secret values.

- [ ] **Step 2: Run the narrow test and observe RED**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/platform/config/runtime-environment.spec.ts test/unit/platform/config/runtime-config.service.spec.ts
```

Expected: failures identify absent Redis/auth environment contracts.

- [ ] **Step 3: Implement immutable config contracts**

Add exact groups:

```ts
export interface RedisRuntimeConfig {
  readonly coordinationUrl: string
  readonly cacheUrl?: string
  readonly connectTimeoutMs: number
  readonly commandTimeoutMs: number
  readonly healthTimeoutMs: number
  readonly shutdownTimeoutMs: number
  readonly keyPrefix: string
}

export interface AuthRuntimeConfig {
  readonly sessionCookieName: string
  readonly secureCookie: boolean
  readonly sessionIdleTimeoutMs: number
  readonly sessionAbsoluteTimeoutMs: number
  readonly sessionTouchIntervalMs: number
  readonly sessionKeySecret: Uint8Array
  readonly csrfSecret: Uint8Array
  readonly rateLimitKeySecret: Uint8Array
  readonly networkMetadataSecret: Uint8Array
  readonly csrfOrigins: readonly string[]
  readonly loginIpLimit: number
  readonly loginAccountLimit: number
  readonly loginWindowMs: number
}
```

Decode secrets once into owned `Uint8Array` copies. Production requires
`__Host-session` and secure cookie; development defaults to
`nest-js-starter-session` and non-secure cookie. Reject equal secret byte
sequences, not only equal encoded strings.

- [ ] **Step 4: Re-run unit config tests and quick config-adjacent gates**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/platform/config/runtime-environment.spec.ts test/unit/platform/config/runtime-config.service.spec.ts
corepack pnpm@11.15.1 typecheck
```

Expected: PASS and no secret appears in `safeSummary`.

- [ ] **Step 5: Commit**

```bash
git add src/platform/config .env.example test/unit/platform/config
git commit -m "feat(config): validate redis and browser auth settings"
```

## Task 3: Implement capability-managed Redis lifecycle

**Files:**

- Create: `src/platform/redis/redis-capability.ts`
- Create: `src/platform/redis/redis-client.factory.ts`
- Create: `src/platform/redis/redis-command.executor.ts`
- Create: `src/platform/redis/redis-connection.registry.ts`
- Create: `src/platform/redis/redis-readiness.indicator.ts`
- Create: `src/platform/redis/redis-lifecycle.ts`
- Create: `src/platform/redis/redis.module.ts`
- Create: `src/platform/redis/redis.tokens.ts`
- Modify: `src/platform/redis/README.md`
- Create: `test/unit/platform/redis/redis-client.factory.spec.ts`
- Create: `test/unit/platform/redis/redis-command.executor.spec.ts`
- Create: `test/unit/platform/redis/redis-connection.registry.spec.ts`
- Create: `test/integration/platform/redis/redis-lifecycle.integration.spec.ts`

**Interfaces:**

- Consumes: typed Redis config, `ReadinessIndicator`,
  `ShutdownParticipant`, `ActiveOperationTracker`.
- Produces: eager coordination command client, lazy cache client, bounded
  executor, required readiness indicator and Redis shutdown participant.

- [ ] **Step 1: Write lifecycle and failure tests first**

Unit tests assert one client per registered capability, duplicate registration
rejected, cache not connected until first adapter operation, `error` listener
installed before connect, `disableOfflineQueue: true`, bounded connect/command/
shutdown, and timeout-triggered `destroy()`. Integration tests prove ACL URL,
PING, disconnect failure, reconnect and close idempotency against real Redis.

- [ ] **Step 2: Run RED tests**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/platform/redis
corepack pnpm@11.15.1 exec jest --config jest.integration.config.mjs --runInBand test/integration/platform/redis/redis-lifecycle.integration.spec.ts
```

Expected: missing platform contracts.

- [ ] **Step 3: Implement client factory and bounded executor**

The factory maps `rediss:` to `socket.tls=true`, preserves ACL username/password,
sets connect timeout/reconnect strategy, queue cap and global node-redis command
timeout. The executor additionally owns an absolute operation deadline. When an
already-written command outlives it, it destroys that capability client and
returns a stable dependency failure; it never claims command cancellation.

- [ ] **Step 4: Implement registry semantics**

Registration is open only during composition, then sealed. Coordination is
required/eager. Cache registration without `REDIS_CACHE_URL` is a startup
configuration error, but no cache registration leaves the URL unnecessary and
never creates a client. `pubsub` can only create a dedicated `duplicate()`
subscriber; this slice tests the primitive but does not register a production
subscriber.

- [ ] **Step 5: Implement readiness and shutdown**

Readiness checks `isReady` and then bounded `PING`; coordination has
`required=true`. Shutdown order is `REDIS_SHUTDOWN_ORDER = 200`, before existing
`DATABASE_SHUTDOWN_ORDER = 300`. Attempt `close()` within its budget, then
`destroy()` and reject cleanup when the graceful close does not settle.

- [ ] **Step 6: Run GREEN tests and architecture gate**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/platform/redis
corepack pnpm@11.15.1 exec jest --config jest.integration.config.mjs --runInBand test/integration/platform/redis/redis-lifecycle.integration.spec.ts
corepack pnpm@11.15.1 architecture:check
```

Expected: real Redis lifecycle passes and no raw `redis` import exists outside
`src/platform/redis` and Redis test support.

- [ ] **Step 7: Commit**

```bash
git add src/platform/redis test/unit/platform/redis test/integration/platform/redis
git commit -m "feat(redis): add capability-managed connections"
```

## Task 4: Add namespaced keys, typed cache and atomic scripts

**Files:**

- Create: `src/platform/redis/redis-key.builder.ts`
- Create: `src/platform/redis/redis-codec.ts`
- Create: `src/platform/redis/redis-script.runner.ts`
- Create: `src/platform/redis/redis-cache.client.ts`
- Create: `src/platform/redis/redis-cache.events.ts`
- Create: `test/unit/platform/redis/redis-key.builder.spec.ts`
- Create: `test/unit/platform/redis/redis-cache.client.spec.ts`
- Create: `test/integration/platform/redis/redis-script.runner.integration.spec.ts`
- Create: `test/fixtures/cache-module/application/catalog-cache.port.ts`
- Create: `test/fixtures/cache-module/application/catalog-query.ts`
- Create: `test/fixtures/cache-module/infrastructure/redis-catalog-cache.adapter.ts`
- Create: `test/integration/fixtures/cache-module/cache-contract.integration.spec.ts`

**Interfaces:**

- Consumes: lazy cache executor and module-owned port.
- Produces: validated cache-aside mechanics and script runner; no production
  fake business module under `src`.

- [ ] **Step 1: Write key/codec/cache contract tests**

Assert namespace/schema/resource validation, bounded TTL, deterministic injected
jitter, no indefinite entries, invalid payload deletion + miss event, network
failure fallback, and no unchecked cast. Fixture uses an immutable catalog read
model only inside `test/fixtures`; it is not starter runtime business logic.

- [ ] **Step 2: Write post-commit invalidation test**

The fixture query performs cache-aside. Its write service runs durable work via
`TransactionPort.run()` and invokes exact-key invalidation only after the
promise resolves. A forced rollback must leave cached data untouched; a commit
must invalidate before the test's next read.

- [ ] **Step 3: Run RED tests**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/platform/redis/redis-key.builder.spec.ts test/unit/platform/redis/redis-cache.client.spec.ts
corepack pnpm@11.15.1 exec jest --config jest.integration.config.mjs --runInBand test/integration/platform/redis/redis-script.runner.integration.spec.ts test/integration/fixtures/cache-module/cache-contract.integration.spec.ts
```

- [ ] **Step 4: Implement exact mechanics**

`RedisKeyBuilder` rejects empty/colon/brace-containing segments. Cache client
requires codec + `ttlMs` + `jitterRatio` in `[0, 0.25]`, emits typed in-process
events (`hit`, `miss`, `invalid`, `error`, `write`, `invalidate`) for later OTel
binding and bypasses failures. Script runner registers named SHA-backed scripts,
passes only explicit keys/arguments and rejects zero-key or duplicate names.

- [ ] **Step 5: Run GREEN tests and dependency scan**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/platform/redis
corepack pnpm@11.15.1 exec jest --config jest.integration.config.mjs --runInBand test/integration/platform/redis test/integration/fixtures/cache-module
rg -n "\\bKEYS\\b|as unknown as|RedisService" src test/fixtures/cache-module
```

Expected: tests pass; scan returns no runtime `KEYS`, unchecked deserialization
or global application Redis abstraction.

- [ ] **Step 6: Commit**

```bash
git add src/platform/redis test/unit/platform/redis test/integration/platform/redis test/fixtures/cache-module test/integration/fixtures/cache-module
git commit -m "feat(redis): add typed cache and atomic primitives"
```

## Task 5: Add durable auth schema and Prisma adapters

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_auth_core/migration.sql`
- Create: `src/modules/auth/domain/user-status.ts`
- Create: `src/modules/auth/application/auth-persistence.port.ts`
- Create: `src/modules/auth/application/auth.types.ts`
- Create: `src/modules/auth/infrastructure/prisma-auth.repository.ts`
- Create: `src/modules/auth/infrastructure/prisma-auth.mapper.ts`
- Create: `test/unit/modules/auth/infrastructure/prisma-auth.mapper.spec.ts`
- Create: `test/integration/modules/auth/prisma-auth.repository.integration.spec.ts`
- Modify: `test/integration/platform/database/migration-from-empty.integration.spec.ts`

**Interfaces:**

- Consumes: Prisma transaction context and `TransactionPort`.
- Produces: credential snapshot, request auth projection, global epoch,
  generation increments, conditional password replacement and one-shot admin
  bootstrap operations without leaking Prisma types.

- [ ] **Step 1: Write failing repository contract tests**

Cover normalized-email uniqueness, original email retention, disabled status,
ordered role keys, unknown role preservation for fail-closed application policy,
singleton absence, conditional password version conflict, generation increment,
admin bootstrap one-shot concurrency and migration-from-empty singleton creation.

- [ ] **Step 2: Run RED integration tests**

```bash
corepack pnpm@11.15.1 prisma:generate
corepack pnpm@11.15.1 exec jest --config jest.integration.config.mjs --runInBand test/integration/modules/auth/prisma-auth.repository.integration.spec.ts test/integration/platform/database/migration-from-empty.integration.spec.ts
```

- [ ] **Step 3: Add schema and reviewed migration**

Implement the normative Prisma models above. Generate a create-only migration,
review SQL, add `CHECK (id = 1)`, and insert the singleton within the migration
transaction. Do not edit the already applied baseline migration.

- [ ] **Step 4: Implement repository ports and adapters**

Application snapshots contain strings/Date/BigInt only. Repository uses
`PrismaTransactionContext.withClient()` so it joins existing use-case
transactions. One-shot admin creation locks singleton row, checks
`adminBootstrapCompletedAt IS NULL`, creates user/credential/explicit
`system.admin` role and sets completion timestamp atomically.

- [ ] **Step 5: Run GREEN tests and boundary scans**

```bash
corepack pnpm@11.15.1 prisma:validate
corepack pnpm@11.15.1 prisma:generate
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/modules/auth/infrastructure/prisma-auth.mapper.spec.ts
corepack pnpm@11.15.1 exec jest --config jest.integration.config.mjs --runInBand test/integration/modules/auth/prisma-auth.repository.integration.spec.ts test/integration/platform/database/migration-from-empty.integration.spec.ts
corepack pnpm@11.15.1 architecture:check
```

- [ ] **Step 6: Commit**

```bash
git add prisma src/modules/auth/domain src/modules/auth/application src/modules/auth/infrastructure test/unit/modules/auth test/integration/modules/auth test/integration/platform/database/migration-from-empty.integration.spec.ts
git commit -m "feat(auth): add durable identity and security state"
```

## Task 6: Implement credentials and code-defined authorization

**Files:**

- Create: `src/modules/auth/application/password-hasher.port.ts`
- Create: `src/modules/auth/application/permission.ts`
- Create: `src/modules/auth/application/role-registry.ts`
- Create: `src/modules/auth/application/auth-errors.ts`
- Create: `src/modules/auth/infrastructure/argon2-password.hasher.ts`
- Create: `src/modules/auth/infrastructure/node-auth-crypto.adapter.ts`
- Create: `test/unit/modules/auth/application/role-registry.spec.ts`
- Create: `test/unit/modules/auth/infrastructure/argon2-password.hasher.spec.ts`
- Create: `test/unit/modules/auth/infrastructure/node-auth-crypto.adapter.spec.ts`

**Interfaces:**

- Consumes: exact Argon2 parameters and Node crypto.
- Produces: `PasswordHasherPort`, branded `PermissionKey`, duplicate-safe role
  registry, opaque token/HMAC/constant-time helpers.

- [ ] **Step 1: Write security decision tables**

Role tests cover duplicate permission/role keys, unknown assigned role,
disabled user, no wildcard, deterministic sorted result and explicit admin
permissions including `system.docs.read`. Password tests cover match/mismatch,
malformed PHC, weaker hash rehash, configured hash no rehash and library error
mapping without password/hash in messages.

- [ ] **Step 2: Run RED tests**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/modules/auth/application test/unit/modules/auth/infrastructure/argon2-password.hasher.spec.ts test/unit/modules/auth/infrastructure/node-auth-crypto.adapter.spec.ts
```

- [ ] **Step 3: Implement branded permissions and role registry**

Export `definePermissions<const T extends readonly string[]>(keys: T)` from the
auth public API. It validates canonical dot-separated lowercase keys at startup
and returns branded literals. Define `system.admin` with an explicit immutable
list; no wildcard or implicit superuser branch exists. Unknown database role
throws `UnknownRoleAssignmentError` and authentication fails closed.

- [ ] **Step 4: Implement Argon2 and crypto adapters**

Hash with exact normative parameters and `argon2id`. `verify()` mismatch and a
valid non-matching hash map to `false`; malformed/internal errors become stable
infrastructure failures. Generate session tokens with 32 random bytes encoded
base64url, public/session CSRF IDs with independent random bytes, HMAC with
separate keys and compare equal-length decoded bytes via `timingSafeEqual`.

- [ ] **Step 5: Run GREEN tests and commit**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/modules/auth/application test/unit/modules/auth/infrastructure
git add src/modules/auth test/unit/modules/auth
git commit -m "feat(auth): add credentials and authorization policies"
```

## Task 7: Implement opaque session store and login rate limiter

**Files:**

- Create: `src/modules/auth/application/session-store.port.ts`
- Create: `src/modules/auth/application/login-rate-limiter.port.ts`
- Create: `src/modules/auth/infrastructure/session-record.codec.ts`
- Create: `src/modules/auth/infrastructure/redis-session.scripts.ts`
- Create: `src/modules/auth/infrastructure/redis-session.store.ts`
- Create: `src/modules/auth/infrastructure/redis-login-rate-limiter.ts`
- Create: `test/unit/modules/auth/infrastructure/session-record.codec.spec.ts`
- Create: `test/integration/modules/auth/redis-session.store.integration.spec.ts`
- Create: `test/integration/modules/auth/redis-login-rate-limiter.integration.spec.ts`

**Interfaces:**

- Consumes: coordination script runner, key builder, crypto adapter, config.
- Produces: create/read/touch/list/revoke-one/revoke-all session operations and
  atomic two-bucket login limiter.

- [ ] **Step 1: Write codec and real Redis tests**

Cover token digest lookup, raw token absence in keys/values, TTL bounds,
absolute expiry, throttled lastSeen touch, user ownership, current-session
marking, idempotent revoke, revoke-all, invalid payload fail-closed, concurrent
touch/revoke and Redis outage. Assert every temporary key has TTL.

- [ ] **Step 2: Write rate-limit atomicity tests**

Run concurrent attempts from two adapter instances. Both IP and normalized
account buckets are HMAC-keyed, incremented in one Lua script and get TTL on
first write. Any exceeded bucket denies with bounded retry-after. Redis failure
returns dependency unavailable, never allow.

- [ ] **Step 3: Run RED tests**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/modules/auth/infrastructure/session-record.codec.spec.ts
corepack pnpm@11.15.1 exec jest --config jest.integration.config.mjs --runInBand test/integration/modules/auth/redis-session.store.integration.spec.ts test/integration/modules/auth/redis-login-rate-limiter.integration.spec.ts
```

- [ ] **Step 4: Implement reviewed Lua scripts**

Define separate named scripts for create, touch, revoke-one and revoke-all.
Scripts receive exact keys; they do not scan or call `KEYS`. Create writes
session + user public-ID index atomically. Touch refuses expired absolute
deadline and updates record/TTL together. Revoke-one validates user ownership.
Revoke-all deletes only members from the owned index and then the index itself.

- [ ] **Step 5: Run GREEN tests and commit**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/modules/auth/infrastructure/session-record.codec.spec.ts
corepack pnpm@11.15.1 exec jest --config jest.integration.config.mjs --runInBand test/integration/modules/auth/redis-session.store.integration.spec.ts test/integration/modules/auth/redis-login-rate-limiter.integration.spec.ts
git add src/modules/auth test/unit/modules/auth test/integration/modules/auth
git commit -m "feat(auth): add opaque redis session storage"
```

## Task 8: Implement authentication and session-management use cases

**Files:**

- Create: `src/modules/auth/application/login.use-case.ts`
- Create: `src/modules/auth/application/authenticate-session.use-case.ts`
- Create: `src/modules/auth/application/logout.use-case.ts`
- Create: `src/modules/auth/application/get-me.query.ts`
- Create: `src/modules/auth/application/get-csrf-token.query.ts`
- Create: `src/modules/auth/application/list-sessions.query.ts`
- Create: `src/modules/auth/application/revoke-session.use-case.ts`
- Create: `src/modules/auth/application/logout-all.use-case.ts`
- Create: `src/modules/auth/application/change-password.use-case.ts`
- Create: `src/modules/auth/application/index.ts`
- Create: `src/modules/auth/index.ts`
- Create: `test/unit/modules/auth/application/*.spec.ts`

**Interfaces:**

- Consumes: persistence, password, rate-limit, session and transaction ports.
- Produces: framework-free public auth API consumed by presentation and future
  modules.

- [ ] **Step 1: Write table-driven use-case tests**

Cover missing account and wrong password identical result, dummy hash call,
disabled user, rehash CAS success/conflict, stale generation race, epoch
integrity failure, Redis failure, rate limit, session issue, every request
projection refresh, unknown role fail-closed, revoke semantics and dependency
error redaction.

- [ ] **Step 2: Write password/logout-all ordering tests**

Assert hash work occurs outside DB transaction; conditional credential update
and generation increment occur together; Redis cleanup starts only after commit.
Rollback performs no cleanup. Cleanup failure after commit still returns a
durably invalidated result and marks cleanup incomplete through a typed event.

- [ ] **Step 3: Run RED tests**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/modules/auth/application
```

- [ ] **Step 4: Implement login sequence exactly**

Normalize email without changing password; evaluate both limiter buckets;
load credential snapshot; verify real or constant dummy hash; return the same
`AUTHENTICATION_FAILED` for missing/wrong/disabled; conditionally rehash; read
epoch; issue Redis session using snapshot generation. Never set a cookie inside
the use case.

- [ ] **Step 5: Implement request authentication exactly**

Read/touch Redis record; load fresh PostgreSQL projection; compare status,
generation and epoch; resolve roles/permissions; return immutable principal.
Any dependency, malformed session, unknown role or singleton integrity failure
is fail-closed. Auth projection is never cached.

- [ ] **Step 6: Run GREEN tests, public API and TSDoc checks**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/modules/auth/application
corepack pnpm@11.15.1 lint
corepack pnpm@11.15.1 architecture:check
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/auth test/unit/modules/auth
git commit -m "feat(auth): add browser authentication use cases"
```

## Task 9: Add default-authenticated HTTP, CSRF and browser endpoints

**Files:**

- Create: `src/platform/http/policy/public-endpoint.decorator.ts`
- Modify: `src/platform/http/health/health.controller.ts`
- Create: `src/modules/auth/presentation/auth-request.context.ts`
- Create: `src/modules/auth/presentation/authentication.guard.ts`
- Create: `src/modules/auth/presentation/permission.guard.ts`
- Create: `src/modules/auth/presentation/require-permission.decorator.ts`
- Create: `src/modules/auth/presentation/browser-origin.guard.ts`
- Create: `src/modules/auth/presentation/session-csrf.guard.ts`
- Create: `src/modules/auth/presentation/auth.controller.ts`
- Create: `src/modules/auth/presentation/auth.dto.ts`
- Create: `src/modules/auth/presentation/auth-cookie.adapter.ts`
- Create: `src/modules/auth/presentation/auth-http-error.mapper.ts`
- Create: `test/unit/modules/auth/presentation/*.spec.ts`
- Create: `test/e2e/auth/authentication.e2e.spec.ts`
- Create: `test/e2e/auth/csrf.e2e.spec.ts`
- Create: `test/e2e/auth/session-management.e2e.spec.ts`

**Interfaces:**

- Consumes: public auth application API.
- Produces: default-authenticated global guards and eight `/v1/auth` endpoints.

- [ ] **Step 1: Write guard decision tables**

Authentication tests cover absent/malformed/duplicate cookie, public metadata,
valid session and dependency failure. Permission tests cover no requirement,
all required permissions, one missing permission and duplicate metadata.
Origin/CSRF tests cover safe methods, exact Origin, Referer fallback,
cross-site fetch, missing headers, wrong content type, missing/wrong token,
constant-time comparison and login's token-only exemption.

- [ ] **Step 2: Write endpoint e2e tests before controllers**

Assert cookie flags in production-mode fixture, development cookie name, raw
token absent from body, CSRF returned in login and `/auth/csrf`, strict DTO
unknown-field rejection, current session listing/revocation, logout cookie
clearing and generic login response equivalence.

- [ ] **Step 3: Run RED tests**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/modules/auth/presentation
corepack pnpm@11.15.1 exec jest --config jest.e2e.config.mjs --runInBand test/e2e/auth/authentication.e2e.spec.ts test/e2e/auth/csrf.e2e.spec.ts test/e2e/auth/session-management.e2e.spec.ts
```

- [ ] **Step 4: Implement request context without request-scoped provider graph**

Use the existing request async context pattern or one new AsyncLocalStorage
holder populated by the authentication guard. Controllers/application services
remain singleton-scoped. Context throws outside an authenticated request and is
cleared automatically with the async chain.

- [ ] **Step 5: Implement guards and cookie adapter**

Install public/authentication/origin/CSRF/permission policies in deterministic
global order. Mark only health and login public. Add `cookie-parser` during HTTP
configuration. Cookie adapter alone owns set/clear attributes and never accepts
arbitrary cookie options from controllers.

- [ ] **Step 6: Implement DTO/controllers and safe transitional errors**

DTOs expose email, current/new password, CSRF token, principal projection and
safe session metadata only. Mapper returns stable auth `code`/safe `detail` and
HTTP 401/403/409/429/503; it never forwards exception messages. Slice 4 will
replace the envelope with RFC 9457 without changing application errors.

- [ ] **Step 7: Run GREEN tests and architecture policy**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/modules/auth/presentation
corepack pnpm@11.15.1 exec jest --config jest.e2e.config.mjs --runInBand test/e2e/auth/authentication.e2e.spec.ts test/e2e/auth/csrf.e2e.spec.ts test/e2e/auth/session-management.e2e.spec.ts
corepack pnpm@11.15.1 architecture:check
```

Expected: presentation has no Prisma/Redis/Argon2 imports and every GET uses
`@SafeEndpoint()`.

- [ ] **Step 8: Commit**

```bash
git add src/platform/http src/modules/auth test/unit/modules/auth test/e2e/auth
git commit -m "feat(auth): expose hardened browser session api"
```

## Task 10: Compose auth, startup, readiness and ordered shutdown

**Files:**

- Create: `src/modules/auth/composition/auth.module.ts`
- Modify: `src/bootstrap/api/api.module.ts`
- Modify: `src/bootstrap/api/configure-api.ts`
- Modify: `src/bootstrap/api/api-runtime.ts`
- Create: `src/platform/lifecycle/startup-participant.ts`
- Create: `src/platform/lifecycle/startup-registry.ts`
- Modify: `src/platform/lifecycle/lifecycle.module.ts`
- Modify: `test/unit/bootstrap/api/api-runtime.spec.ts`
- Create: `test/unit/platform/lifecycle/startup-registry.spec.ts`
- Modify: `test/e2e/health/health-contract.e2e.spec.ts`
- Create: `test/e2e/health/redis-outage.e2e.spec.ts`
- Modify: `test/e2e/shutdown/graceful-shutdown.e2e.spec.ts`

**Interfaces:**

- Consumes: database and Redis lifecycle participants, health registry and
  global auth guards.
- Produces: generic ordered startup registry and complete API composition.

- [ ] **Step 1: Write startup/shutdown ordering tests**

Startup opens health-observable listener, connects PostgreSQL then required
coordination Redis, and marks ready only after both checks. Failure aborts later
participants and cleans all started resources. Shutdown turns readiness red,
drains requests, closes Redis order 200, database order 300 and exits 1 on any
timeout/non-settling cleanup.

- [ ] **Step 2: Run RED tests**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/platform/lifecycle/startup-registry.spec.ts test/unit/bootstrap/api/api-runtime.spec.ts
corepack pnpm@11.15.1 exec jest --config jest.e2e.config.mjs --runInBand test/e2e/health/health-contract.e2e.spec.ts test/e2e/health/redis-outage.e2e.spec.ts test/e2e/shutdown/graceful-shutdown.e2e.spec.ts
```

- [ ] **Step 3: Implement generic startup registry**

Define `StartupParticipant { name, order, start(signal), stop(signal) }` with
TSDoc. Registry rejects duplicate/late registrations, starts sequentially,
tracks completed names, and stops only completed participants in reverse start
order on failure. Database and coordination Redis adapters implement it without
exposing drivers to bootstrap.

- [ ] **Step 4: Wire composition without boundary leaks**

`ApiModule` imports only `AuthModule` composition plus platform modules.
`configureApi()` registers health/startup/shutdown participants before sealing.
Health has required PostgreSQL + coordination checks. Cache is absent from
production composition and therefore neither connected nor in readiness.

- [ ] **Step 5: Prove Redis outage semantics**

With API initially ready, pause/stop coordination Redis: readiness becomes 503,
liveness and startup remain 200, auth fails closed, and no request leaks URL or
driver error. Resume Redis and require bounded recovery to readiness 200.

- [ ] **Step 6: Run GREEN tests and commit**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/platform/lifecycle test/unit/bootstrap/api
corepack pnpm@11.15.1 exec jest --config jest.e2e.config.mjs --runInBand test/e2e/health test/e2e/shutdown
git add src/bootstrap src/platform/lifecycle src/modules/auth/composition test/unit test/e2e/health test/e2e/shutdown
git commit -m "feat(runtime): require coordination redis for auth"
```

## Task 11: Add one-shot initial administrator CLI

**Files:**

- Create: `src/bootstrap/admin/main.ts`
- Create: `src/bootstrap/admin/create-admin.cli.ts`
- Create: `src/bootstrap/admin/read-secret.ts`
- Create: `src/modules/auth/application/create-initial-admin.use-case.ts`
- Modify: `src/modules/auth/application/index.ts`
- Modify: `src/modules/auth/index.ts`
- Modify: `package.json`
- Create: `test/unit/bootstrap/admin/create-admin.cli.spec.ts`
- Create: `test/integration/modules/auth/create-initial-admin.integration.spec.ts`
- Create: `docs/runbooks/initial-admin.md`

**Interfaces:**

- Consumes: one-shot repository transaction and password hasher.
- Produces: `auth:create-admin` command with email option and password only from
  TTY/stdin.

- [ ] **Step 1: Write CLI security tests**

Reject password option/positional argument, empty input, oversized input,
malformed email and second execution. Cover both hidden TTY input and supported
piped stdin. Assert argv, stdout/stderr and errors never contain password/hash/
database/Redis URL. Integration test starts two concurrent CLI use cases and
proves exactly one admin commit.

- [ ] **Step 2: Run RED tests**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/bootstrap/admin/create-admin.cli.spec.ts
corepack pnpm@11.15.1 exec jest --config jest.integration.config.mjs --runInBand test/integration/modules/auth/create-initial-admin.integration.spec.ts
```

- [ ] **Step 3: Implement bounded secret input and one-shot transaction**

CLI accepts only `--email`. Read at most 1024 UTF-8 bytes from stdin or hidden
TTY prompt, remove one line ending and pass the password as an owned buffer/
string only to the hasher. Clear mutable buffers in `finally`. Connect only
PostgreSQL; admin bootstrap does not require Redis and does not start HTTP.

- [ ] **Step 4: Document executable runbook**

Include prerequisites, interactive and piped-stdin commands, expected safe
output, already-completed failure, database failure, verification through a
login after API startup and stop conditions. Do not include a sample password.

- [ ] **Step 5: Run GREEN tests and commit**

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/bootstrap/admin/create-admin.cli.spec.ts
corepack pnpm@11.15.1 exec jest --config jest.integration.config.mjs --runInBand test/integration/modules/auth/create-initial-admin.integration.spec.ts
corepack pnpm@11.15.1 build
git add src/bootstrap/admin src/modules/auth package.json test/unit/bootstrap/admin test/integration/modules/auth docs/runbooks/initial-admin.md
git commit -m "feat(auth): add one-shot initial admin command"
```

## Task 12: Prove multi-instance and cumulative security gates

**Files:**

- Create: `test/e2e/auth/multi-instance.e2e.spec.ts`
- Create: `test/e2e/auth/dependency-failures.e2e.spec.ts`
- Create: `test/e2e/auth/password-rehash.e2e.spec.ts`
- Create: `test/e2e/support/create-auth-test-runtime.ts`
- Modify: `jest.runtime-coverage.config.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/architecture/runtime-lifecycle.md`
- Create: `docs/architecture/redis-capabilities.md`
- Create: `docs/architecture/auth-core.md`
- Create: `docs/runbooks/coordination-redis-loss.md`
- Create: `docs/execution/slice-03-redis-auth-core.md`

**Interfaces:**

- Consumes: complete Slice 3 runtime.
- Produces: reproducible acceptance evidence and cumulative gates.

- [ ] **Step 1: Write multi-instance acceptance scenarios**

Two separately initialized Nest applications share real PostgreSQL and Redis.
Login on A must authenticate on B; revoke-one on B must reject on A; logout-all
and password change must invalidate sessions on both; role/status/generation/
epoch changes in PostgreSQL must apply on the next request without cache.
Concurrent login attempts across A/B must share atomic limits.

- [ ] **Step 2: Add failure and rehash scenarios**

Prove coordination outage fail-closed/readiness red, cache outage source
fallback/readiness unaffected, PostgreSQL outage auth fail-closed, weak Argon2id
hash upgraded after successful login, wrong password does not upgrade, and
generic missing-user/wrong-password responses are byte-equivalent after
removing request identifiers introduced only in Slice 4.

- [ ] **Step 3: Enforce auth branch coverage**

Keep global thresholds 80/80/80/75 and add collected-path thresholds of at
least 90% branches for `src/modules/auth/application/**`,
`src/modules/auth/infrastructure/*session*`, and
`src/modules/auth/presentation/*guard*`. Percentage does not replace the
decision-table tests.

- [ ] **Step 4: Run narrow real-dependency gates**

```bash
TESTCONTAINERS_REUSE_ENABLE=false corepack pnpm@11.15.1 exec jest --config jest.integration.config.mjs --runInBand test/integration/platform/redis test/integration/modules/auth test/integration/fixtures/cache-module
TESTCONTAINERS_REUSE_ENABLE=false corepack pnpm@11.15.1 exec jest --config jest.e2e.config.mjs --runInBand test/e2e/auth test/e2e/health/redis-outage.e2e.spec.ts
```

Expected: no skipped tests, sleeps, reuse or developer-service fallback.

- [ ] **Step 5: Run complete cumulative gates**

```bash
corepack pnpm@11.15.1 install --frozen-lockfile
corepack pnpm@11.15.1 check:quick
TESTCONTAINERS_REUSE_ENABLE=false corepack pnpm@11.15.1 check
corepack pnpm@11.15.1 build
```

Expected: all exit 0, coverage thresholds pass and
`dist/bootstrap/admin/main.js` plus `dist/bootstrap/api/main.js` exist.

- [ ] **Step 6: Run static scope/security scans**

```bash
rg -n "jsonwebtoken|passport|oauth|bullmq|ioredis|RedisService|@prisma/client|from 'redis'|from \"redis\"" src
rg -n "(TO|FIX|HA)(DO|ME|CK)|\.skip\(|describe\.skip|it\.skip" src test docs
git diff --check
git status --short
```

Expected: only reviewed `from 'redis'` imports under `src/platform/redis`;
other forbidden terms and unfinished markers absent. Generated Prisma client
imports remain confined to database/auth infrastructure according to the
architecture gate.

- [ ] **Step 7: Record evidence and commit**

Execution report records exact tested SHA, Node/pnpm/dependency/image versions,
suite/test counts, coverage, migration-from-empty, Redis outage/recovery,
multi-instance scenarios, real SIGTERM result, cache fixture behavior and any
environment-specific command. Do not claim Redis commands or Prisma queries
were cancellable.

```bash
git add README.md docs package.json jest.runtime-coverage.config.mjs test/e2e
git commit -m "docs(auth): record redis auth slice evidence"
```

## Final review and exit evidence

- [ ] Re-read approved design sections 7–12, 19–23 and map every requirement to
      a task/test in this plan.
- [ ] Search the implementation and plan for unfinished markers, hidden
      fallbacks, disabled tests, floating versions, raw secrets, global Redis
      access and auth projection caching.
- [ ] Confirm every exported hand-written TypeScript contract has accurate
      TSDoc without overstated atomicity, durability or cancellation.
- [ ] Confirm Redis session/rate scripts set TTL atomically and never use
      runtime `KEYS`.
- [ ] Confirm raw session/password/CSRF seed and URLs never appear in logs,
      errors, snapshots or execution evidence.
- [ ] Confirm cookie, Origin/Referer/Sec-Fetch-Site/content-type and CSRF
      decision tables cover every logical outcome.
- [ ] Confirm user generation/global epoch make partial Redis cleanup safe and
      unknown role assignments fail closed.
- [ ] Confirm production runtime opens only coordination Redis; cache remains
      lazy and Pub/Sub/queue remain disconnected.
- [ ] Confirm `pnpm check:quick`, full `pnpm check`, build, coverage and clean
      Git status on the exact reported SHA.
- [ ] Push `feat/redis-auth-core`, create a regular PR into `stage`, copy concise
      execution evidence into the PR and do not publish/deploy elsewhere without a
      separate user request.

## Plan approval checkpoint

После commit этого документа реализация не начинается, пока пользователь явно
не утвердит security contracts, endpoint surface, persistence model, Redis
failure policy и Task 0 version-refresh procedure. После утверждения план
выполняется inline через `superpowers:executing-plans` без остановок между
tasks, кроме настоящего blocker или required compatibility decision.
