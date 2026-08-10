# Bounded Outbound HTTP Runner Design

## Context and scope

`INT-01` is a framework-free, inert-by-default Kit for one outbound HTTP
attempt and a bounded, classifier-controlled sequence of attempts. Importing
it starts no work, opens no connection and changes no API, worker or HTTP
status default. It adds no Nest module, adopter, dependency, environment
variable, persistence, circuit breaker, provider SDK or idempotency policy.

Amazing EKB cache revalidation and a Threads follower snapshot are the named
evidence consumers. They retain their product-owned credentials, provider
status policy, persistence, durable recovery and idempotency decisions; their
repositories are not changed by this Kit.

The layers live under `src/platform/http/outbound`:

1. `FetchOutboundHttpAttemptTransport` makes one native-fetch attempt,
   composes its timeout with the caller abort signal, and bounds body handling.
2. `BoundedOutboundHttpRunner` admits a finite sequence of consumer attempts
   within one absolute deadline. It never decides that an HTTP status is good,
   bad or retryable.

## Public contract

`src/platform/http/outbound/fetch-outbound-http-attempt-transport.ts` exports:

```ts
export type OutboundHttpResponseBodyMode =
  | { readonly type: 'ignore' }
  | { readonly type: 'buffer'; readonly maxBytes: number }

export interface OutboundHttpAttemptRequest {
  readonly input: string | URL
  readonly init?: Omit<RequestInit, 'signal'>
  readonly timeoutMs: number
  readonly responseBody: OutboundHttpResponseBodyMode
}

export type OutboundHttpFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

export type OutboundHttpResponseBody =
  | { readonly type: 'ignored' }
  | { readonly type: 'buffered'; readonly bytes: Uint8Array }
  | { readonly type: 'limit_exceeded'; readonly maxBytes: number }

export type OutboundHttpAttemptOutcome =
  | {
      readonly type: 'response'
      readonly status: number
      readonly headers: Headers
      readonly body: OutboundHttpResponseBody
      readonly durationMs: number
    }
  | { readonly type: 'timeout'; readonly durationMs: number }
  | {
      readonly type: 'transport_error'
      readonly error: unknown
      readonly durationMs: number
    }
  | { readonly type: 'aborted'; readonly durationMs: number }

export class FetchOutboundHttpAttemptTransport {
  public constructor(fetch?: OutboundHttpFetch)

  public execute(
    request: OutboundHttpAttemptRequest,
    signal: AbortSignal,
  ): Promise<OutboundHttpAttemptOutcome>
}
```

When no `fetch` is provided, the constructor uses `globalThis.fetch`.
`execute()` always requires the caller signal; `init` deliberately excludes
`signal` so the transport alone composes the operational signal.

`src/platform/http/outbound/bounded-outbound-http-runner.ts` exports:

```ts
export interface OutboundHttpAttemptContext {
  readonly attempt: number
  readonly signal: AbortSignal
}

export type OutboundHttpAttempt = (
  context: OutboundHttpAttemptContext,
) => Promise<OutboundHttpAttemptOutcome>

export type OutboundHttpRetryDecision =
  | { readonly type: 'succeed' }
  | { readonly type: 'fail' }
  | { readonly type: 'retry'; readonly nextDelayMs?: number }

export interface OutboundHttpClassifierContext {
  readonly attempt: number
  readonly remainingAttempts: number
  readonly remainingMs: number
}

export type OutboundHttpOutcomeClassifier = (
  outcome: OutboundHttpAttemptOutcome,
  context: OutboundHttpClassifierContext,
) => OutboundHttpRetryDecision

export interface BoundedOutboundHttpRunnerOptions {
  readonly maxAttempts: number
  readonly deadlineMs: number
  readonly observer?: OutboundHttpRunnerObserver
}

export type BoundedOutboundHttpRunnerEvent =
  | {
      readonly type: 'attempt_started'
      readonly attempt: number
      readonly remainingMs: number
    }
  | {
      readonly type: 'attempt_finished'
      readonly attempt: number
      readonly category: OutboundHttpAttemptOutcome['type']
      readonly status?: number
      readonly bodyState?: OutboundHttpResponseBody['type']
      readonly durationMs: number
    }
  | {
      readonly type: 'retry_scheduled'
      readonly attempt: number
      readonly delayMs: number
      readonly remainingMs: number
    }
  | {
      readonly type: 'run_finished'
      readonly result: OutboundHttpRunResult['type']
      readonly attempts: number
      readonly failureReason?: 'terminal' | 'exhausted'
    }

export type OutboundHttpRunnerObserver = (
  event: BoundedOutboundHttpRunnerEvent,
) => void

export type OutboundHttpRunResult =
  | {
      readonly type: 'succeeded'
      readonly outcome: OutboundHttpAttemptOutcome
      readonly attempts: number
    }
  | {
      readonly type: 'failed'
      readonly reason: 'terminal' | 'exhausted'
      readonly outcome: OutboundHttpAttemptOutcome
      readonly attempts: number
    }
  | { readonly type: 'aborted'; readonly attempts: number }
  | { readonly type: 'deadline_exceeded'; readonly attempts: number }

export class BoundedOutboundHttpRunner {
  public constructor(options: BoundedOutboundHttpRunnerOptions)

  public run(
    attempt: OutboundHttpAttempt,
    classifier: OutboundHttpOutcomeClassifier,
    signal: AbortSignal,
  ): Promise<OutboundHttpRunResult>
}
```

