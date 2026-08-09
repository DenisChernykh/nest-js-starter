# Adopting the transactional outbox

Use `platform/outbox` when one PostgreSQL business transaction must cause
later BullMQ work and losing the work between database commit and `Queue.add`
is unacceptable. The kit is opt-in: the default API, Compose topology and
OpenAPI remain unchanged until a product supplies a real destination, queue,
processor and process owner.

This guide shows the required ownership boundaries. Names such as `orders` and
`order-notifications` are illustrative product choices, not starter defaults.

## Decide before adopting

Adopt the outbox only after the product can answer all of these questions:

- Which committed business transition produces the message?
- Which single logical destination and consumer-owned queue receive it?
- What is the allowlisted, versioned payload schema?
- Which failures may retry and which require operator repair?
- How does the consumer make duplicate delivery safe?
- Which durable product state proves completion and supports reconciliation?

Use direct BullMQ publication instead when the work is not coupled to the same
PostgreSQL transaction. Do not adopt this kit for synchronous results, an audit
history, fan-out, strict ordering or exactly-once delivery.

## Runtime topology

```text
API or command process
  feature use case
    -> feature-owned application port
    -> feature infrastructure adapter
    -> TransactionalOutboxWriter.append()
    -> business rows + OutboxMessage commit atomically

relay process
  OutboxRelayRuntimeModule.forBullMq(...)
    -> claim one destination with a PostgreSQL lease
    -> publish canonical envelope with jobId = messageId

consumer worker
  feature-owned @Processor
    -> validate type and version
    -> perform an idempotent product operation
    -> record/reconcile authoritative product state
```

The relay is not the product worker. `PUBLISHED` records only accepted enqueue;
BullMQ job completion or failure does not update the outbox row.

## 1. Define a feature-owned application port

Application code must not import `platform/outbox`. Define a port in the
adopting feature and keep the event name and payload policy product-owned:

```ts
export interface OrderEventsPort {
  orderConfirmed(input: {
    readonly orderId: string
    readonly customerId: string
    readonly occurredAt: Date
    readonly correlationId?: string
  }): Promise<void>
}

export const ORDER_EVENTS = Symbol('ORDER_EVENTS')
```

Call the port inside the same existing transaction as the business mutation:

```ts
await this.transaction.run(async () => {
  await this.orders.confirm(input.orderId)
  await this.events.orderConfirmed({
    orderId: input.orderId,
    customerId: input.customerId,
    occurredAt: this.clock.now(),
    correlationId: input.correlationId,
  })
})
```

Do not catch an append failure and continue toward commit. A failed append must
fail the enclosing operation so neither the business change nor the outbox row
commits alone.

## 2. Implement the port with the writer

The feature infrastructure adapter translates its allowlisted contract into
one canonical draft:

```ts
@Injectable()
export class OrderOutboxEventsAdapter implements OrderEventsPort {
  public constructor(private readonly outbox: TransactionalOutboxWriter) {}

  public async orderConfirmed(input: {
    readonly orderId: string
    readonly customerId: string
    readonly occurredAt: Date
    readonly correlationId?: string
  }): Promise<void> {
    await this.outbox.append({
      destination: 'orders',
      type: 'order.confirmed',
      version: 1,
      occurredAt: input.occurredAt,
      ...(input.correlationId === undefined
        ? {}
        : { correlationId: input.correlationId }),
      partitionKey: input.orderId,
      payload: {
        orderId: input.orderId,
        customerId: input.customerId,
      },
    })
  }
}
```

The feature composition module imports `OutboxModule.forWriter()` and binds the
feature port to that adapter:

```ts
@Module({
  imports: [OutboxModule.forWriter()],
  providers: [
    OrderOutboxEventsAdapter,
    { provide: ORDER_EVENTS, useExisting: OrderOutboxEventsAdapter },
  ],
})
export class OrdersModule {}
```

`append()` throws `OutboxTransactionRequiredError` outside an active
`TransactionPort.run()` callback. The payload must be a JSON object no larger
than 64 KiB and must not contain binary data or credentials. Treat the generic
credential-key rejection as defense in depth: validate a feature-owned
allowlist before calling the writer and prefer identifiers over full business
aggregates.

## 3. Compose one bounded relay process

One relay composition maps one logical destination to one consumer queue. It
requires only PostgreSQL, queue Redis and logging/service identity:

