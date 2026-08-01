# Durable Jobs Capability Design

Date: 2026-08-01

Status: approved for implementation planning

## Context

The Amazing EKB backend now has two independent durable background workflows:
Telegram material imports and Yandex Maps place imports. Both use the same
technical process boundary:

```text
API producer -> BullMQ in queue Redis -> standalone worker process
```

Their business state and reliability policies remain different. Telegram owns
an `ImportRun` and uses ordinary BullMQ attempts and backoff. Yandex Maps owns a
fenced PostgreSQL operation state machine and uses BullMQ only for delivery.
This repetition is sufficient evidence for extracting the stable queue runtime
into the starter without extracting either product workflow.

The starter will therefore adopt durable jobs as a built-in but opt-in
technical capability. Its code and exact dependencies are present in a clean
copy, while queue Redis configuration, connections and worker processes remain
inactive until a product composition root explicitly adopts them.

## Goals

1. Make the next product-owned BullMQ queue straightforward to compose without
   reimplementing Redis connection policy, process lifecycle and integration
   test setup.
2. Keep queue names, job contracts, retry policy, idempotency and durable
   business state inside the consuming business module.
3. Keep BullMQ connections separate from the starter's coordination Redis
   connection and availability contract.
4. Support HTTP/API producers and standalone worker processes without making a
   worker part of the default starter runtime.
5. Preserve the existing module-local hexagonal boundaries and architecture
   gates.

## Non-goals

The capability does not introduce:

- a generic import service;
- a global `QueueService` or service locator;
- a generic `Job<T>` domain abstraction or base business worker;
- shared queue names, payloads, attempts, backoff or concurrency defaults;
- a mandatory PostgreSQL outbox;
- a default product queue or demo business workflow;
- Telegram, Yandex Maps or other Amazing EKB product contracts;
- a generator, manifest, recipe engine or cross-repository runtime package;
- production deployment changes for Amazing EKB.

## Adopted Architecture

### Platform ownership

`src/platform/queue` owns only BullMQ-specific technical behavior:

```text
src/platform/queue/
  bullmq-connection.module.ts
  bullmq-redis-options.ts
  queue-readiness.indicator.ts
  queue-runtime-config.ts
  README.md
```

The process-level shutdown helper lives at the bootstrap boundary:

```text
src/bootstrap/workers/
  run-worker-application.ts
```

The platform module never imports a business module. It provides:

- one root BullMQ connection configuration per process;
- distinct producer and worker Redis policies;
- typed queue runtime configuration;
- a bounded readiness check for the queue Redis dependency;
- documentation of connection ownership and shutdown behavior.

`BullmqConnectionModule.forProducer(config)` configures a producer process with
bounded request retries. `BullmqConnectionModule.forWorker(config)` configures a
long-running consumer connection with BullMQ-compatible retry behavior. Both
methods configure the process-level BullMQ root only; they do not register a
named queue or a processor.

### Feature ownership

Each consuming module owns:

- its queue name and job names;
- the exact discriminated payload contract;
- an application producer port;
- the BullMQ producer adapter that implements that port;
- its `BullModule.registerQueue({ name })` composition;
- its `@Processor(name)` consumer;
- attempts, backoff, retention, concurrency and rate limits;
- idempotency and duplicate-delivery behavior;
- durable business state and recovery rules;
- safe business diagnostics.

Application and domain code do not import BullMQ, Redis, Nest queue decorators
or `src/platform/queue`. A module-local infrastructure adapter maps the
application port to BullMQ.

### Bootstrap ownership

The API composition root imports
`BullmqConnectionModule.forProducer(queueConfig)` once when at least one product
queue is enabled. Feature composition modules then register their own named
queues. Multiple producer features share the process root connection without
sharing job contracts.

Every worker remains a separate `NestFactory.createApplicationContext(...)`
process. Its bootstrap imports `BullmqConnectionModule.forWorker(queueConfig)`
and exactly the consumer-side composition required for that worker. It does not
import API controllers, browser authentication or unrelated product modules.

The capability supplies a bounded technical worker shutdown helper for signal
latching and application-context closure. It does not assume PostgreSQL. A
database-backed worker composes the existing database lifecycle explicitly.

## Configuration and Redis Topology

The starter adds an optional `REDIS_QUEUE_URL`. Absence is valid for the default
API because no queue capability is active. A composition root that adopts a
producer or worker must build `QueueRuntimeConfig`; startup fails before Nest
composition when the URL is absent or invalid.

Queue Redis is not routed through `RedisCoordinationConnectionManager` and does
not reuse its node-redis command executor. BullMQ owns its ioredis connections.
The documented queue Redis contract requires:

- a dedicated connection URL and credentials;
- persistence appropriate for durable jobs;
- `noeviction` rather than cache-style eviction;
- explicit outage and recovery behavior;
- bounded producer retries and long-running worker retry behavior;
- no logging of Redis credentials or complete connection URLs.

