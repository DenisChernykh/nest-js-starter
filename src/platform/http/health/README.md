# Health platform

The unprefixed `/health/live`, `/health/startup` and `/health/ready` endpoints
publish exact, credential-free process contracts. Startup is an irreversible
latch; readiness is disabled while starting or draining and re-checks lifecycle
after every awaited dependency snapshot.

`HealthRegistry` accepts uniquely named indicators only before `seal()`. It
runs them concurrently, gives each an owned deadline signal, and waits for the
indicator to settle after timeout or parent abort. Indicators therefore own
prompt cleanup; PostgreSQL destroys and drains its dedicated health client.

Every production Nest `@Get()` or `@Head()` method must also carry
`@SafeEndpoint()`. The architecture gate recognizes named, aliased and
namespace imports and treats the marker as a mandatory review checkpoint, not
as automatic proof that a handler is side-effect free.

The listener is intentionally observable during startup: live is `200`, while
startup/readiness and `/v1` traffic remain `503` until PostgreSQL connects. A
later PostgreSQL outage changes only readiness. Drain changes readiness before
the listener closes; an external new connection may then be refused instead of
receiving an HTTP response.
