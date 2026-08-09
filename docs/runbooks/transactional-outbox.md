# Transactional outbox

`platform/outbox` is an opt-in durability kit between a PostgreSQL transaction
and one consumer-owned BullMQ queue. It has no HTTP API, notification policy,
product processor, default Compose service or product `main`.

Start with the [transactional outbox adoption guide](../architecture/transactional-outbox-adoption.md)
for feature-port, writer, relay and consumer composition. This runbook is the
canonical delivery, recovery and operator contract after adoption.

## Adoption contract

The feature writes one `OutboxMessageDraft` through `TransactionalOutboxWriter`
inside its existing `TransactionPort.run()` callback. `append()` rejects calls
outside that transaction. The canonical wire message contains `messageId`, a
logical `destination`, `type`, positive `version`, optional
partition/correlation keys, an ISO-8601 `occurredAt` string and a JSON-object
payload no larger than 64 KiB. Claim tokens, attempt counters and lease data
never enter the consumer envelope. The limit is the UTF-8 byte length of the
accepted compact JSON payload; that canonical size is stored separately from
PostgreSQL's differently formatted `jsonb::text` representation.

Payloads must contain no credentials or binary data. Generic validation rejects
binary/non-JSON values and obvious credential-shaped keys, but cannot prove
that arbitrary string values contain no secrets. Every adopting feature must
therefore define an allowlisted payload schema and test it before calling the
writer; the platform blacklist is defense in depth, not a secret scanner.
Payloads are never emitted by outbox diagnostics or retry errors. One row
targets exactly one logical destination and one consumer-owned queue; there is
no router, fan-out, ordering guarantee or exactly-once claim.

Compose the writer with `OutboxModule.forWriter()`. An API composition can use
`OutboxRelayModule.forBullMq({ destination, queueName, queueOptions })`
alongside exactly one existing `BullmqConnectionModule.forProducer(...)` root
connection. `queueOptions` is where the consumer owns BullMQ attempts, backoff
and completed/failed retention. Other registration fields are ignored so they
cannot replace the platform connection, namespace, shutdown policy or create a
processor in the relay process; the adapter owns only `jobId = messageId`.
The module registers that consumer queue but does not start itself. A process
owner obtains `OUTBOX_RELAY_RUNNER` and runs it under its own lifecycle boundary.

`createOutboxRelayRuntimeConfig()` is the standalone relay projection: it
requires only PostgreSQL, `REDIS_QUEUE_URL`, logging and service identity. It
does not require HTTP, auth Redis, browser-auth secrets or an API configuration.
`OutboxRelayRuntimeModule.forBullMq(...)` closes that projection over the
database and existing BullMQ connection foundations. The kit deliberately
supplies no ready product executable. A generated process-instance suffix keeps
the default claim owner distinct across replicas and within the 160-character
persistence bound; a custom `ownerId` must satisfy the same bound.

## Delivery semantics

The relay claims up to 50 ready rows with PostgreSQL time, `FOR UPDATE SKIP
LOCKED` and a 30-second lease, then releases database locks before publishing.
Retry scheduling, publish/block timestamps, redrive eligibility and retention
cutoffs use the same PostgreSQL clock. The relay publishes the canonical
envelope to BullMQ with `jobId = messageId`.

`PENDING → CLAIMED → PUBLISHED` is the normal path. A transient publisher
failure returns the row to `PENDING`, increments attempts and schedules full
jitter exponential backoff from one second up to five minutes. There is no
automatic retry exhaustion. A classified terminal publisher failure becomes
`BLOCKED` and needs controlled operator action. Claim-token checks prevent a
stale relay from overwriting a reclaimed row. Publisher error codes are stored
only when they match the bounded uppercase code contract; unsafe values collapse
to a generic code before persistence.

`PUBLISHED` means only that the publisher accepted the enqueue. It does not
mean a processor succeeded. A process may crash after `Queue.add` and before
the `PUBLISHED` update; the lease then expires and the message may be published
again. Downstream processors must be idempotent. BullMQ's current duplicate
job-ID behavior reduces duplicate queued jobs while that job exists, but it is
not an exactly-once guarantee.

Published rows are eligible for cleanup after seven days. Invoke the exported
`OUTBOX_RETENTION_CLEANUP` under an operator-owned periodic lifecycle; each run
deletes at most 500 rows. `BLOCKED` rows are never automatically deleted.

## Diagnostics, redrive and incident recovery

Use `PrismaOutboxStore.diagnostics()` for aggregate counts by destination:
pending, claimed, blocked and the creation time of the oldest pending message.
Do not query/log payloads while investigating a backlog.

- PostgreSQL unavailable: stop relay admission, restore the same database and
  let unexpired claims finish or expire. Do not manually mark `CLAIMED` rows
  published.
- Redis/BullMQ unavailable: the relay schedules safe retries; restore the
  same queue endpoint and inspect queue readiness. Follow
  [queue Redis loss](queue-redis-loss.md) for data loss.
- Expired lease: a new relay may reclaim it. The old claim token cannot
  publish, retry or block that row.
- `BLOCKED`: identify the safe error code and business cause, repair the
  adapter/destination and redrive exactly that row to `PENDING`.
- Queue data loss: reconcile from the outbox and product authoritative state;
  redrive only the affected rows with consumer idempotency in place.

Redrive uses compare-and-set against the explicitly expected state and reports
a conflict if the row is missing or has moved. Redrive of a `PUBLISHED` message
requires explicit duplicate confirmation because delivery may happen again.
The persistent redrive intent makes the BullMQ adapter retry a retained
completed/failed job; if the job was removed, the stable message ID is added
again. An indeterminate BullMQ `unknown` state remains retryable and does not
clear that intent. Do not bulk-redrive blindly, delete blocked records, print
payloads, or replace queue Redis with auth Redis.

## Shutdown

Abort the reusable relay runner first. It stops poll waits immediately and
waits at most its bounded shutdown grace for an active publish cycle. A cycle
that outlives that grace is left for lease recovery; do not force its row to a
terminal state. Close PostgreSQL and BullMQ only after that process-level grace
decision. These process-local mechanics come from the
[periodic maintenance Kit](../architecture/periodic-maintenance.md); abort does
not cancel an outbox lease or replace claim-token recovery.
