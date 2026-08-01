import type { ReadinessIndicator } from '@/platform/http/health/readiness-indicator'

import type { RedisAuthConnectionManager } from './redis-auth.connection'

/** Required readiness indicator for the auth Redis capability. */
export class RedisReadinessIndicator implements ReadinessIndicator {
  public readonly name = 'redis-auth' as const
  public readonly required = true as const

  public constructor(
    private readonly connection: RedisAuthConnectionManager,
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
