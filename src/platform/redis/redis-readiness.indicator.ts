import type { ReadinessIndicator } from '@/platform/http/health/readiness-indicator'

import type { RedisCoordinationConnectionManager } from './redis-coordination.connection'

/** Required readiness indicator for the coordination Redis capability. */
export class RedisReadinessIndicator implements ReadinessIndicator {
  public readonly name = 'redis-coordination' as const
  public readonly required = true as const

  public constructor(
    private readonly connection: RedisCoordinationConnectionManager,
    public readonly timeoutMs: number,
  ) {}

  public async check(signal: AbortSignal): Promise<'up' | 'down'> {
    try {
      const response = await this.connection.commandExecutor.execute(
        'readiness-ping',
        (client) => client.ping(),
        signal,
      )
      return response === 'PONG' ? 'up' : 'down'
    } catch {
      return 'down'
    }
  }
}
