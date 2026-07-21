# Redis platform

Responsibility: capability-based Redis connections, bounded command execution,
readiness and lifecycle ownership.

Allowed dependencies: platform configuration/lifecycle and the approved Redis
client. The capability is consumed by module infrastructure/composition, never
by application or domain.

`coordination` is required and connected during startup. `cache` is registered
only when its URL is configured and connects on its first adapter operation.
Pub/sub must use a dedicated duplicate and is not registered by the runtime in
this slice. Raw `redis` driver types stay inside this directory.

An absolute command deadline destroys the affected socket so the local promise
settles. This does not mean that a command already received by Redis was
cancelled on the server. Shutdown first attempts cooperative `close()`, then
destroys a socket when the owned deadline expires and reports cleanup failure.