```ts
const config = createOutboxRelayRuntimeConfig()

@Module({
  imports: [
    OutboxRelayRuntimeModule.forBullMq({
      config,
      destination: 'orders',
      queueName: 'order-notifications',
      queueOptions: {
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 1_000 },
          removeOnComplete: { age: 86_400 },
          removeOnFail: { age: 604_800 },
        },
      },
    }),
  ],
})
class OrderOutboxRelayApplication {}
```

The executable creates a Nest application context, obtains
`OUTBOX_RELAY_RUNNER` and calls `runner.run(abortController.signal)`. On
`SIGINT` or `SIGTERM`, abort the runner first, await its bounded shutdown, and
only then close the Nest context. Treat an unexpected `run()` rejection as a
process failure. `OutboxRelayRunner` delegates only this process-local sequence
to the shared [periodic maintenance Kit](periodic-maintenance.md); its token,
constructor defaults and outbox policy remain unchanged. The starter
deliberately does not register this process in the default package scripts,
image command or Compose file.

The relay defaults are a 50-message batch, one-second polling and a 30-second
lease. It releases database locks before calling BullMQ. Retryable publication
errors return to `PENDING` with full-jitter exponential backoff from one second
to five minutes; terminal errors become `BLOCKED`.

## 4. Build an idempotent consumer

The feature worker owns its queue registration and processor. Consume the
canonical envelope rather than defining a second relay payload:

```ts
@Processor('order-notifications')
export class OrderNotificationProcessor extends WorkerHost {
  public async process(job: Job<OutboxMessageEnvelope>): Promise<void> {
    const message = job.data
    if (message.destination !== 'orders') throw new UnsupportedMessageError()
    if (message.type !== 'order.confirmed' || message.version !== 1) {
      throw new UnsupportedMessageError()
    }

    await this.delivery.handleOnce({
      idempotencyKey: message.messageId,
      orderId: String(message.payload['orderId']),
      customerId: String(message.payload['customerId']),
    })
  }
}
```

Validate the envelope and the feature payload at the consumer boundary; the
casts above only keep the ownership example short. Make `handleOnce` durable.
For a database-only effect, a unique processed-message key can share the effect
transaction. For an external API, pass a downstream idempotency key when the
provider supports one and retain product reconciliation state. An in-memory
set is not an idempotency strategy.

The relay may crash after `Queue.add()` and before marking the row `PUBLISHED`.
The expired lease then permits another publish. Stable BullMQ job IDs reduce
duplicates while the retained job exists, but they do not provide exactly-once
delivery.

## 5. Expose controlled operator actions

Do not add these operations to the public product API by default. A protected
CLI, internal operator command or scheduled process can import
`OutboxModule.forRelay(databaseConfig)` and obtain `OUTBOX_STORE`:

```ts
const store = application.get<OutboxStorePort>(OUTBOX_STORE)

const backlog = await store.diagnostics()

await store.redrive({
  id: messageId,
  expectedStatus: 'BLOCKED',
  allowDuplicate: false,
})

await store.redrive({
  id: publishedMessageId,
  expectedStatus: 'PUBLISHED',
  allowDuplicate: true,
})
```

Diagnostics return counts and oldest pending timestamps by destination, never
payloads. Redrive exactly one row after repairing its cause. A published
redrive requires `allowDuplicate: true` because delivery may happen again.

Run the exported `OUTBOX_RETENTION_CLEANUP` from an operator-owned periodic
lifecycle. One invocation deletes at most 500 `PUBLISHED` rows older than seven
days. It never deletes `BLOCKED` rows. A product may wrap `runOnce()` in a
separate `PeriodicMaintenanceRunner`, but it must choose the interval and
process owner explicitly; the starter does not schedule retention by default.

## Adoption proof

Before enabling the new processes, prove all of the following:

- business mutation and append commit and roll back together in PostgreSQL;
- the feature rejects append outside the transaction and invalid payloads;
- a real Redis integration delivers the canonical envelope with stable job ID;
- the processor safely repeats the same `messageId`;
- crash after enqueue and lease recovery cause no lost product operation;
- retryable and terminal failures reach the intended states;
- diagnostics, one-row redrive and retention expose no payload;
- relay and worker stop within their bounded shutdown contracts;
- the unchanged default OpenAPI and default Compose topology remain inert.

For incident procedures and the complete state-machine contract, follow the
[transactional outbox runbook](../runbooks/transactional-outbox.md). For the
consumer-owned worker boundary, follow [durable jobs with BullMQ](durable-jobs.md).
