# Opt-in BullMQ platform boundary

`src/platform/queue` is reusable infrastructure for a copied product. It does
not define a product queue, a job payload, a processor, an enqueue service or a
worker executable.

## What this boundary owns

- `requireQueueRuntimeConfig` requires `REDIS_QUEUE_URL` only when an adopting
  composition root asks for queue configuration. The default API never asks for
  it.
- `buildQueueWorkerRuntimeConfig` and `createQueueWorkerRuntimeConfig` validate
  the minimal standalone-worker environment; a worker needs only
  `REDIS_QUEUE_URL`, not database, auth Redis or auth-secret settings.
- `BullmqConnectionModule.forProducer` and `.forWorker` create exactly one
  root BullMQ connection with their respective retry policies. Neither method
  registers a queue or declares a processor.
- `QueueReadinessIndicator` performs a bounded readiness check without creating
  or closing a queue client.
- `runWorkerApplication` in `src/bootstrap/workers` owns bounded Nest
  application-context shutdown after `SIGINT` or `SIGTERM`; it does not know a
  queue name or feature module. The copied process owner injects
  `forceExit: (code) => process.exit(code)`; the helper never calls
  `process.exit()` itself.

Queue Redis is independent from auth Redis. Never pass `REDIS_AUTH_URL` to
BullMQ, reuse the auth Redis socket or treat the auth Redis loss procedure as a
queue recovery procedure.

## Local dependency

The default local workflow starts auth Redis but no queue Redis. Start the
dedicated development dependency only when working on a product adoption:

```sh
docker compose --profile queues up -d redis-queue
```

The local sample URL is commented out in `.env.example`. Supplying it to an API
without product queue composition changes nothing: this boundary remains inert
until the product registers its own queue.

## Product adoption

Follow [the durable-jobs adoption guide](../../../docs/architecture/durable-jobs.md)
before adding feature code. The product owns its queue/job constants,
discriminated payload, producer port and adapter, queue registration, processor,
worker bootstrap, durability and idempotency choices. For an incident, follow
[the queue Redis-loss runbook](../../../docs/runbooks/queue-redis-loss.md), not
the auth Redis runbook.
