# Runtime lifecycle

## Startup and traffic admission

`ApiRuntime` validates configuration and initializes Nest before opening the
listener. The listener opens while lifecycle state is `starting`, so health is
observable, but the traffic gate rejects `/v1` with `503`. The database owner
then connects Prisma and verifies PostgreSQL within one configured deadline.
Only a successful dependency check moves the irreversible startup latch to
`ready` and admits application traffic.

Startup failure begins drain, closes the partial Nest application and database
resources, and exits with code 1. The process removes signal watchers installed
for a runtime that never became operational. The API never retries forever and
never runs migrations.

## Health semantics

- `/health/live` is `200` while the process can serve HTTP, independent of
  PostgreSQL.
- `/health/startup` is `503` until the first completed startup and remains `200`
  after the latch, including a later dependency outage.
- `/health/ready` is `200` only in `ready` state with every required registered
  dependency up. Starting, draining, timeout, abort or PostgreSQL failure is
  `503` without exposing credentials or driver errors.

PostgreSQL health uses a dedicated Pool client and destructive release on its
deadline. Ordinary Prisma business operations are not cancellable: shutdown
stops new admission and waits for already admitted operations to settle.

## Transaction boundary

Application code depends on `TransactionPort`; Prisma remains in module-local
infrastructure. AsyncLocalStorage supplies the current transaction client.
Nested calls join the outer interactive transaction, and a nested failure marks
the context rollback-only even if an outer callback catches the original error.

## Graceful shutdown

The first `SIGTERM` or `SIGINT` synchronously latches `draining`. Shutdown then:

1. refuses new application work while health reports not ready;
2. closes the HTTP listener and idle keep-alive connections;
3. waits for admitted HTTP and infrastructure operations within their bounds;
4. closes registered participants in explicit order, currently Prisma and its
   externally owned Pool;
5. closes Nest and exits 0 only when every required step settles cleanly.

Repeated signals share the same coordination promise. A process-level hard
watchdog exits 1 when a non-settling operation outlives the grace window; this
does not claim that an already running Prisma query was cancelled.

`ShutdownRegistry` is the extension point for later Redis and telemetry
flushers. Participants must declare stable names/order and bounded cleanup.
Migrations and down migrations are never part of API startup or shutdown.
