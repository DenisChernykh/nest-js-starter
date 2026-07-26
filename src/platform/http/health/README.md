# Health platform

The unprefixed `/health/live`, `/health/startup` and `/health/ready` endpoints
publish stable credential-free contracts. Startup is an irreversible latch;
readiness is skipped while starting or draining and re-checks lifecycle after
dependency probes settle.

`HealthRegistry` receives one immutable list containing the PostgreSQL and
coordination Redis probes. It runs them concurrently with bounded child
signals, without registration or sealing ceremony. Probe failures are mapped
to `down` without exposing driver details.

The listener is observable during startup: liveness is `200`, while startup,
readiness and `/v1` traffic remain unavailable until PostgreSQL and Redis have
connected. Drain changes readiness before the listener closes.
