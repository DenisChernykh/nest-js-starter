# Bounded Outbound HTTP Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the inert `INT-01` Kit that bounds native-fetch attempts,
response-body memory and classifier-controlled retries without accepting
product HTTP policy.

**Architecture:** `FetchOutboundHttpAttemptTransport` owns one fetch call, its
timeout and safe body outcome. `BoundedOutboundHttpRunner` owns one monotonic
deadline, attempt admission and abortable backoff; product data is closure-owned
by its attempt and synchronous classifier callbacks.

**Tech Stack:** Node.js 24 native `fetch` and streams, `npm:@typescript/typescript6`
(TypeScript 6.0.2), Jest 30, Node loopback `http`; NestJS is intentionally not
used by this Kit.

## Global Constraints

- Add no dependency, package, lockfile, environment, Prisma, OpenAPI or Compose change.
- Create sources only under `src/platform/http/outbound` and tests only under matching `test/.../platform/http/outbound` paths.
- Keep the Kit framework-free and inert: no Nest module, provider, adopter, background startup or status default.
- Keep credential, provider status, persistence, idempotency and circuit-breaker policy in adopting products.
- Emit only safe telemetry metadata; never emit raw URL, headers, request body, response bytes or raw error values.
- Do not add or update TSDoc. Do not change Amazing EKB or Threads repositories.

---

## File map

- `src/platform/http/outbound/fetch-outbound-http-attempt-transport.ts` — one fetch attempt, composed abort, bounded body and typed durations.
- `src/platform/http/outbound/bounded-outbound-http-runner.ts` — absolute deadline, classifier-only retries and isolated observer dispatch.
- `test/unit/platform/http/outbound/fetch-outbound-http-attempt-transport.spec.ts` — injected-fetch and stream unit tests.
- `test/unit/platform/http/outbound/bounded-outbound-http-runner.spec.ts` — fake-timer runner tests.
- `test/integration/platform/http/outbound/fetch-outbound-http-attempt-transport.integration.spec.ts` — loopback native-fetch proof.
- `docs/architecture/bounded-outbound-http.md` — later adopter, recovery and removal guidance.
- `README.md`, `docs/architecture/foundation-scope.md`, `docs/capability-catalog.md`, `docs/roadmap.md` — later discoverability updates.

### Task 1: Add the transport through RED to GREEN

**Files:**

- Create: `src/platform/http/outbound/fetch-outbound-http-attempt-transport.ts`
- Create: `test/unit/platform/http/outbound/fetch-outbound-http-attempt-transport.spec.ts`

**Interfaces:**

- Produces: `OutboundHttpAttemptRequest { input: string | URL; init?: Omit<RequestInit, 'signal'>; timeoutMs: number; responseBody: OutboundHttpResponseBodyMode }`, `OutboundHttpFetch`, every `OutboundHttpAttemptOutcome` branch with `durationMs`, and `FetchOutboundHttpAttemptTransport`.
- Calls: `new FetchOutboundHttpAttemptTransport(fetch?: OutboundHttpFetch)` and `transport.execute(request, signal)`; the omitted constructor argument uses `globalThis.fetch` and the signal is required.

- [ ] Write type/runtime tests proving the exported `OutboundHttpFetch` signature, `input`, `init` without `signal`, required `timeoutMs`, explicit body mode, required `execute` signal and default `globalThis.fetch`. Spy on `globalThis.fetch` to prove the no-argument constructor uses it.
- [ ] Run `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --config jest.unit.config.mjs --runInBand test/unit/platform/http/outbound/fetch-outbound-http-attempt-transport.spec.ts` and confirm the absent module fails.
- [ ] Implement the exact request/outcome exports and optional `OutboundHttpFetch` constructor. Reject zero, negative, fractional, infinite and greater-than-`2_147_483_647` `timeoutMs`; reject invalid `maxBytes` before calling fetch.
- [ ] Add failing tests for response, timeout, native transport error and outer abort. Assert each exact branch has a finite non-negative `durationMs`; preserve the native value only in `transport_error.error`.
- [ ] Implement monotonic timing and composed signals. Keep the attempt timeout active from fetch start through headers and body consumption; consume late fetch settlement after timeout or outer abort.
- [ ] Add failing body tests for ignore cancellation without reading, a buffered exact-limit body, `Content-Length` greater than `maxBytes`, a chunk overflow and a non-stream body overflow. Assert both overflow paths cancel and return no partial `bytes`.
- [ ] Implement ignore cancellation, Content-Length short-circuit and count-before-retain streaming. Preserve status and `Headers` only in the response result, never derive status success or retry policy.
- [ ] Rerun `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --config jest.unit.config.mjs --runInBand test/unit/platform/http/outbound/fetch-outbound-http-attempt-transport.spec.ts` and require PASS.

### Task 2: Add the runner through RED to GREEN

**Files:**

- Create: `src/platform/http/outbound/bounded-outbound-http-runner.ts`
- Create: `test/unit/platform/http/outbound/bounded-outbound-http-runner.spec.ts`

**Interfaces:**

- Consumes: `OutboundHttpAttemptOutcome` from Task 1.
- Produces: `OutboundHttpAttemptContext { attempt; signal }`, `OutboundHttpAttempt`, synchronous `OutboundHttpOutcomeClassifier`, `BoundedOutboundHttpRunnerOptions`, four observer event types and `OutboundHttpRunResult`.
- Calls: `runner.run(attempt, classifier, signal)` with a required signal. The attempt receives `{ attempt, signal }`; classifier receives outcome and `{ attempt, remainingAttempts, remainingMs }`.

