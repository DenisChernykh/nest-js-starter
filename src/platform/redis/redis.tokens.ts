/** Token for the capability-managed Redis connection registry. */
export const REDIS_CONNECTION_REGISTRY: unique symbol = Symbol(
  'REDIS_CONNECTION_REGISTRY',
)

/** Token for the Redis startup and cleanup boundary. */
export const REDIS_LIFECYCLE: unique symbol = Symbol('REDIS_LIFECYCLE')

/** Token for the required coordination Redis readiness indicator. */
export const REDIS_READINESS_INDICATOR: unique symbol = Symbol(
  'REDIS_READINESS_INDICATOR',
)
