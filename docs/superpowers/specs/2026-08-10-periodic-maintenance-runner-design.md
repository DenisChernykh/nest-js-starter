# Periodic Maintenance Runner Design

## Context

The starter already contains an outbox-specific polling loop that runs one
relay cycle at a time, waits between completed cycles and performs bounded
shutdown. Gift Bot and Amazing EKB repeat the same process-local lifecycle for
due work and lease recovery while keeping different durable state, ordering and
failure policies.

`REL-03` extracts only that repeated lifecycle. It remains an inert platform
Kit: importing its file starts no timer, opens no connection and changes no
default API or worker composition.

## Public contract

`src/platform/maintenance/periodic-maintenance-runner.ts` exports:

```ts
export type PeriodicMaintenanceTask = (signal: AbortSignal) => Promise<void>

export type PeriodicMaintenanceEvent =
  | { readonly type: 'cycle_started' }
  | { readonly type: 'cycle_succeeded'; readonly durationMs: number }
  | {
      readonly type: 'cycle_failed'
      readonly durationMs: number
      readonly error: unknown
    }
  | {
      readonly type: 'shutdown_grace_exceeded'
      readonly graceMs: number
    }

export type PeriodicMaintenanceObserver = (
  event: PeriodicMaintenanceEvent,
) => void

export interface PeriodicMaintenanceOptions {
  readonly delayMs: number
  readonly shutdownGraceMs: number
  readonly runOnStart?: boolean
  readonly observer?: PeriodicMaintenanceObserver
}

export class PeriodicMaintenanceRunner {
  public constructor(
    task: PeriodicMaintenanceTask,
    options: PeriodicMaintenanceOptions,
  )

  public run(signal: AbortSignal): Promise<void>
}
```

`delayMs` is a positive finite integer. `shutdownGraceMs` is a non-negative
finite integer. Invalid options throw `RangeError`. `runOnStart` defaults to
`true`.

One runner instance represents one process lifecycle and accepts one `run()`
call. A second call rejects as a configuration error before admitting another
cycle.

## Cycle and failure semantics

The runner invokes at most one task at a time. A fixed delay begins only after
a successful cycle settles; it is not a fixed-rate interval. With
`runOnStart: false`, the same abortable delay precedes the first cycle.

The task receives the caller's `AbortSignal`. Synchronous task throws are
normalized through a Promise. Before shutdown, a rejected cycle emits
`cycle_failed` and rejects `run()` with the same error. A consumer that may
continue after an expected failure must handle that failure inside its own
task; the runner does not own retry or classification policy.

When abort wins during an active cycle, the runner closes admission and waits
up to `shutdownGraceMs`. Settlement during this drain does not turn requested
shutdown into process failure. If the grace expires, the runner emits
`shutdown_grace_exceeded`, prevents a late unhandled rejection and returns; it
cannot forcibly stop JavaScript work. Durable claims, fencing and idempotency
remain consumer-owned recovery mechanisms.

The optional observer receives lifecycle events without a product payload.
Observer exceptions are ignored and never replace task results. No settlement
event is delivered after a grace timeout returns control to the process owner.
Durations use a monotonic clock and are finite non-negative milliseconds.

## First adopter

`OutboxRelayRunner` remains the stable outbox-facing class and Nest token. Its
constructor defaults stay at a one-second poll delay and ten-second shutdown
grace. It delegates process-local lifecycle behavior to
`PeriodicMaintenanceRunner` while keeping `OutboxRelay.runOnce()`, retry,
lease, redrive and BullMQ policy unchanged.

The starter still does not register an outbox relay executable in the default
API, package scripts, image command or Compose topology.

## Boundaries and recovery

The Kit does not provide cron expressions, persisted schedules, a distributed
singleton, retries, backoff, DLQ, BullMQ composition or product task state.
Multiple replicas may run the same maintenance task; the adopting product must
use durable due state and safe claims when that topology is allowed.

Adoption consists of constructing the runner around one module-owned
`runOnce(signal)` and letting the process owner await `run(signal)`. Removal is
local: replace the runner with an equivalent process lifecycle before deleting
the Kit. No schema, generated contract or environment migration is involved.

## Verification

Focused unit tests prove option validation, single-use admission, immediate and
delayed starts, fixed-delay sequencing, abort behavior, bounded drain,
fail-fast error identity, late rejection safety and observer isolation.
Existing outbox unit and runtime-module integration tests protect the adopter.
The final branch must pass `pnpm check:quick`, `pnpm check` and
`pnpm oci:check` without changing dependencies or generated contracts.
