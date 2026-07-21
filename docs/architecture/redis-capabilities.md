# Redis capabilities

## Ownership

`platform/redis` owns driver creation, capability registration, connection
lifecycle, bounded command execution, key construction, scripts and readiness.
Concrete `RedisClientType` never leaves the platform boundary. Module adapters
receive only the narrowed `RedisCapabilityExecutor`.

Production composition registers one required `coordination` connection. It is
authoritative for auth sessions and distributed login limits, participates in
startup/readiness and closes before PostgreSQL. Pub/Sub is not registered.

`cache` is optional and lazy. A module must explicitly register its own adapter;
the production auth composition does not open it even when `REDIS_CACHE_URL` is
present. The fixture contract proves read-through fallback, payload validation
and invalidation only after commit. Cache loss must not change process
readiness.

## Keys and failure semantics

Every key uses
`<prefix>:<environment>:<capability>:v<schema>:<resource>:<id>`. Runtime code
does not use logical Redis databases, `KEYS`, unchecked JSON or offline queues.
Opaque session tokens and rate-limit identifiers are HMAC-digested with
dedicated secrets before becoming key components.

Connect and command deadlines are bounded. An in-flight deadline destroys the
owned socket and reports dependency failure; it does not claim the Redis command
was cancellable or did not execute. Readiness attempts a bounded reconnect so a
resumed coordination service can return the process to ready.
