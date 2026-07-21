# Errors, logging and observability

## Request identity and problem responses

The first HTTP middleware accepts `X-Request-ID` only as a canonical UUID or an
uppercase ULID. Invalid or absent input is replaced with `crypto.randomUUID()`.
AsyncLocalStorage owns only this request identifier. OpenTelemetry trace/span
identity stays in the OpenTelemetry context and is read at log-write time.

Every failure response is `application/problem+json` and follows RFC 9457. The
committed runtime registry owns public type, code, status, title and constant
detail; `docs/api/problem-types.md` mirrors that catalogue for humans. Runtime
host/environment never changes the reserved
`https://nest-js-starter.invalid/problems` namespace.
Problem bodies include `instance: urn:request:<requestId>` and `requestId`.
Validation extensions contain only RFC 6901 pointers, finite client codes and
constant details; rejected values and validator messages are excluded.

Expected 4xx/typed dependency failures do not emit stack logs. An unknown 5xx
emits one centrally sanitized error record, while the response remains the
constant `INTERNAL_ERROR` problem. Every completed/aborted request emits exactly
one final access record; route is a template (or `unmatched`), never a concrete
path/query.

## Structured logs and audit

Pino writes newline-delimited JSON directly to stdout without transports,
prettifiers or request auto-logging. Service/version/revision/environment and
valid request/trace/span identifiers are added centrally. Attribute names and
primitive values are validated; sensitive keys are removed. Error serialization
keeps a bounded type and stack representation but drops raw message/cause.

The auth application depends on a framework-free `AuthAuditPort`. The platform
adapter accepts only committed action/outcome/reason combinations. It never
records email, raw IP, passwords, tokens, cookies or URLs. Optional actor/session
identifiers are audit fields only; they are not metric attributes. Audit/logging
failures are counted/diagnosed and cannot change an auth mutation result.

## OpenTelemetry pipeline

The SDK starts before dynamic imports of NestJS, HTTP, Prisma/pg and Redis.
Enabled mode registers only explicit HTTP, PostgreSQL and Redis instrumentation,
OTLP HTTP/protobuf trace/metric exporters, batch span processing and periodic
metric export. Disabled mode is a real no-op. Collector connectivity is absent
from startup and all three health contracts.

HTTP root spans receive the late Nest route template via
`applyCustomAttributesOnSpan`. Auth use cases create fixed spans (`auth.login`,
`auth.authenticate`, `auth.change_password`, `auth.logout_all`,
`auth.revoke_session`). Prisma and Redis runtime operations record monotonic
latency/error metrics. Because current node-redis 6 is outside the auto
instrumentation patch surface, `RedisCommandExecutor` also creates the stable
`redis.command` client span; a finite mapping exports only command names such as
`GET`, `EVALSHA` or `OTHER`, never operation names, keys or arguments.

Every span crosses `SanitizingSpanExporter` before a real or in-memory exporter.
The allowlist keeps bounded HTTP method/status/route/protocol and database
system/operation/namespace attributes. Redis `db.statement`/`db.query.text` is
retained only when it is a single uppercase command token. Full URLs, query,
headers, client IP, SQL, Redis arguments, links, exception events and status
messages are removed.

Application metrics use finite labels only:

- HTTP method, route template and status class;
- dependency (`postgres`/`redis`) and outcome;
- cache event;
- fixed auth operation and outcome.

User/session/entity IDs, email, cache/Redis keys and arbitrary operation names
are not accepted by the metrics API. Telemetry calls isolate exporter/instrument
errors and never replace the owning operation result.

## Shutdown

OpenTelemetry closes after Redis and Prisma. SDK shutdown is bounded by the
shared remaining grace signal and uses one promise. The boundary observes a
deadline; it does not cancel or claim cancellation of an in-flight OTLP request.
A collector outage leaves requests and readiness healthy, but a rejected flush
makes cleanup fail and the process exits 1 before the hard watchdog.
