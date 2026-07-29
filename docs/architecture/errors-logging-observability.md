# Errors, logging and observability

The API composition root installs ordered problem contributions from the core
HTTP boundary and selected business modules. `HttpProblemRegistry` copies and
freezes their definitions and mapper order into one immutable process catalog.
Startup fails when a code, slug or absolute type URI is duplicated, or when the
required `INTERNAL_ERROR` fallback is absent.

Each contribution maps only explicit error classes owned by its module to
registered public codes. A matching object shape or arbitrary `code` property
is not recognition. If no mapper recognizes a failure, or a mapper returns an
unregistered code, the registry returns the constant safe `INTERNAL_ERROR`
definition and marks the failure as unexpected. The HTTP filter never projects
the unknown message, cause or stack into the RFC 9457 response.

Pino remains the structured logging sink with request and trace correlation,
safe error serialization and auth audit events. OpenTelemetry is intentionally
trace-only: OTLP traces, HTTP/pg/Redis instrumentation and
`SanitizingSpanExporter` remain. Runtime metrics, metric exporters and auth
telemetry adapters are not part of the foundation.
