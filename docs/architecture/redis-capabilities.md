# Redis capabilities

## Auth Redis

`platform/redis` owns the node-redis driver, one auth connection,
bounded commands, key construction, scripts and readiness. The composition
root creates one `RedisAuthConnectionManager`; it exports the typed
command executor, lifecycle and readiness boundaries. Auth adapters receive
the executor directly.

Auth sessions and distributed login limits remain opaque and use the `auth` key
capability segment with the existing versioned format. Commands run with bounded deadlines, fail-fast driver
options and traced `redis.command` spans. A deadline destroys the owned socket
and reports dependency failure without claiming the server did not execute the
command.

Cache and pub/sub abstractions are intentionally absent. Redis logical
database numbers, `KEYS` and unchecked JSON remain prohibited.

## Queue Redis

`platform/queue` provides an opt-in BullMQ connection boundary only. It requires
`REDIS_QUEUE_URL` at an adopting composition boundary, derives separate producer
and blocking-worker ioredis options, and exposes a bounded `redis-queue`
readiness indicator. It never reuses `RedisAuthConnectionManager`, its key
space, socket or lifecycle.

The starter registers no queue and runs no processor. The default API receives
no `REDIS_QUEUE_URL`, and local queue Redis exists only behind the Compose
`queues` profile. An adopting product owns the queue name, payload,
registration, processor, retry policy, durable business state and worker
bootstrap. See [durable-jobs.md](durable-jobs.md),
[the platform boundary](../../src/platform/queue/README.md) and
[the queue-loss runbook](../runbooks/queue-redis-loss.md).

Future durable events or application caching also do not automatically use
either Redis capability. Each requires an adopted use case and an explicit
availability, persistence, eviction and lifecycle contract. See
`docs/roadmap.md` for the capability acceptance protocol.