Product context is closure-owned by `attempt` and `classifier`; the runner has
no generic product-context argument. The observer's public return is `void`.
At runtime, its implementation defensively treats a returned Promise-like
value as best-effort telemetry and consumes a rejection.

## Validation, timing and abort precedence

`timeoutMs` and `deadlineMs` must be positive finite integers no greater than
`2_147_483_647`. `maxAttempts` must be a positive safe integer. Buffered
`maxBytes` must be a non-negative safe integer. A supplied `nextDelayMs` must
be a non-negative finite integer no greater than `2_147_483_647`; omitted
`nextDelayMs` is zero. Each invalid value throws `RangeError` before its fetch,
timer or retry admission.

The transport starts its timer before `fetch` and keeps it active through
headers and complete body handling. A monotonic clock measures every outcome;
each branch has a finite non-negative `durationMs`. A timeout is still an
ambiguous remote side effect: a local timeout cannot prove that the remote side
did not apply the request.

The runner records one monotonic start instant and calculates every attempt
and retry wait against the remaining time of the same absolute `deadlineMs`.
It does not issue a fresh deadline per attempt. Before every admission it gives
an already-aborted outer signal precedence over the clock. Outer abort or
deadline aborts active work and active backoff, stops admission, consumes any
late settlement, and permits no later observer event after the final result.

## Transport semantics

The transport composes the required caller signal and a timeout controller. A
caller abort produces `aborted`; an expired attempt timer produces `timeout`;
any other native fetch rejection produces `transport_error` with its original
error value for the in-process classifier. All three include duration.

`ignore` cancels an available response body without reading it and returns
`ignored`. Buffered mode first checks a valid `Content-Length`: when it is
larger than `maxBytes`, it cancels without reading and returns
`limit_exceeded`. Without that early proof, it reads incrementally, counts a
chunk before retaining it, cancels on the first overflow and returns no partial
bytes. A non-stream body has the identical cap. HTTP status and `Headers` are
returned for every response, including a body-limit result; no status default
or retry policy is imposed.

## Runner, observer and recovery semantics

Each admitted attempt receives `{ attempt, signal }`. The synchronous
classifier receives its typed outcome and
`{ attempt, remainingAttempts, remainingMs }`, then is the sole authority for
`succeed`, `fail` or `retry`. A final `retry` decision returns
`failed/exhausted`; a `fail` decision returns `failed/terminal`. Attempt or
classifier throws/rejections are contract errors: they propagate unchanged and
do not become an operational outcome or a retry.

Observer events use exactly `attempt_started`, `attempt_finished`,
`retry_scheduled` and `run_finished`. Their metadata is restricted to attempt,
outcome category, status, body state, duration, remaining time, retry delay,
result and failure reason. The Kit never sends raw URL, headers, request body,
response bytes or error values to telemetry. Synchronous observer throws and
runtime Promise-like rejections are suppressed; telemetry cannot alter result
selection or later admission.

A consumer that retries a non-idempotent request must keep enough
product-owned durable state to distinguish a remote effect from a local
timeout. Removing the Kit is local to each adopter: replace the module-owned
construction and remove its import. No schema, environment or generated
contract migration is involved.

## Verification and delivery

Focused transport and runner unit suites cover validation, public API shape,
all outcome durations, timer/abort precedence, body handling, classifier
contexts, observer isolation and final-result reasons. A native-fetch loopback
integration suite verifies real response streaming, cancellation and timeout
without an external provider. The committed branch then runs `pnpm check:quick`,
`pnpm check` and `pnpm oci:check`; a sandbox-blocked gate receives one retry of
that same scoped command in a host-capable context.

Delivery is exactly three commits:

1. `docs(platform): design bounded outbound HTTP runner`
2. `feat(platform): add bounded outbound HTTP runner` (transport, runner and
   loopback integration)
3. `docs(platform): document outbound HTTP adoption`

Work remains on `feat/bounded-outbound-http-runner` in its dedicated worktree.
An independent read-only `gpt-5.6-sol` reviewer uses `ultra` reasoning before
the PR, with at most three reviewer turns. Only a PASS permits one regular PR
to `stage`; this delivery does not merge or clean up the branch/worktree.
