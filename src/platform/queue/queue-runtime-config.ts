import {
  RuntimeConfigurationError,
  type ApplicationRuntimeConfig,
} from '@/platform/config/runtime-config.types'
import { runtimeDefaults } from '@/platform/config/runtime-defaults'

/** Immutable configuration required to compose one BullMQ connection. */
export interface QueueRuntimeConfig {
  readonly redisUrl: string
  readonly connectTimeoutMs: number
  readonly healthTimeoutMs: number
  readonly shutdownGraceMs: number
}

/**
 * Requires the opt-in queue URL at the queue composition boundary.
 *
 * @param config - Complete validated API runtime configuration.
 * @returns Frozen queue configuration with independent queue deadlines.
 * @throws RuntimeConfigurationError when queue configuration is absent.
 */
export function requireQueueRuntimeConfig(
  config: ApplicationRuntimeConfig,
): QueueRuntimeConfig {
  const redisUrl = config.redis.queueUrl
  if (redisUrl === undefined) {
    throw new RuntimeConfigurationError([
      { path: 'REDIS_QUEUE_URL', rule: 'any.required' },
    ])
  }

  return Object.freeze({
    redisUrl,
    ...runtimeDefaults.queue,
  })
}
