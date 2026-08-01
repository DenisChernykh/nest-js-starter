# Durable Jobs Capability Implementation Plan

> **Executor:** one `gpt-5.6-luna` agent with `max` reasoning. Do not split the
> implementation between agents and do not start subagents. Follow the five
> milestones in order, keep one working context, and stop at the escalation
> gates below instead of redesigning the capability.

**Goal:** Add a built-in but runtime-inert BullMQ foundation to
`nest-js-starter`, so a product can add an API producer and a standalone worker
without reimplementing Redis connection policy, readiness and shutdown, while
all business queue contracts remain feature-owned.

**Canonical design:**
`docs/superpowers/specs/2026-08-01-durable-jobs-capability-design.md`.

**Starting point:** the current HEAD of `design/durable-jobs-capability`, whose
ancestry contains design commit `930afdf` and this committed plan. Create or use
`feat/durable-jobs-capability` from that branch HEAD, not directly from `stage`.
Work only in `nest-js-starter`; `backend-codex` is a read-only reference.

**Tech stack:** Node.js `24.18.0`, pnpm `11.15.1`, NestJS `11.1.28`,
`@nestjs/bullmq@11.0.4`, `bullmq@5.79.0`, `ioredis@5.11.1`, Jest 30,
Testcontainers Redis `8.8.0-trixie` at the already pinned digest.

## Execution Contract for Luna

The implementation decisions below are closed. Do not replace them with a
generic queue service, a generator, a product example, an outbox, another Redis
library or a different configuration system.

Before editing:

1. Run `git status -sb`, confirm the expected branch/HEAD and preserve every
   unrelated or untracked file. If the checkout is dirty in overlapping files,
   stop and report the paths.
2. Read `AGENTS.md`, the canonical design above, and this complete plan.
3. Use exact dependency versions. Do not browse for newer versions.
4. Add TSDoc to every new or changed hand-written exported TypeScript API.
5. Use RED -> GREEN inside each milestone: add or tighten the focused test,
   observe the intended failure, implement only that contract, rerun it.

Verification budget:

- Run only the listed focused tests during Milestones 1-4.
- Run `pnpm check:quick` once after the complete implementation batch in
  Milestone 4.
- Run `pnpm check` once at the end of Milestone 5.
- Run `pnpm oci:check` once at the end when Docker is available.
- Do not rerun the full gates after documentation-only fixes unless a checked
  source/config file changed.

Do not push, open a PR, merge, deploy, change Amazing EKB, or add a default
worker process. Commit each green milestone locally with the exact commit
message listed below.

### Escalation gates

Stop implementation and hand the evidence to `Terra xhigh` if any of these is
true:

- current `@nestjs/bullmq` cannot express the fixed `forRoot` plus
  feature-owned `registerQueue` composition;
- making `REDIS_QUEUE_URL` optional would require a second environment parser
  or would make the default API require queue Redis;
- Nest application-context close does not close/drain its BullMQ worker and
  queue within the bounded lifecycle test;
- the real-Redis test cannot prove two independent application contexts without
  adding a product module or a default runtime entrypoint;
- an existing architecture rule requires application/domain code to import
  BullMQ or `platform/queue`;
- a focused test repeatedly leaves open handles after explicit Nest context and
  Redis container cleanup.

The following are not escalation reasons: many files, five milestones, long
test output, or mechanical TypeScript errors whose fix is dictated by this
plan.

## Fixed Ownership and API Contract

Platform owns only connection and lifecycle mechanics:

```text
src/platform/queue/
  bullmq-connection.module.ts
  bullmq-redis-options.ts
  queue-readiness.indicator.ts
  queue-runtime-config.ts
  README.md

src/bootstrap/workers/
  run-worker-application.ts
```

The public hand-written contracts must have these names and responsibilities:

```ts
export interface QueueRuntimeConfig {
  readonly redisUrl: string
  readonly connectTimeoutMs: number
  readonly healthTimeoutMs: number
  readonly shutdownGraceMs: number
}

export function requireQueueRuntimeConfig(
  config: ApplicationRuntimeConfig,
): QueueRuntimeConfig

export function createBullmqProducerOptions(
  config: QueueRuntimeConfig,
): RedisOptions

export function createBullmqWorkerOptions(
  config: QueueRuntimeConfig,
): RedisOptions

export class BullmqConnectionModule {
  public static forProducer(config: QueueRuntimeConfig): DynamicModule
  public static forWorker(config: QueueRuntimeConfig): DynamicModule
}

export interface QueueReadinessClient {
  waitUntilReady(): Promise<unknown>
}

export class QueueReadinessIndicator implements ReadinessIndicator

export interface WorkerApplication {
  close(): Promise<void>
}

export type WorkerTerminationWaiter = (
  close: () => Promise<void>,
) => Promise<void>

export interface RunWorkerApplicationInput {
  readonly application: WorkerApplication
  readonly shutdownGraceMs: number
  readonly onStarted: () => void
  readonly waitForTermination?: WorkerTerminationWaiter
}

export function waitForWorkerTermination(
  close: () => Promise<void>,
): Promise<void>

export function runWorkerApplication(
  input: RunWorkerApplicationInput,
): Promise<void>
```

