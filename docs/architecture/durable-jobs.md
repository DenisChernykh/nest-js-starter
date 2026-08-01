# Durable jobs with BullMQ

This starter supplies an opt-in BullMQ platform boundary. It does not ship a
product queue, job payload, producer adapter, processor or worker executable.
Adopt durable jobs only when a concrete workflow needs retries, replay or work
outside the API process.

## Linear adoption path

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

The feature application defines the producer port. Its infrastructure adapter
uses the feature-owned queue name and payload to enqueue work. API composition
uses `BullmqConnectionModule.forProducer` and registers that feature queue;
worker composition uses `.forWorker`, registers the same queue and declares the
feature processor. This keeps BullMQ imports out of feature domain,
application and presentation code.

The copied product, not this starter, then adds a worker `main` under
`src/bootstrap/workers`, a compiled package command for that entrypoint and a
focused real-Redis integration test that exercises the feature payload. The
worker creates its Nest application context and delegates only context lifecycle
to `runWorkerApplication`.

## Configuration and runtime separation

`REDIS_QUEUE_URL` is optional for the starter and required only at an adopting
queue composition boundary. It must point to queue Redis, never to
`REDIS_AUTH_URL`. The default API gets no queue URL and imports neither the
queue connection module nor a worker. Locally, start queue Redis only with:

```sh
docker compose --profile queues up -d redis-queue
```

That profile supplies a separate persistent Redis container with AOF,
`appendfsync always` and `noeviction`; it does not create a product queue or
start a worker. The product's worker lifecycle, health endpoint and rollout
order are independent from the API's auth Redis lifecycle.

## Decisions the adopting product must make

Before registering a queue, record and test all of the following for the named
workflow:

- attempts, backoff, retention, concurrency and rate limits;
- retryable versus terminal errors;
- idempotency key and duplicate-delivery handling;
- authoritative durable business state and its reconciliation path;
- commit-to-enqueue policy, including whether a PostgreSQL outbox is required;
- allowlisted operational diagnostics that exclude payload secrets and URLs.

BullMQ delivery state is not product history. A queue may redeliver work after
worker or Redis recovery, so successful handling must be safe to repeat. A
product that cannot tolerate a database-to-queue loss window must design and
operate an outbox rather than assuming `Queue.add` makes the database commit
atomic.

## Verification and recovery

Keep a feature-focused real Redis integration test alongside the worker and
producer composition. Verify the unchanged starter with `pnpm check` and its
runtime image with `pnpm oci:check` after a product adoption. For an outage or
data-loss incident, follow [queue Redis loss](../runbooks/queue-redis-loss.md).
It is intentionally separate from [auth Redis loss](../runbooks/auth-redis-loss.md).
