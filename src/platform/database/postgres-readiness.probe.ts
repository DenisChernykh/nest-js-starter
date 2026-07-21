import type { DatabaseReadinessProbe } from './database.contracts'
import type { PrismaClientProvider } from './prisma-client.provider'

/** Required PostgreSQL readiness probe backed by a bounded raw Pool query. */
export class PostgresReadinessProbe implements DatabaseReadinessProbe {
  public readonly name = 'postgresql' as const
  public readonly required = true as const

  public constructor(
    private readonly provider: PrismaClientProvider,
    public readonly timeoutMs: number,
  ) {}

  public check(signal: AbortSignal): Promise<'up' | 'down'> {
    return this.provider.checkReadiness(signal, this.timeoutMs)
  }
}