`QueueReadinessIndicator` has the fixed public values
`name = 'redis-queue'`, `required = true` and the constructor
`(client: QueueReadinessClient, timeoutMs: number)`. Its `check(signal)` returns
`up` when `waitUntilReady()` resolves and `down` on rejection or abort. It does
not create or close a queue; the composition root owns the injected client.

`BullmqConnectionModule.forProducer` and `.forWorker` each wrap exactly one
`BullModule.forRoot({ connection })`. They configure only the process root and
never call `registerQueue`, declare a processor, export a queue name or import a
business module. A product composition root imports one of these roots once and
imports its own `BullModule.registerQueue({ name })` beside it.

No barrel file or global `QueueService` is added. Product application/domain
code sees a module-owned producer port, never BullMQ.

## Milestone 1: Exact dependencies and opt-in runtime configuration

### Files

Modify:

- `package.json`
- `pnpm-lock.yaml`
- `src/platform/config/runtime-config.types.ts`
- `src/platform/config/runtime-defaults.ts`
- `src/platform/config/runtime-environment.schema.ts`
- `src/platform/config/runtime-environment.ts`
- `src/platform/config/runtime-config.service.ts`
- `test/support/required-runtime-environment.ts`
- `test/unit/platform/config/runtime-environment.spec.ts`
- `test/unit/platform/config/runtime-defaults.spec.ts`
- `test/unit/platform/config/runtime-config.service.spec.ts`

Create:

- `src/platform/queue/queue-runtime-config.ts`
- `test/unit/platform/queue/queue-runtime-config.spec.ts`

### Required behavior

1. Install the three normal production dependencies at their exact versions:

   ```bash
   corepack pnpm@11.15.1 add --save-exact \
     @nestjs/bullmq@11.0.4 bullmq@5.79.0 ioredis@5.11.1
   ```

2. Add optional `REDIS_QUEUE_URL?: string` to
   `ValidatedRuntimeEnvironment` and optional `queueUrl?: string` to
   `RedisRuntimeConfig`. Add `redisQueueConfigured: boolean` to the safe
   summary.
3. Add a separate `QueueRuntimeDefaults` section to `runtimeDefaults` with
   these reviewed values:

   ```ts
   queue: Object.freeze({
     connectTimeoutMs: 2_000,
     healthTimeoutMs: 2_500,
     shutdownGraceMs: 10_000,
   })
   ```

   Do not reuse the coordination Redis shutdown timeout as the worker drain
   deadline.

4. Validate `REDIS_QUEUE_URL` with the existing `redisUrl` schema using
   `.empty('').optional()`. Absence and the empty string are valid. Reject an
   exact normalized reuse of `REDIS_COORDINATION_URL` in every environment.
   In production, also reject a queue URL with logical database selection,
   using the same rule already applied to coordination Redis.
5. `buildApiRuntimeConfig` conditionally copies the normalized URL into
   `config.redis.queueUrl`; it must not synthesize a default. The config service
   reports only the boolean in `safeSummary` and never a URL.
6. `requireQueueRuntimeConfig(config)` fails before Nest composition when
   `queueUrl` is absent by throwing a redacted `RuntimeConfigurationError` with
   issue `{ path: 'REDIS_QUEUE_URL', rule: 'any.required' }`. When present, it
   returns a frozen object containing the URL and `runtimeDefaults.queue`.

### Focused tests

Cover all of these cases explicitly:

- unchanged required environment succeeds with no queue URL;
- empty queue URL normalizes to absence;
- `redis://` and `rediss://` queue URLs normalize successfully;
- malformed queue URL fails without echoing the value;
- exact coordination/queue URL reuse fails;
- production logical DB selection fails;
- safe summary is `false` when absent and `true` when present;
- returned queue config is frozen and has the four fixed fields;
- missing queue config throws only the redacted key/rule.

