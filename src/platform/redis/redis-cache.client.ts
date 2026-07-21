import type { RedisCapabilityExecutor } from './redis-capability'
import type { RedisCacheEvents } from './redis-cache.events'
import type { RedisCodec } from './redis-codec'

const maximumTtlMs = 30 * 24 * 60 * 60 * 1_000

/** Required finite expiry and serialization policy for one cached value. */
export interface RedisCacheWritePolicy<T> {
  readonly codec: RedisCodec<T>
  readonly ttlMs: number
  readonly jitterRatio: number
}

/** Fail-open typed cache primitive backed by one lazy cache capability. */
export class RedisCacheClient {
  public constructor(
    private readonly executor: RedisCapabilityExecutor,
    private readonly events: RedisCacheEvents,
    private readonly random: () => number = Math.random,
  ) {}

  /**
   * Reads and validates one exact key, returning a miss on dependency failure.
   *
   * @remarks Invalid bytes are deleted best-effort before the miss is emitted.
   */
  public async get<T>(
    key: string,
    codec: RedisCodec<T>,
  ): Promise<T | undefined> {
    try {
      const serialized = await this.executor.execute('cache-get', (client) =>
        client.sendCommand<string | null>(['GET', key]),
      )
      if (serialized === null) {
        this.events.publish({ type: 'miss', key })
        return undefined
      }
      const decoded = codec.decode(serialized)
      if (!decoded.ok) {
        this.events.publish({ type: 'invalid', key })
        try {
          await this.executor.execute('cache-delete-invalid', (client) =>
            client.sendCommand<number>(['DEL', key]),
          )
        } catch {
          this.events.publish({ type: 'error', key })
        }
        this.events.publish({ type: 'miss', key })
        return undefined
      }
      this.events.publish({ type: 'hit', key })
      return decoded.value
    } catch {
      this.events.publish({ type: 'error', key })
      return undefined
    }
  }

  /**
   * Writes one exact key with a mandatory finite PX expiry.
   *
   * @throws Error when TTL or jitter policy is outside its safe bounds.
   */
  public async set<T>(
    key: string,
    value: T,
    policy: RedisCacheWritePolicy<T>,
  ): Promise<void> {
    this.assertPolicy(policy)
    const ttlMs = Math.max(
      1,
      Math.round(
        policy.ttlMs * (1 - policy.jitterRatio * this.safeRandomValue()),
      ),
    )
    try {
      const encoded = policy.codec.encode(value)
      await this.executor.execute('cache-set', (client) =>
        client.sendCommand<string>(['SET', key, encoded, 'PX', String(ttlMs)]),
      )
      this.events.publish({ type: 'write', key })
    } catch {
      this.events.publish({ type: 'error', key })
    }
  }

  /** Deletes one exact key and bypasses dependency failures. */
  public async invalidate(key: string): Promise<void> {
    try {
      await this.executor.execute('cache-invalidate', (client) =>
        client.sendCommand<number>(['DEL', key]),
      )
      this.events.publish({ type: 'invalidate', key })
    } catch {
      this.events.publish({ type: 'error', key })
    }
  }

  private assertPolicy<T>(policy: RedisCacheWritePolicy<T>): void {
    if (
      !Number.isSafeInteger(policy.ttlMs) ||
      policy.ttlMs < 1 ||
      policy.ttlMs > maximumTtlMs ||
      !Number.isFinite(policy.jitterRatio) ||
      policy.jitterRatio < 0 ||
      policy.jitterRatio > 0.25
    ) {
      throw new Error('Redis cache policy is outside safe bounds')
    }
  }

  private safeRandomValue(): number {
    const value = this.random()
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new Error('Redis cache jitter source returned an invalid value')
    return value
  }
}
