# Transactional outbox

`platform/outbox` is an opt-in durability kit between a PostgreSQL transaction
and one consumer-owned BullMQ queue. It has no HTTP API, notification policy,
product processor, default Compose service or product `main`.

## Adoption contract

The feature writes one `OutboxMessageDraft` through `TransactionalOutboxWriter`
inside its existing `TransactionPort.run()` callback. `append()` rejects calls
outside that transaction. The canonical message contains a logical
`destination`, `type`, positive `version`, optional partition/correlation keys,
occurrence time and a JSON-object payload no larger than 64 KiB.

Payloads must contain no credentials or binary data. They are never emitted by
outbox diagnostics or retry errors. One row targets exactly one logical
destination and one consumer-owned queue; there is no router, fan-out,
ordering guarantee or exactly-once claim.

Compose the writer with `OutboxModule.forWriter()`. Compose one relay with
`OutboxRelayModule.forBullMq({ destination, queueName })` alongside exactly one
existing `BullmqConnectionModule.forProducer(...)` root connection. The relay
module registers that consumer queue but does not start itself. A process owner
obtains `OUTBOX_RELAY_RUNNER` and runs it under its own lifecycle boundary.

`createOutboxRelayRuntimeConfig()` is the standalone relay projection: it
requires only PostgreSQL, `REDIS_QUEUE_URL`, logging and service identity. It
does not require HTTP, auth Redis, browser-auth secrets or an API configuration.
The kit deliberately supplies no ready product executable.

## Delivery semantics

The relay claims up to 50 ready rows with PostgreSQL time, `FOR UPDATE SKIP
LOCKED` and a 30-second lease, then releases database locks before publishing.
It publishes the canonical envelope to BullMQ with `jobId = messageId`.

`PENDING → CLAIMED → PUBLISHED` is the normal path. A transient publisher
failure returns the row to `PENDING`, increments attempts and schedules full
jitter exponential backoff from one second up to five minutes. There is no
automatic retry exhaustion. A classified terminal publisher failure becomes
`BLOCKED` and needs controlled operator action. Claim-token checks prevent a
stale relay from overwriting a reclaimed row.

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
pending, claimed, blocked and oldest pending timestamp. Do not query/log
payloads while investigating a backlog.

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

Redrive of a `BLOCKED` message is controlled by its expected state. Redrive of
a `PUBLISHED` message requires explicit duplicate confirmation because delivery
may happen again. Do not bulk-redrive blindly, delete blocked records, print
payloads, or replace queue Redis with auth Redis.

## Shutdown

Abort the reusable relay runner first. It stops poll waits immediately and
waits at most its bounded shutdown grace for an active publish cycle. A cycle
that outlives that grace is left for lease recovery; do not force its row to a
terminal state. Close PostgreSQL and BullMQ only after that process-level grace
decision.
