# Periodic maintenance adoption

Use `PeriodicMaintenanceRunner` when one process must invoke a module-owned
maintenance task sequentially, wait a fixed delay after each successful cycle
and stop with a bounded drain. The Kit is framework-free and inert: importing
it starts no timer, opens no connection and changes no default API or worker
composition.

Do not use the runner as durable scheduling state. It does not remember a due
time across restarts, elect one replica, retry a failed cycle or prove that a
side effect happened once.

## Choose the boundary

The adopting product owns one task and all of its business semantics. Before
adoption, define:

- the durable state that makes a cycle repeatable after a crash;
- how concurrent replicas claim or fence the same work;
- whether an expected item-level failure is handled inside the task;
- which task rejection is severe enough to fail the process;
- the process owner that creates the abort signal and closes dependencies.

Use BullMQ instead when work needs durable enqueue, attempts or replay. Use a
provider scheduler or product-owned due table when wall-clock execution must
survive a stopped process. A periodic runner may trigger those mechanisms, but
it does not replace them.

## Compose one task

Keep the task in its owning module and construct the runner in the process
composition root:

```ts
const runner = new PeriodicMaintenanceRunner(
  async (signal) => {
    await expiredReservations.releaseDue({ signal })
  },
  {
    delayMs: 30_000,
    shutdownGraceMs: 5_000,
    observer: (event) => maintenanceTelemetry.observe(event),
  },
)

await runner.run(abortController.signal)
```

`runOnStart` defaults to `true`. Set it to `false` only when the process must
wait one full delay before its first cycle. Delays are positive finite integer
milliseconds; shutdown grace is a non-negative finite integer. One instance is
single-use because it represents one process lifecycle.

The observer is telemetry-only. It receives cycle start, success, failure and
grace-exceeded events without product payloads. Its exceptions are suppressed.
Do not use the observer to persist task progress or make business decisions.

## Failure and timing semantics

Cycles never overlap. The next delay starts after a successful task settlement,
so slow work shifts the following cycle instead of queuing interval ticks. A
synchronous task throw is treated like a rejected Promise. Before shutdown, a
task rejection emits `cycle_failed` and rejects `run()` with the same value;
the process owner decides how to report and exit.

If an expected failure should not stop future cycles, handle it inside the task
without hiding loss of durable work. The runner owns no retry classifier,
backoff or dead-letter policy.

## Shutdown and recovery

Abort the runner before closing any dependency used by the active task. Abort
immediately closes admission and interrupts an idle delay. The same signal is
visible to the active task, which should cooperate where its adapter supports
cancellation.

The runner waits at most `shutdownGraceMs` for active work. If abort wins the
race, a success or failure inside that grace is observed but requested shutdown
still resolves normally. When grace expires, the runner emits
`shutdown_grace_exceeded`, detaches safely from the task and stops calling the
observer. JavaScript work cannot be forcibly terminated, so the process owner
may continue its bounded shutdown after the runner returns; the task and its
durable recovery design must tolerate dependency closure after grace expiry.

A late task rejection is consumed to prevent an unhandled rejection, but its
business effect remains unknown. Recovery must come from module-owned durable
claims, idempotency, reconciliation or fencing. With multiple replicas, assume
every replica may run the task; this Kit is not a distributed lock.

## First adopter and removal

`OutboxRelayRunner` is the first in-repository adopter. It preserves its public
class, token, `run(signal)` method and one-second poll/ten-second shutdown
defaults while delegating process-local sequencing to this Kit. Outbox leases,
publication retry, redrive and consumer idempotency remain outbox policy.

To remove the Kit from an adopter, first replace it with an equivalent
process-owned lifecycle that keeps admission, drain and recovery semantics.
Then remove the import. There is no schema, environment, OpenAPI or generated
contract migration.
