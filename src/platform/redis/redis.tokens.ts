/** Token for the coordination Redis command executor. */
export const REDIS_COORDINATION_COMMAND_EXECUTOR: unique symbol = Symbol(
  'REDIS_COORDINATION_COMMAND_EXECUTOR',
)

/** Token for the Redis startup and cleanup boundary. */
export const REDIS_LIFECYCLE: unique symbol = Symbol('REDIS_LIFECYCLE')

/** Token for the required coordination Redis readiness indicator. */
export const REDIS_READINESS_INDICATOR: unique symbol = Symbol(
  'REDIS_READINESS_INDICATOR',
)