Local Compose exposes a separate `redis-queue` service behind an opt-in
`queues` profile with its own volume and healthcheck. The default `dev` command
does not start it until a maintained product workflow adopts the capability.

## Data Flow

The reusable happy path is:

```text
HTTP/application use case
  -> module-owned producer port
  -> module-owned BullMQ adapter
  -> named queue in queue Redis
  -> standalone worker processor
  -> module-owned application use case
  -> module-owned durable business state
  -> BullMQ acknowledgement
```

BullMQ job state is a delivery and execution record. It is not automatically
the product's durable business history. A consuming module must state whether
PostgreSQL, another store or the job itself is authoritative.

## Failure and Delivery Contract

BullMQ provides at-least-once delivery, so every consuming module must define
its duplicate-delivery and idempotency behavior. The capability does not
silently promise exactly-once execution.

Producer enqueue and a preceding PostgreSQL transaction are not atomic. A
module whose business state cannot tolerate the commit-to-enqueue gap must own
a transactional outbox or an equivalent dispatcher. The platform capability
does not impose an outbox on workflows that do not need one.

Each feature must classify retryable and non-retryable failures and ensure that
raw dependency errors, secrets and untrusted payload data are not copied into
logs or durable public diagnostics. The platform may log only allowlisted
technical fields such as process identity, queue name and lifecycle outcome;
business identifiers remain feature-owned.

Shutdown stops new work, lets in-flight work drain within the configured
deadline, closes the Nest application context and then closes remaining
process-owned dependencies. A timeout terminates readiness and exits non-zero
rather than reporting a clean shutdown.

## Testing Strategy

The starter capability adds:

1. Unit tests for URL parsing, redaction, producer options, worker options and
   invalid configuration.
2. A Redis Testcontainers integration test proving enqueue, consumption,
   duplicate delivery assumptions and bounded connection closure with a
   test-only queue contract.
3. Bootstrap unit tests for signal latching, drain timeout and non-zero failure.
4. Architecture checks proving that `platform/queue` imports no product module
   and that application/domain layers import neither BullMQ nor platform code.
5. Build and OCI assertions that BullMQ production dependencies are present but
   no worker process starts in the default API image command.

A product that adopts the capability adds its own producer/consumer integration
test and any end-to-end test required by its HTTP or process contract.

## Starter Distribution

`@nestjs/bullmq@11.0.4`, `bullmq@5.79.0` and `ioredis@5.11.1` are normal starter
production dependencies. The capability code is committed on the starter's
normal `stage` lineage; it is not distributed through a generator or optional
patch engine.

Presence in the repository does not imply runtime activation:

- `REDIS_QUEUE_URL` remains optional until queue composition is imported;
- the default API root does not import `BullmqConnectionModule`;
- the default runtime command remains the API command;
- no default worker module, queue name or job payload is created;
- local queue infrastructure stays behind an opt-in Compose profile.

Documentation includes a linear adoption guide showing how a product adds a
queue contract, producer adapter, processor, worker composition root, runtime
command and focused tests.

## Amazing EKB Adoption Boundary

The starter is a source reference, not a runtime package dependency of Amazing
EKB. After the starter capability is implemented and verified, the backend may
adopt the same platform contract in a separate bounded change:

1. replace repeated BullMQ root configuration with the starter-aligned module;
2. keep `material-imports` and `place-imports` queue contracts in their current
   product modules;
3. keep Telegram and Yandex retry/state-machine behavior unchanged;
4. keep browser, CAPTCHA viewer and place-import Redis capabilities outside the
   generic queue platform;
5. verify both existing queue integration suites and worker lifecycle gates.

No dual runtime mode or compatibility adapter is introduced. Adoption is an
atomic internal cutover after the starter contract is stable.

## Acceptance Criteria

The capability is ready to merge into the starter when:

1. a clean copy with no `REDIS_QUEUE_URL` starts and passes all unchanged core
   gates without opening queue Redis connections;
2. an opt-in test producer and standalone test worker exchange a job through a
   real Redis container;
3. producer and worker processes use their distinct reviewed connection
   policies;
4. worker shutdown is bounded and covered by tests;
5. queue Redis lifecycle, persistence, outage and recovery behavior are
   documented;
6. architecture gates prevent platform-to-business and application-to-BullMQ
   dependencies;
7. `pnpm check:quick`, `pnpm check` and the relevant OCI smoke pass;
8. no product queue, generic business abstraction, production deployment or
   generator is added.

## Deferred Work

The following require separate product evidence and are not part of this
capability:

- a reusable transactional outbox;
- scheduled or repeatable jobs;
- queue dashboards or administrative replay APIs;
- multi-tenant queue partitioning;
- workflow orchestration across multiple queues;
- generic dead-letter or business compensation frameworks.
