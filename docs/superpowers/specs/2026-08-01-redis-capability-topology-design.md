# Redis Capability Topology and Durable Jobs Design

Date: 2026-08-01

Status: approved for implementation planning

## Context

The starter currently has one required Redis dependency called
`redis-coordination`. Its actual consumers are the authentication capability:
opaque browser sessions, session revocation and distributed login-rate limits.
The name describes an implementation property rather than the dependency's
owned purpose, so it becomes misleading as soon as the system adds another
Redis-backed capability.

The Amazing EKB backend already supplies the second repetition that justifies a
reusable queue foundation. Telegram material imports and Yandex Maps place
imports both use this technical path:

```text
API producer -> BullMQ -> queue Redis -> standalone worker process
```

Their business behavior is deliberately different. Telegram owns an
`ImportRun` and ordinary retry/backoff behavior. Yandex Maps owns a fenced
PostgreSQL operation state machine and an additional interactive Redis
transport for viewer capability, revocation, Pub/Sub and SSE update hints.
Those product contracts must not move into the starter.

The approved direction is starter-first. The starter first establishes clear
`redis-auth` and opt-in `redis-queue` capabilities. Amazing EKB then adopts the
verified starter contract in a separate change and adds its product-owned
`redis-place-import` capability. Production deployment is outside both slices.

## Goals

1. Name every Redis dependency by its owned capability rather than the vague
   term `coordination`.
2. Make auth, durable queues and product-specific place-import transport
   physically independent Redis services, not logical databases in one Redis
   process.
3. Add a built-in but runtime-inert BullMQ foundation to the starter so a new
   product queue does not reimplement connection policy, readiness and worker
   lifecycle.
4. Keep queue names, payloads, retry policy, idempotency and durable business
   state inside each consuming business module.
5. Produce a closed implementation contract that one `Luna max` executor can
   implement sequentially without making new architecture decisions.

## Non-goals

This design does not introduce:

- a generic import service or shared import state machine;
- a global `QueueService`, service locator or generic business `Job<T>`;
- shared product queue names, payloads, attempts, backoff or concurrency;
- a mandatory PostgreSQL outbox;
- a default/demo queue or worker in the starter API runtime;
- Telegram, Yandex Maps or Amazing EKB contracts in the starter;
- a generator, recipe engine or separately published runtime package;
- Redis Cluster, Sentinel or cross-region topology;
- production secrets, deployment or migration orchestration;
- compatibility aliases for the old `coordination` names.

## Naming Decision

The required Redis dependency becomes `redis-auth`.

`authentication` is the correct capability boundary because Redis stores and
coordinates evidence used to establish or invalidate a login session. It does
not own roles, permissions or object-level access decisions, so
`redis-authorization` would be inaccurate. The shorter runtime name
`redis-auth` avoids implying that Redis is the source of the RBAC policy.

The starter contract uses these names consistently:

| Concern                      | Approved name                 |
| ---------------------------- | ----------------------------- |
| Environment variable         | `REDIS_AUTH_URL`              |
| Local Compose service        | `redis-auth`                  |
| Local Compose volume         | `redis-auth-data`             |
| Readiness dependency         | `redis-auth`                  |
| Connection manager           | `RedisAuthConnectionManager`  |
| Connection config field      | `authUrl`                     |
| Command-executor token       | `REDIS_AUTH_COMMAND_EXECUTOR` |
| Redis key capability segment | `auth`                        |
| Loss runbook                 | `auth-redis-loss.md`          |

`REDIS_COORDINATION_URL`, `redis-coordination`,
`RedisCoordinationConnectionManager`, the coordination token and the
`coordination` key segment are removed atomically. They are not accepted as
fallback aliases. This is a starter contract cutover, not a production data
migration.

The generic low-level Node Redis implementation may remain under
`src/platform/redis`; its public runtime objects are auth-specific because the
starter has exactly one Node Redis capability. BullMQ remains under the
separate `src/platform/queue` boundary and owns its own ioredis connections.

## Target Redis Topology

### Starter

```text
redis-auth                         redis-queue
required by the API               opt-in capability
node-redis                         BullMQ-owned ioredis
sessions and login limits         durable job delivery/execution
own URL, credentials and volume   own URL, credentials and volume
```

The starter runtime variables are:

```text
REDIS_AUTH_URL=redis://...@redis-auth:6379
REDIS_QUEUE_URL=redis://...@redis-queue:6379   # optional
```

The URLs must identify distinct endpoints after normalization. Equality is
checked by protocol, lower-cased hostname and effective port; credentials do
not make one endpoint into two physical services. Neither URL may select a
logical database. Canonical examples omit a pathname entirely; `/0`, `/1` and
other database pathnames are rejected. This rule applies in local, test and
production configuration so a copied project cannot accidentally collapse the
capabilities into one process. Configuration validation cannot prove that two
different DNS names resolve to different Redis processes, so deployment
topology remains an operator responsibility.

