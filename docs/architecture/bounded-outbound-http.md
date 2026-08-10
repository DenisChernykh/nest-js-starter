# Bounded outbound HTTP adoption

Use `FetchOutboundHttpAttemptTransport` only when a module needs one explicit,
bounded native-`fetch` attempt. Add `BoundedOutboundHttpRunner` only when that
module also owns a finite retry sequence and can synchronously classify every
typed attempt outcome.

This is a framework-free, inert-by-default Kit. It does not register a Nest
module or global `HttpService`, wrap a provider SDK, choose successful or
retryable statuses, add an environment variable or dependency, persist work,
or install a default composition or adopter. The consuming module owns the
provider configuration, credentials, request shape, status policy, retry
policy and recovery contract.

## Select the boundary

Adopt the Kit only after the consuming module can answer all of these
questions:

- Which single outbound operation is being bounded, and is native `fetch` the
  correct provider boundary?
- Which response statuses and body states mean success, terminal failure or a
  retry for this provider operation?
- Is the operation idempotent, or which stable idempotency key and durable
  product state make an ambiguous retry safe?
- What total deadline, attempt budget, per-attempt timeout, response-body cap
  and retry delays fit the provider contract?
- Which outer lifecycle supplies the required abort signal?
- How will the module reconcile an unknown remote effect after timeout, abort
  or process restart?

Use a provider SDK directly when its protocol semantics are the required
boundary. Use BullMQ or another durable runner when work admission must survive
a process restart. Use the transactional outbox only when a PostgreSQL business
transaction must atomically create later queued work. None of those choices
delegate product status or idempotency policy to this Kit.

## Construct the attempt and classifier in the module

Keep provider data in the closures passed to the runner. The following is an
illustrative module adapter, not a starter default or an existing adopter:

```ts
import {
  BoundedOutboundHttpRunner,
  type OutboundHttpAttempt,
  type OutboundHttpOutcomeClassifier,
  type OutboundHttpRunnerObserver,
} from '@/platform/http/outbound/bounded-outbound-http-runner'
import { FetchOutboundHttpAttemptTransport } from '@/platform/http/outbound/fetch-outbound-http-attempt-transport'

interface ProviderSnapshotConfig {
  readonly endpoint: URL
  readonly accessToken: string
  readonly maxAttempts: number
  readonly deadlineMs: number
  readonly attemptTimeoutMs: number
  readonly retryDelayMs: number
  readonly maxResponseBytes: number
  readonly observer: OutboundHttpRunnerObserver
}

export async function requestProviderSnapshot(
  config: ProviderSnapshotConfig,
  accountId: string,
  signal: AbortSignal,
) {
  const transport = new FetchOutboundHttpAttemptTransport()
  const runner = new BoundedOutboundHttpRunner({
    maxAttempts: config.maxAttempts,
    deadlineMs: config.deadlineMs,
    observer: config.observer,
  })
  const endpoint = new URL(config.endpoint)
  endpoint.searchParams.set('accountId', accountId)

  const attempt: OutboundHttpAttempt = ({ signal: attemptSignal }) =>
    transport.execute(
      {
        input: endpoint,
        init: {
          method: 'GET',
          headers: {
            authorization: `Bearer ${config.accessToken}`,
          },
        },
        timeoutMs: config.attemptTimeoutMs,
        responseBody: {
          type: 'buffer',
          maxBytes: config.maxResponseBytes,
        },
      },
      attemptSignal,
    )

  const classifier: OutboundHttpOutcomeClassifier = (outcome, context) => {
    if (outcome.type === 'response') {
      if (outcome.status === 200 && outcome.body.type === 'buffered') {
        return { type: 'succeed' }
      }
      if (
        (outcome.status === 429 || outcome.status >= 500) &&
        context.remainingAttempts > 0
      ) {
        return { type: 'retry', nextDelayMs: config.retryDelayMs }
      }
      return { type: 'fail' }
    }

    if (
      (outcome.type === 'timeout' || outcome.type === 'transport_error') &&
      context.remainingAttempts > 0
    ) {
      return { type: 'retry', nextDelayMs: config.retryDelayMs }
    }
    return { type: 'fail' }
  }

  return runner.run(attempt, classifier, signal)
}
```

The `attempt` closes over endpoint, credentials, the idempotent snapshot
request, per-attempt timeout and body policy. The synchronous `classifier`
closes over the provider status and delay policy.
`run(attempt, classifier, signal)` receives no generic product context. The
example statuses are illustrative and must not be copied as a platform default.

The required outer signal belongs to the process or request lifecycle. Each
admitted attempt receives a child signal; passing that signal to
`transport.execute()` lets the transport compose runner interruption with its
own timeout.

## Bound one native-fetch attempt

Every request selects an explicit body mode:

- `{ type: 'ignore' }` cancels an available response body without reading it
  and returns body state `ignored`.
