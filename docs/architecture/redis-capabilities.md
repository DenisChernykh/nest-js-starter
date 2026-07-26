# Redis coordination

`platform/redis` owns the node-redis driver, one coordination connection,
bounded commands, key construction, scripts and readiness. The composition
root creates one `RedisCoordinationConnectionManager`; it exports the typed
command executor, lifecycle and readiness boundaries. Auth adapters receive
the executor directly.

Auth sessions and distributed login limits remain opaque and use the existing
key bytes and format. Commands run with bounded deadlines, fail-fast driver
options and traced `redis.command` spans. A deadline destroys the owned socket
and reports dependency failure without claiming the server did not execute the
command.

Cache and pub/sub abstractions are intentionally absent. Redis logical
database numbers, `KEYS` and unchecked JSON remain prohibited.