The default local development path starts the required `redis-auth` service.
`redis-queue` stays behind an explicit Compose profile until a copied product
adopts a queue. It has its own healthcheck and persistent volume. Absence of
`REDIS_QUEUE_URL` is valid until a queue composition root asks for queue runtime
configuration.

### Amazing EKB after starter adoption

```text
redis-auth          redis-queue              redis-place-import
auth capability     BullMQ transport          product capability
sessions, revoke,   material/place jobs       viewer capability,
login limits        for both workers          revoke, Pub/Sub, SSE hints
```

The backend target variables are:

```text
REDIS_AUTH_URL=redis://...@redis-auth:6379
REDIS_QUEUE_URL=redis://...@redis-queue:6379
REDIS_PLACE_IMPORT_URL=redis://...@redis-place-import:6379
```

All three endpoints are pairwise distinct, omit logical database selection and
have independent credentials, healthchecks, persistence decisions and local
Compose services. The backend does not use `/0`, `/1` and `/2` to simulate
capability separation.

Process access is least-privilege by dependency:

| Process                 | `redis-auth` | `redis-queue` | `redis-place-import`                   |
| ----------------------- | ------------ | ------------- | -------------------------------------- |
| API                     | required     | required      | required while place import is enabled |
| Material-import worker  | no           | required      | no                                     |
| Place-import worker     | no           | required      | required                               |
| Migrator / one-shot CLI | no           | no            | no                                     |

Process-specific configuration must not make a worker connect to Redis
capabilities it does not use.

## Starter Queue Capability

### Platform ownership

`src/platform/queue` owns only BullMQ-specific technical behavior:

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

It provides:

- one process-level BullMQ root configuration;
- separate producer and worker connection policies;
- typed opt-in queue runtime configuration;
- a bounded readiness indicator for queue Redis;
- bounded worker signal, drain and application-context shutdown behavior;
- documentation for connection ownership and queue adoption.

`BullmqConnectionModule.forProducer(config)` configures bounded request retries.
`BullmqConnectionModule.forWorker(config)` configures BullMQ-compatible
long-running retry behavior. Neither method registers a named queue, declares a
processor or exports a generic enqueue service.

Queue Redis does not pass through `RedisAuthConnectionManager` or its
node-redis command executor. BullMQ owns its ioredis connections.

### Feature ownership

Every consuming product module owns:

- queue and job names;
- the discriminated job payload contract;
- its application producer port;
- the BullMQ producer adapter for that port;
- `BullModule.registerQueue({ name })` composition;
- its `@Processor(name)` consumer;
- attempts, backoff, retention, concurrency and rate limits;
- idempotency and duplicate-delivery behavior;
- durable business state, recovery and safe diagnostics.

Application and domain code do not import BullMQ, ioredis, Nest queue
decorators or `src/platform/queue`. A module-local infrastructure adapter maps
the application port to BullMQ.

### Bootstrap ownership

An API composition root imports
`BullmqConnectionModule.forProducer(queueConfig)` once when at least one queue
is enabled. Feature composition modules register their own named queues beside
that root. Multiple producer features may share `redis-queue` without sharing
job contracts.

Every worker remains a separate
`NestFactory.createApplicationContext(...)` process. Its root imports
`BullmqConnectionModule.forWorker(queueConfig)` and only the consumer-side
composition required by that worker. It does not import HTTP controllers,
browser authentication or unrelated product modules.

The worker lifecycle helper is technical and database-agnostic. A
database-backed worker composes the existing database lifecycle explicitly.

### Dependency contract

The starter adds these exact normal production dependencies:

```text
@nestjs/bullmq@11.0.4
bullmq@5.79.0
ioredis@5.11.1
```

They are present in a clean copy but remain runtime-inert until a composition
root imports the queue capability. The implementation plan must not substitute
newer versions or another Redis client without returning to design review.

## Data and Failure Semantics

The reusable happy path is:

```text
application use case
  -> feature-owned producer port
  -> feature-owned BullMQ adapter
  -> named queue in redis-queue
  -> standalone worker processor
  -> feature-owned application use case
  -> feature-owned durable state
  -> BullMQ acknowledgement
```

BullMQ provides at-least-once delivery. Each feature must define idempotency
and duplicate-delivery behavior; the starter does not promise exactly-once
execution.

Enqueue and a preceding PostgreSQL transaction are not atomic. A feature that
cannot tolerate the commit-to-enqueue gap owns an outbox or equivalent
dispatcher. The starter does not impose one without product evidence.

BullMQ job state is a delivery/execution record, not automatically the
product's durable business history. Telegram and Yandex Maps retain their
existing authorities and reliability policies during backend alignment.

Redis credentials, complete URLs, raw dependency errors and untrusted payloads
must not enter logs or public diagnostics. Platform diagnostics are limited to
allowlisted technical fields; business identifiers remain feature-owned.

## Migration Order

### Slice 1: starter

The starter change is one atomic internal cutover:

1. rename the required auth Redis contract from coordination to auth;
2. split local Compose into required `redis-auth` and opt-in `redis-queue`;
3. reject logical database selection and endpoint reuse;
4. add exact BullMQ production dependencies and the opt-in queue platform;
5. add worker lifecycle, readiness, architecture guards and adoption docs;
6. update tests, OCI fixtures, runbooks and safe health/OpenAPI examples;
7. verify the complete starter on one exact revision.

No compatibility mode accepts both `REDIS_COORDINATION_URL` and
`REDIS_AUTH_URL`. No default product worker is added.

### Slice 2: Amazing EKB backend

Only after Slice 1 passes review and final verification, record its exact Git
revision and create a separate backend plan. That plan atomically:

1. adopts the starter-aligned auth and queue technical contracts;
2. creates physical `redis-auth`, `redis-queue` and `redis-place-import`
   services instead of logical databases;
3. replaces repeated BullMQ root/lifecycle wiring in API and both workers;
4. preserves material-import and place-import queue names and payloads;
5. preserves Telegram retry behavior and Yandex fenced operation semantics;
6. keeps place-import viewer/PubSub/SSE behavior product-owned;
7. introduces no deployment or production-secret changes.

The backend is a source-level adopter, not a runtime package consumer of the
starter.

## Testing Strategy

The starter implementation must provide focused evidence for:

1. Atomic auth rename: environment parsing, safe summary, health contract,
   connection lifecycle, auth stores, Compose and OCI fixtures contain no live
   coordination aliases.
2. Topology rules: auth/queue endpoint reuse and every explicit logical DB
   pathname are rejected without echoing secrets.
3. Runtime inertness: a default starter API with no `REDIS_QUEUE_URL` does not
   compose BullMQ or open queue connections.
4. Queue policy: URL parsing/redaction and distinct producer/worker ioredis
   options.
5. Real boundary: a Redis Testcontainers integration test exchanges a test-only
   job between independent producer and worker application contexts and closes
   all handles.
6. Worker lifecycle: one signal latch, bounded drain, application-context close
   and non-zero timeout/failure behavior.
7. Architecture: platform queue code cannot import product modules, and
   application/domain/presentation cannot import BullMQ or ioredis.
8. Distribution: dependencies are available in the built image, while the
   default API command starts no worker.

Focused tests run during implementation. `pnpm check:quick` runs once after the
complete code batch, `pnpm check` once at the end, and the relevant OCI smoke
once when Docker is available. A failed aggregate gate may be repeated only
after related code changes.

## Agent Execution and Escalation Contract

The implementation plan must contain three to five sequential milestones and
be executable by one `gpt-5.6-luna` agent with `max` reasoning. Milestones are
commit-sized verified outcomes, not assignments to different agents.

After each milestone, Luna:

1. runs only its listed focused checks;
2. creates the prescribed local commit;
3. reports milestone result, command evidence, `HEAD` and `git status -sb`;
4. stops until the user accepts that milestone and asks for the next one.

On a blocker, Luna diagnoses it and gets one bounded correction attempt. If the
same blocker remains, it stops without redesigning and reports:

- milestone and expected invariant;
- current branch, HEAD and dirty state;
- exact failing command and error;
- the single attempted correction;
- changed files and remaining uncertainty.

The planning/review session classifies the escalation:

- plan ambiguity or contradiction: revise the plan; Luna remains executor;
- repeated implementation/integration blocker: continue the same execution
  task with `Terra xhigh`;
- architecture or scope change: revise this design before implementation;
- Docker, network, registry, port or host limitation: treat it as an
  environment boundary, not a model-upgrade signal.

After all milestones, `Sol xhigh` performs one read-only whole-feature review.
Confirmed findings return as one batch to the same executor for one fix wave,
followed by final verification. There is no Sol review after every successful
milestone and no subagent-driven development.

## Acceptance Criteria

The starter slice is complete only when:

1. all live starter source, configuration, Compose, tests, health examples and
   runbooks use `redis-auth`; obsolete coordination aliases are absent outside
   explicitly superseded historical documents;
2. auth and queue use different validated endpoints and independent local
   services/volumes, with no logical DB selection;
3. a clean default starter starts with required auth Redis and no queue Redis
   connection;
4. an opt-in test producer and standalone worker exchange a job through a real
   `redis-queue` container;
5. producer and worker policies, readiness and bounded shutdown are covered;
6. business modules retain ownership of queue contracts and reliability;
7. architecture gates preserve module-local hexagonal boundaries;
8. `pnpm check:quick`, `pnpm check` and relevant OCI smoke have fresh evidence;
9. no product workflow, compatibility alias, production change, push, PR,
   merge or deployment is included.

The later backend slice is accepted separately against the exact verified
starter revision and its own import/runtime regression suites.

## Deferred Work

The following remain outside this design:

- production Redis provisioning, ACLs, backups and credential rotation;
- a reusable transactional outbox;
- scheduled/repeatable jobs;
- queue dashboards and administrative replay APIs;
- multi-tenant queue partitioning;
- generic dead-letter or compensation frameworks;
- migration of existing production Redis keys or queued jobs.
