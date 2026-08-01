import type { RedisOptions } from 'ioredis'

import type { QueueRuntimeConfig } from './queue-runtime-config'

function decodeCredential(value: string): string {
  return decodeURIComponent(value)
}

function normalizeHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

function createOptions(
  config: QueueRuntimeConfig,
  maxRetriesPerRequest: number | null,
): RedisOptions {
  const url = new URL(config.redisUrl)
  const hasCredentials = url.username !== '' || url.password !== ''

  return {
    host: normalizeHostname(url.hostname),
    port: url.port === '' ? 6379 : Number(url.port),
    ...(hasCredentials
      ? {
          username: decodeCredential(url.username),
          password: decodeCredential(url.password),
        }
      : {}),
    connectTimeout: config.connectTimeoutMs,
    maxRetriesPerRequest,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  }
}

/**
 * Converts the validated queue URL into bounded BullMQ producer options.
 *
 * @param config - Validated queue URL and queue deadlines.
 * @returns ioredis options without retaining the complete URL.
 */
export function createBullmqProducerOptions(
  config: QueueRuntimeConfig,
): RedisOptions {
  return createOptions(config, 1)
}

/**
 * Converts the validated queue URL into BullMQ worker options.
 *
 * @param config - Validated queue URL and queue deadlines.
 * @returns ioredis options with blocking-worker retry semantics.
 */
export function createBullmqWorkerOptions(
  config: QueueRuntimeConfig,
): RedisOptions {
  return createOptions(config, null)
}
