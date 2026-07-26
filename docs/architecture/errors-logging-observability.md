# Errors, logging and observability

The immutable typed problem catalog is the single source for RFC 9457 type
URIs, codes, statuses, titles and details. The HTTP mapper and Swagger
decorators use its getter; unknown exception details never reach clients.

Pino remains the structured logging sink with request and trace correlation,
safe error serialization and auth audit events. OpenTelemetry is intentionally
trace-only: OTLP traces, HTTP/pg/Redis instrumentation and
`SanitizingSpanExporter` remain. Runtime metrics, metric exporters and auth
telemetry adapters are not part of the foundation.