Run RED and then GREEN:

```bash
corepack pnpm@11.15.1 exec jest \
  --config jest.unit.config.mjs --runInBand \
  test/unit/platform/config/runtime-environment.spec.ts \
  test/unit/platform/config/runtime-defaults.spec.ts \
  test/unit/platform/config/runtime-config.service.spec.ts \
  test/unit/platform/queue/queue-runtime-config.spec.ts
```

Commit when green:

```bash
git add package.json pnpm-lock.yaml src/platform/config \
  src/platform/queue/queue-runtime-config.ts test/support \
  test/unit/platform/config test/unit/platform/queue/queue-runtime-config.spec.ts
git commit -m "feat(queue): add opt-in queue runtime config"
```

## Milestone 2: BullMQ connection policy, readiness and architecture guard

### Files

Create:

- `src/platform/queue/bullmq-redis-options.ts`
- `src/platform/queue/bullmq-connection.module.ts`
- `src/platform/queue/queue-readiness.indicator.ts`
- `test/unit/platform/queue/bullmq-redis-options.spec.ts`
- `test/unit/platform/queue/bullmq-connection.module.spec.ts`
- `test/unit/platform/queue/queue-readiness.indicator.spec.ts`
- `test/fixtures/dependency-cruiser/application-imports-bullmq/modules/orders/application/use-case.ts`
- `test/fixtures/dependency-cruiser/domain-imports-bullmq/modules/orders/domain/order.ts`
- `test/fixtures/dependency-cruiser/presentation-imports-bullmq/modules/orders/presentation/controller.ts`

Modify:

- `.dependency-cruiser.cjs`
- `test/unit/toolchain/dependency-cruiser-policy.spec.ts`

### Required behavior

1. Parse the validated URL into ioredis-compatible `RedisOptions`: decoded
   username/password, default port `6379`, database from the pathname, and
   `tls: {}` only for `rediss:`. Never return or log the original URL.
2. Both option builders set `connectTimeout` from `QueueRuntimeConfig`.
   Producer options set `maxRetriesPerRequest: 1`; worker options set
   `maxRetriesPerRequest: null`. Do not add feature attempts, backoff,
   concurrency, retention or rate limits.
3. The dynamic module methods call `BullModule.forRoot` with the corresponding
   options. Their metadata contains no named queue and no provider whose name
   suggests a generic enqueue service.
4. Readiness is a required `redis-queue` dependency and settles `down` on
   client rejection or `AbortSignal`. It does not expose the dependency error
   text and does not own client shutdown.
5. Extend the existing domain, application and presentation framework-driver
   regexes so they reject `@nestjs/bullmq`, `bullmq` and `ioredis`. Do not ban
   these packages from feature infrastructure, composition, platform or
   bootstrap.
6. Add dependency-cruiser fixtures proving domain, application and presentation
   violations are rejected by the intended named rules. The nested fixture
   paths are material: they must match the existing `/domain/`, `/application/`
   and `/presentation/` source rules. Existing platform-to-business rules remain
   unchanged.

### Focused tests

Run RED and then GREEN:

```bash
corepack pnpm@11.15.1 exec jest \
  --config jest.unit.config.mjs --runInBand \
  test/unit/platform/queue/bullmq-redis-options.spec.ts \
  test/unit/platform/queue/bullmq-connection.module.spec.ts \
  test/unit/platform/queue/queue-readiness.indicator.spec.ts \
  test/unit/toolchain/dependency-cruiser-policy.spec.ts
```

The tests must assert encoded credentials, `rediss`, producer/worker retry
differences, exact module method behavior, readiness success/failure/abort and
the absence of secret error text.

Commit when green:

```bash
git add .dependency-cruiser.cjs src/platform/queue test/fixtures/dependency-cruiser \
  test/unit/platform/queue test/unit/toolchain/dependency-cruiser-policy.spec.ts
git commit -m "feat(queue): add BullMQ connection foundation"
```

## Milestone 3: Generic standalone worker lifecycle

### Files

Create:

- `src/bootstrap/workers/run-worker-application.ts`
- `test/unit/bootstrap/workers/run-worker-application.spec.ts`

### Required behavior

Implement only application-context lifecycle; do not import Prisma, database,
HTTP, a queue name, `WorkerHost` or a product module.

`runWorkerApplication` must:

1. latch one `application.close()` promise and return the same promise to
   repeated close callbacks;
2. call `onStarted()` exactly once before waiting for termination;
3. default to exported `waitForWorkerTermination`, while allowing the waiter to
   be injected by tests and product bootstrap code;