- `{ type: 'buffer', maxBytes }` permits only a non-negative safe-integer cap.
  A syntactically valid decimal `Content-Length` above the cap cancels the body
  before reading. Missing or malformed length is never trusted: streaming reads
  count each chunk before retaining it, cancel on the first overflow and return
  `limit_exceeded` without partial bytes. A non-stream response is subject to
  the same cap.

The positive `timeoutMs` starts before `fetch` and remains active through
headers and complete body handling. A response outcome preserves the status,
real `Headers`, body state and `durationMs`. `timeout`, `transport_error` and
`aborted` are separate typed outcomes and also carry finite, non-negative
durations. Only `transport_error` retains the original error for the in-process
classifier; the observer never receives it.

`timeoutMs` must be a positive finite integer no greater than
`2_147_483_647`; buffered `maxBytes` must be a non-negative safe integer. An
invalid request or body option throws `RangeError` before fetch or timer
admission.

The transport imposes no HTTP success or retry rule. A `200`, `429`, `500` or
body-limit response is only data for the consuming classifier.

## Bound the complete retry sequence

`BoundedOutboundHttpRunner` admits at most `maxAttempts` within one monotonic,
absolute `deadlineMs`. Attempt execution and every classifier-selected
`nextDelayMs` consume that same deadline; a retry does not receive a fresh
budget. The outer signal can stop active work or backoff, and an already-aborted
signal wins over the clock before admission.

The constructor requires `deadlineMs` to be a positive finite integer no
greater than `2_147_483_647` and `maxAttempts` to be a positive safe integer.
Invalid constructor options throw `RangeError` before `run()` or attempt
admission. An explicit `nextDelayMs` must be a non-negative finite integer no
greater than `2_147_483_647`; omission means zero. An invalid retry delay throws
`RangeError` before `retry_scheduled`, a timer or a new attempt, including when
that retry decision came from the final allowed attempt.

The classifier is the sole authority for `succeed`, `fail` or `retry`. A final
retry decision produces `failed/exhausted`; `fail` produces `failed/terminal`.
Outer cancellation and the total deadline produce `aborted` and
`deadline_exceeded`. Attempt or classifier throws are contract errors: they
propagate unchanged rather than becoming automatic retries.

These are local admission and waiting bounds, not remote transaction bounds. A
timeout, deadline or abort cannot prove that the provider did not receive or
apply a request.

## Emit only safe observer metadata

The optional observer receives only attempt number, outcome category, response
status, body state, duration, remaining time, retry delay, final result and
terminal/exhausted reason. It never receives a raw URL, headers, request body,
response bytes, original error, credentials or secrets.

Observer work is best-effort telemetry. Synchronous throws and runtime
Promise-like rejections are suppressed, so telemetry failure cannot change the
classifier result or attempt admission. Do not use the observer as durable
progress, reconciliation state or business control flow.

## Failure and recovery checklist

Before enabling a module-owned composition:

- record a stable provider idempotency key where supported and keep the
  authoritative pending/applied/unknown state durably;
- prove the strict response cap with missing, malformed, exact and oversized
  `Content-Length` plus incremental overflow;
- test timeout during both header wait and body streaming;
- test outer abort during an attempt and retry delay;
- prove the classifier's terminal, exhausted and successful outcomes without
  relying on a status default;
- verify that telemetry contains none of the excluded request, response, error
  or secret values.

During an incident:

- treat `timeout`, `deadline_exceeded` and ambiguous abort as an unknown remote
  effect; query provider state or run module-owned reconciliation before a
  non-idempotent retry;
- treat `limit_exceeded` as no usable body—no partial bytes are returned—and
  follow the module's terminal or re-fetch policy;
- recover work after process restart from consumer-owned durable state. The Kit
  stores no attempt, delay or completion state and survives no restart;
- keep observer repair separate from delivery repair because observer failure
  is intentionally isolated;
- abort the runner before closing dependencies used by the active attempt.

For removal:

1. Stop the module-owned composition from admitting new work.
2. Reconcile every durable pending or unknown operation under the consumer's
   existing provider policy.
3. Replace the import with a module-owned provider boundary that preserves any
   still-required timeout, body, abort and idempotency guarantees.
4. Remove the transport/runner construction and focused consumer tests.

The Kit itself adds no schema, environment input, generated contract, Nest
module, dependency, daemon or default composition, so removing it requires no
starter migration. Consumer-owned configuration or state is removed only under
that consumer's own lifecycle.

## Evidence scenarios are unchanged

Amazing EKB cache revalidation and the Threads follower snapshot demonstrate
the independent need for bounded outbound HTTP with different provider-owned
status, delay, loss and recovery policies. They are evidence scenarios only.
This Kit does not change either repository, runtime or configuration, and it
does not make either product a starter adopter.
