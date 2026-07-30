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

## Local signal pipeline

The canonical local workflow keeps application code vendor-neutral:

```text
Nest API --Pino JSON stdout--> Docker logs --> Alloy --> Loki --> Grafana
Nest API --trace-only OTLP/HTTP-------------> Alloy --> Tempo --> Grafana
```

Alloy discovers only the `api` container from the current Compose project.
`service`, `environment` and `level` are the bounded Loki labels. Request ID,
trace ID, span ID, event, module and reason code remain structured metadata or
log content so their cardinality cannot expand the index.

Loki and Tempo retain local data for `168h` in separate named volumes. Grafana
also keeps its state in a named volume. Only the API, Alloy OTLP receiver and
Grafana UI publish loopback ports; Loki and Tempo are reachable only over the
Compose network.

Alloy reads the Docker socket through a read-only mount scoped to this local
Compose project. Read-only access is still a privileged host boundary.

Alloy, Loki, Tempo and Grafana are not API startup, liveness or readiness
dependencies. Their failure can lose new local telemetry, but it must not stop
the API from serving requests.
