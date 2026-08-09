# Observability platform

Responsibility: bounded OpenTelemetry SDK lifecycle, exporter-boundary span
sanitization and safe OpenTelemetry diagnostic logging.

Allowed dependencies: OpenTelemetry SDK contracts and the structured logging
contract. Bootstrap composition and HTTP, PostgreSQL and Redis instrumentation
live under `src/bootstrap/observability`.

The foundation is trace-only; it provides no application telemetry adapter,
shared telemetry port or runtime metrics.

The collector is never registered as a health dependency. Exporter failures are
diagnosed without changing request results. Graceful shutdown closes the bounded
SDK after Redis/PostgreSQL and before the final Nest application close.