4. bound context close with `shutdownGraceMs` and reject on timeout;
5. if startup callback or termination waiting fails, attempt close but rethrow
   the original failure;
6. if normal shutdown close fails or times out, surface that failure so the
   worker `main` can set a non-zero exit code.

`waitForWorkerTermination` installs one-shot `SIGINT` and `SIGTERM` listeners,
accepts only the first signal, removes both listeners after close settles, and
resolves/rejects with the close result. It must not call `process.exit()`.

Unit tests use injected waiters for lifecycle ordering and `process.emit` only
for the listener contract. Cover one close for two callbacks, successful
ordering, startup failure, waiter failure, close failure, bounded timeout,
listener removal and preservation of the original failure.

Run RED and then GREEN:

```bash
corepack pnpm@11.15.1 exec jest \
  --config jest.unit.config.mjs --runInBand \
  test/unit/bootstrap/workers/run-worker-application.spec.ts
```

Commit when green:

```bash
git add src/bootstrap/workers test/unit/bootstrap/workers
git commit -m "feat(worker): add bounded application lifecycle"
```

## Milestone 4: Real Redis proof, opt-in Compose and OCI package proof

### Files

Create:

- `test/integration/platform/queue/bullmq-connection.integration.spec.ts`

Modify:

- `test/unit/ops/local-compose-runtime-contract.spec.ts`
- `docker-compose.yml`
- `.env.example`
- `scripts/oci/run-image-smoke.ts`

### Real-Redis test contract

Use existing `startRedisContainer()` and its pinned image. Define the queue
name, payload, producer module and `@Processor`/`WorkerHost` inside the test
file only. Do not add them under `src`.

Create two independent Nest application contexts:

```text
producer context
  BullmqConnectionModule.forProducer(queueConfig)
  BullModule.registerQueue({ name: TEST_QUEUE })

worker context
  BullmqConnectionModule.forWorker(queueConfig)
  BullModule.registerQueue({ name: TEST_QUEUE })
  test-only @Processor(TEST_QUEUE)
```

The test performs this exact proof:

1. build `QueueRuntimeConfig` from the container URL and fixed test deadlines;
2. resolve the producer queue with `getQueueToken(TEST_QUEUE)`;
3. start both contexts and wait for producer readiness through
   `QueueReadinessIndicator`;
4. enqueue two jobs with distinct BullMQ job IDs but the same logical payload
   ID;
5. observe both deliveries in the test processor, proving that the platform
   does not deduplicate business payloads and a feature must own idempotency;
6. close producer and worker contexts with a deadline, then stop the container
   in `finally`;
7. assert closure settles and Jest has no queue-owned open handles.

Do not assert feature retry/backoff/concurrency defaults; none exist.

Run the focused integration test:

```bash
corepack pnpm@11.15.1 exec jest \
  --config jest.integration.config.mjs --runInBand \
  test/integration/platform/queue/bullmq-connection.integration.spec.ts
```

If Docker/Testcontainers is unavailable, preserve the exact failure output and
treat it as an environment boundary; do not rewrite the test to mock Redis.

### Local Compose contract

Add `redis-queue` using the existing pinned Redis image with:

- profile `queues`;
- password `local-development-queue-only`;
- AOF enabled, `appendfsync always`, `maxmemory-policy noeviction`;
- host binding `127.0.0.1:${REDIS_QUEUE_PORT:-6380}:6379`;
- its own `redis-queue-data:/data` volume;
- its own credential-aware healthcheck.

Do not add `REDIS_QUEUE_URL` to `x-api-environment`, API `depends_on`, `dev`, or
the default OCI smoke environment. The default API must remain unaware of the
queue service. Add only these commented/local hints to `.env.example`:

```dotenv
REDIS_QUEUE_PORT=6380
# Optional; enable Compose profile `queues` before adopting a product queue.
# REDIS_QUEUE_URL=redis://default:local-development-queue-only@127.0.0.1:6380
```

Update `local-compose-runtime-contract.spec.ts` to resolve Compose twice:

- default `development,observability`: `redis-queue` is absent and the API has
  neither `REDIS_QUEUE_URL` nor a dependency on it;
- `queues`: `redis-queue` has the exact profile, persistence, noeviction,
  loopback port, healthcheck and dedicated volume contract.

Run the focused Compose test:

```bash
corepack pnpm@11.15.1 exec jest \
  --config jest.unit.config.mjs --runInBand \
  test/unit/ops/local-compose-runtime-contract.spec.ts
```

