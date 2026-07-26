# Redis platform

The platform owns one required `coordination` connection. Its
`RedisCoordinationConnectionManager` exports a bounded command executor,
lifecycle and readiness indicator. Auth session and distributed rate-limit
adapters receive the executor directly.

Session/rate-limit key bytes, HMAC digests, fail-fast queues, bounded command
deadlines and Redis tracing are part of the production contract. Cache and
pub/sub capability abstractions are not included.
