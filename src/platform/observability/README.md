# Observability platform

Responsibility: early OpenTelemetry bootstrap, exporter-boundary span
sanitization, application telemetry adapter and low-cardinality runtime metrics.

Allowed dependencies: platform lifecycle, logging and configuration plus the
framework-free shared telemetry port.

The collector is never registered as a health dependency. Exporter failures are
diagnosed without changing request results; bounded SDK shutdown remains the
last ordered cleanup participant.