- [ ] Add failing constructor tests for invalid `maxAttempts` and `deadlineMs`, including timer values above `2_147_483_647`. Add classifier tests for invalid retry delays; require `RangeError` before a later attempt is admitted.
- [ ] Run `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --config jest.unit.config.mjs --runInBand test/unit/platform/http/outbound/bounded-outbound-http-runner.spec.ts` and confirm the absent module fails.
- [ ] Implement validation, one monotonic absolute deadline and zero default retry delay. Check `signal.aborted` before the clock at every admission, so outer abort wins when both conditions are already true.
- [ ] Add failing tests that capture the attempt context and classifier context. Assert attempt numbers, the required attempt signal, `remainingAttempts`, finite non-negative `remainingMs`, synchronous decision use and closure-owned product data without a generic `run` context parameter.
- [ ] Implement sequential attempt admission. Permit retry only for `{ type: 'retry' }`; return `succeeded`, `failed/terminal` or a final retry as `failed/exhausted`, preserving last outcome and admitted attempts.
- [ ] Add fake-timer tests for explicit and omitted delay, deadline during backoff, deadline during an unresolved attempt and outer abort before/during an attempt. Assert active work/backoff is aborted, later settlement is consumed and no attempt begins after a final result.
- [ ] Implement active controllers, abortable waits and late-settlement handlers. Propagate thrown/rejected attempt or classifier callback errors unchanged; never translate them into retry/result branches.
- [ ] Add tests for exact observer event names `attempt_started`, `attempt_finished`, `retry_scheduled`, `run_finished`; inspect that events expose only attempt/category/status/body state/timing/delay/result/failure reason. Add an observer typed `void` that throws and a runtime-cast Promise-like rejection; both must be suppressed with no event after `run_finished`.
- [ ] Implement best-effort observer dispatch that catches synchronous throws and attaches rejection consumption to runtime Promise-like results, while its exported callback return remains `void`.
- [ ] Rerun `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --config jest.unit.config.mjs --runInBand test/unit/platform/http/outbound/fetch-outbound-http-attempt-transport.spec.ts test/unit/platform/http/outbound/bounded-outbound-http-runner.spec.ts` and require PASS.

### Task 3: Prove loopback native fetch and make the feature commit

**Files:**

- Create: `test/integration/platform/http/outbound/fetch-outbound-http-attempt-transport.integration.spec.ts`
- Verify: `src/platform/http/outbound/fetch-outbound-http-attempt-transport.ts`
- Verify: `src/platform/http/outbound/bounded-outbound-http-runner.ts`

**Interfaces:**

- Consumes: the Task 1 default/native fetch transport and Task 2 `run(attempt, classifier, signal)` API.
- Produces: native-fetch evidence for bounded streaming, cancellation and timeout without an external provider.

- [ ] Create an ephemeral `127.0.0.1` Node `http` fixture with small, oversized-stream and delayed routes. Observe server-side client close for the oversized and delayed routes.
- [ ] Add native-fetch tests for exact buffered bytes/status/real `Headers`, Content-Length short-circuit and chunk overflow cancellation with no partial bytes.
- [ ] Add a delayed-route test that proves timeout covers headers and body. Then run the runner with a closure-owned policy and terminal classifier result, proving no provider status default is imposed.
- [ ] Run `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --config jest.integration.config.mjs --runInBand test/integration/platform/http/outbound/fetch-outbound-http-attempt-transport.integration.spec.ts` and require PASS with no open handles.
- [ ] Commit all Task 1–3 sources and tests together as `feat(platform): add bounded outbound HTTP runner`; do not create a feature commit before the loopback integration suite is green.

### Task 4: Publish adoption, recovery and removal documentation

**Files:**

- Create: `docs/architecture/bounded-outbound-http.md`
- Modify: `README.md`, `docs/architecture/foundation-scope.md`, `docs/capability-catalog.md`, `docs/roadmap.md`

**Interfaces:**

- Documents: the exact public Kit contract, safe telemetry, timeout ambiguity, abort/deadline behavior and closure-owned product policy.
- Names but does not modify: Amazing EKB cache revalidation and Threads follower snapshot.

- [ ] Write a module-owned example whose `attempt` and synchronous `classifier` close over provider policy and call `run(attempt, classifier, signal)`; do not pass a generic product context to the runner.
- [ ] Document Content-Length/chunk bounds, timeout ambiguity, abort/deadline local limits, observer isolation and consumer-owned durable idempotency/recovery.
- [ ] Link the guide and record `INT-01` availability without claiming a changed external adopter, merged PR, hosted check or deployment.
- [ ] Commit Task 4 documentation as `docs(platform): document outbound HTTP adoption`.

### Task 5: Verify, independently review and open the stage PR

**Files:**

- Verify: all changed files from `c01075381899da971d44af90eaa6901ad05006c6` to feature HEAD.

**Interfaces:**

- Requires: exactly the three approved commits, focused evidence and no dependency/generated/runtime composition changes.
- Produces: a review-ready feature branch and, only after PASS, one PR to `stage`.

- [ ] Run `git diff --check c01075381899da971d44af90eaa6901ad05006c6...HEAD`, both focused unit suites, the Task 3 integration command, `pnpm check:quick`, `pnpm check` and `pnpm oci:check` on committed HEAD.
- [ ] If one listed gate is sandbox-blocked, repeat that exact scoped command once host-capably and record both results; do not replace it with a broader command.
- [ ] Dispatch an independent read-only `gpt-5.6-sol` reviewer with `ultra` reasoning and no inherited conversation history. It checks API exactness, abort/late settlement, timer/body bounds, telemetry and documentation truthfulness.
- [ ] Apply at most one consolidated fix wave per review turn, rerun affected tests/gates and request recheck; stop after three reviewer turns if PASS is not reached.
- [ ] Only after PASS, push `feat/bounded-outbound-http-runner` and open one regular PR with base `stage`. Do not merge or clean up the branch/worktree.
