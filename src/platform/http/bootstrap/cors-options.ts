import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface'

/** Builds an exact-origin credentialed CORS policy. */
export function createCorsOptions(
  allowedOrigins: readonly string[],
): CorsOptions {
  const allowed = new Set(allowedOrigins)
  return {
    credentials: true,
    origin: (origin, callback) => {
      callback(null, origin === undefined || allowed.has(origin))
    },
  }
}
