# Runtime lifecycle

`ApiRuntime` initializes Nest, opens the listener, then starts PostgreSQL and
auth Redis explicitly in that order. Only after both complete does it
mark the irreversible startup latch ready. A startup failure begins drain and
rolls back auth Redis before PostgreSQL; the API never runs migrations. The
default API does not create a queue connection, require `REDIS_QUEUE_URL` or
start a worker.

Health contracts remain stable: liveness is process-only, startup stays latched
after the first successful start, and readiness is `503` while starting,
draining or when either required probe is unavailable.

Graceful shutdown closes the HTTP listener and idle connections, waits for
`ActiveRequestTracker` within its bounded drain budget, then closes resources in
the explicit order auth Redis, PostgreSQL and OpenTelemetry before closing Nest.
Non-settling work forces transport connections closed and returns exit code 1.
Each lifecycle owner shares its promise and observes the coordinator deadline.

Prisma still stops admission before waiting for active database operations.
Redis command deadlines destroy the owned socket but do not claim cancellation
of a command already dispatched to Redis.

A product that adopts durable jobs creates a separate worker application context
with its worker-oriented BullMQ connection and registers its feature processor
there. `runWorkerApplication` owns only that context's bounded close operation:
it waits for the first `SIGINT` or `SIGTERM`, latches `application.close()` and
returns a close failure or deadline as a non-zero worker outcome. The worker
process owner injects `forceExit: (code) => process.exit(code)` for a deadline;
the helper never calls `process.exit()` directly. The worker must define its own
readiness, rollout order and recovery policy; see
`durable-jobs.md` and `queue-redis-loss.md`.
