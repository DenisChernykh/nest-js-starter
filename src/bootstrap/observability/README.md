# Observability bootstrap

Responsibility: pre-Nest OpenTelemetry startup and process-owned SDK lifecycle.

Allowed dependencies: observability platform only.

`startObservability()` runs before Nest, HTTP, Prisma and Redis application
imports. Disabled mode is a no-op; collector connectivity is never part of
application health. SDK shutdown remains ordered and bounded by the process
coordinator without claiming cancellation of a non-settling exporter request.
