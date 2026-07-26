# Runtime lifecycle

`ApiRuntime` initializes Nest, opens the listener, then starts PostgreSQL and
coordination Redis explicitly in that order. Only after both complete does it
mark the irreversible startup latch ready. A startup failure begins drain and
rolls back Redis before PostgreSQL; the API never runs migrations.

Health contracts remain stable: liveness is process-only, startup stays latched
after the first successful start, and readiness is `503` while starting,
draining or when either required probe is unavailable.

Graceful shutdown closes the HTTP listener and idle connections, waits for
`ActiveRequestTracker` within its bounded drain budget, then closes resources in
the explicit order Redis, PostgreSQL and OpenTelemetry before closing Nest.
Non-settling work forces transport connections closed and returns exit code 1.
Each lifecycle owner shares its promise and observes the coordinator deadline.

Prisma still stops admission before waiting for active database operations.
Redis command deadlines destroy the owned socket but do not claim cancellation
of a command already dispatched to Redis.
