/** Token for the database startup and cleanup boundary. */
export const DATABASE_LIFECYCLE: unique symbol = Symbol('DATABASE_LIFECYCLE')

/** Token for the required PostgreSQL readiness indicator. */
export const DATABASE_READINESS_PROBE: unique symbol = Symbol(
  'DATABASE_READINESS_PROBE',
)
