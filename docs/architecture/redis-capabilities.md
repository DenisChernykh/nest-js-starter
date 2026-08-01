# Redis auth

`platform/redis` owns the node-redis driver, one auth connection,
bounded commands, key construction, scripts and readiness. The composition
root creates one `RedisAuthConnectionManager`; it exports the typed
command executor, lifecycle and readiness boundaries. Auth adapters receive
the executor directly.

Auth sessions and distributed login limits remain opaque and use the `auth` key
capability segment with the existing versioned format. Commands run with bounded deadlines, fail-fast driver
options and traced `redis.command` spans. A deadline destroys the owned socket
and reports dependency failure without claiming the server did not execute the
command.

Cache and pub/sub abstractions are intentionally absent. Redis logical
database numbers, `KEYS` and unchecked JSON remain prohibited.

Future queues, durable events or application caching do not automatically use
this connection. They require an adopted use case and an explicit availability,
persistence, eviction and lifecycle contract. For example, BullMQ would own
separate connections and a separate queue URL rather than extending the auth
manager. See `docs/roadmap.md` for the capability acceptance
protocol.