### OCI contract

Extend `RuntimeProbe` and its in-container script with
`runtimeDependencies`. Resolve exactly `@nestjs/bullmq`, `bullmq` and `ioredis`
inside `/app`; `assertRuntimeProbe` requires all three. Keep the image `CMD`
assertion exactly `node dist/bootstrap/api/main.js` and do not add a worker
entrypoint or `REDIS_QUEUE_URL` to the smoke.

After all Milestones 1-4 are green, run the implementation-batch gate once:

```bash
corepack pnpm@11.15.1 run check:quick
```

Commit only after this gate passes:

```bash
git add .env.example docker-compose.yml scripts/oci/run-image-smoke.ts \
  test/integration/platform/queue/bullmq-connection.integration.spec.ts \
  test/unit/ops/local-compose-runtime-contract.spec.ts
git commit -m "test(queue): prove opt-in durable jobs runtime"
```

## Milestone 5: Adoption and recovery documentation, then final verification

### Files

Create:

- `src/platform/queue/README.md`
- `docs/architecture/durable-jobs.md`
- `docs/runbooks/queue-redis-loss.md`

Modify:

- `README.md`
- `docs/architecture/foundation-scope.md`
- `docs/architecture/redis-capabilities.md`
- `docs/architecture/runtime-lifecycle.md`
- `docs/roadmap.md`

### Documentation contract

Write one linear product adoption recipe in `durable-jobs.md` with exact
ownership and order:

```text
feature application producer port
  -> feature infrastructure BullMQ adapter
  -> feature-owned queue/job constants and discriminated payload
  -> API composition: forProducer + registerQueue
  -> worker composition: forWorker + registerQueue + @Processor
  -> NestFactory.createApplicationContext
  -> runWorkerApplication
  -> feature use case and authoritative durable state
```

The guide must state where a product adds its worker module, bootstrap `main`,
package command and focused integration test, but must not create these files
in the starter. It must require every adopter to document:

- attempts, backoff, retention, concurrency and rate limit;
- at-least-once/idempotency behavior;
- retryable versus terminal errors;
- whether PostgreSQL or the job is authoritative;
- whether the commit-to-enqueue gap requires a feature-owned outbox;
- allowlisted logs/diagnostics with no payload or Redis URL leakage.

The queue Redis loss runbook covers detection, producer failure, worker pause,
readiness, AOF/volume recovery, verification before resume, possible duplicate
delivery after recovery and the boundary between BullMQ delivery records and
product history. It must never suggest falling back to coordination Redis.

Update starter status honestly:

- foundation scope says durable jobs are present but opt-in;
- Redis architecture distinguishes node-redis coordination from BullMQ-owned
  ioredis connections;
- lifecycle docs describe API producer and standalone worker shutdown;
- roadmap marks the durable-jobs starter capability complete while keeping
  product outbox, scheduling, dashboards and deployment adoption deferred;
- README says the default `pnpm dev` still starts no queue Redis and links the
  opt-in guide/runbook.

### Final gates

Run exactly:

```bash
git diff --check
corepack pnpm@11.15.1 run check
corepack pnpm@11.15.1 run oci:check
```

`pnpm check` must include the real Redis integration suite. `oci:check` must
prove the runtime dependencies and unchanged default API command. If Docker is
unavailable, report `check` separately from the unverified OCI gate; do not
claim the whole plan PASS.

Review the final diff against these negative assertions:

- no default worker, queue name, job payload or processor under `src/modules`;
- no `QueueService`, generic business `Job<T>`, generator or mandatory outbox;
- no queue imports in application/domain/presentation;
- no use of `REDIS_COORDINATION_URL` by BullMQ;
- no default API import of `BullmqConnectionModule`;
- no production/deployment or Amazing EKB changes;
- every changed exported TypeScript API has TSDoc.

Commit when the verified documentation and status are complete:

```bash
git add README.md docs src/platform/queue/README.md
git commit -m "docs(queue): document durable jobs adoption"
git status -sb
```

## Handoff After Luna Finishes

Luna returns:

1. final branch and HEAD;
2. one-line outcome for every milestone commit;
3. exact focused, `check:quick`, `check` and OCI commands with fresh outcomes;
4. any environment boundary or unverified gate;
5. confirmation that no push, PR, merge, deploy or Amazing EKB edit occurred.

Then run one read-only whole-feature review with `Sol xhigh` against the design
and this plan. Send all actionable findings back to the same Luna context as
one fix wave. Use Terra only for an escalation-gate decision; do not add
parallel implementers.
