import type { RuntimeEnvironment } from '@/platform/config/runtime-config.types'
import type { RedisCommandExecutorPort } from '@/platform/redis/redis-command.executor'
import { RedisKeyBuilder } from '@/platform/redis/redis-key.builder'
import { RedisScriptRunner } from '@/platform/redis/redis-script.runner'

import { AuthDependencyUnavailableError } from '../../application/auth-errors'
import type {
  BrowserSessionSummary,
  IssueSessionInput,
  IssuedBrowserSession,
  SessionStorePort,
  StoredSessionRecord,
} from '../application/session-store.port'
import { REDIS_SESSION_SCRIPTS } from './redis-session.scripts'
import { sessionRecordCodec } from './session-record.codec'

/** Secrets, namespace and finite expiry policy owned by the Redis session store. */
export interface RedisSessionStoreConfig {
  readonly keyPrefix: string
  readonly environment: RuntimeEnvironment
  readonly sessionKeySecret: Uint8Array
  readonly csrfSecret: Uint8Array
  readonly idleTimeoutMs: number
  readonly absoluteTimeoutMs: number
  readonly touchIntervalMs: number
}

export interface SessionCryptoPort {
  generateSessionToken(): string
  generatePublicId(): string
  generateCsrfSeed(): string
  hmac(key: Uint8Array, value: string): string
}

/** Opaque session adapter backed by exact Redis keys and reviewed Lua scripts. */
export class RedisSessionStore implements SessionStorePort {
  private readonly keys: RedisKeyBuilder
  private readonly scripts: RedisScriptRunner

  public constructor(
    private readonly executor: RedisCommandExecutorPort,
    private readonly crypto: SessionCryptoPort,
    private readonly config: RedisSessionStoreConfig,
  ) {
    if (
      config.idleTimeoutMs < 1 ||
      config.absoluteTimeoutMs < config.idleTimeoutMs ||
      config.touchIntervalMs < 1 ||
      config.touchIntervalMs >= config.idleTimeoutMs
    ) {
      throw new Error('Redis session expiry policy is invalid')
    }
    this.keys = new RedisKeyBuilder(
      [config.keyPrefix, config.environment, 'auth'],
      'v1',
    )
    this.scripts = new RedisScriptRunner(executor)
    for (const script of REDIS_SESSION_SCRIPTS) this.scripts.register(script)
  }

  public async issue(input: IssueSessionInput): Promise<IssuedBrowserSession> {
    const rawToken = this.crypto.generateSessionToken()
    const publicId = this.crypto.generatePublicId()
    const csrfSeed = this.crypto.generateCsrfSeed()
    const absoluteExpiresAtMs = input.nowMs + this.config.absoluteTimeoutMs
    const record: StoredSessionRecord = {
      schema: 1,
      publicId,
      userId: input.userId,
      sessionGeneration: input.sessionGeneration.toString(10),
      globalSessionEpoch: input.globalSessionEpoch.toString(10),
      csrfSeed,
      createdAtMs: input.nowMs,
      lastSeenAtMs: input.nowMs,
      absoluteExpiresAtMs,
      deviceLabel: input.deviceLabel,
      networkFingerprint: input.networkFingerprint,
    }
    const digest = this.sessionDigest(rawToken)
    try {
      await this.scripts.run<number>(
        'auth-session-create-v1',
        [this.sessionKey(digest), this.indexKey(input.userId)],
        [
          sessionRecordCodec.encode(record),
          publicId,
          String(this.config.idleTimeoutMs),
          digest,
          String(this.config.absoluteTimeoutMs),
        ],
      )
    } catch {
      throw new AuthDependencyUnavailableError()
    }
    return Object.freeze({
      rawToken,
      publicId,
      csrfToken: this.csrfToken(record),
      absoluteExpiresAt: new Date(absoluteExpiresAtMs),
    })
  }

  public async readAndTouch(
    rawToken: string,
    nowMs: number,
  ): Promise<StoredSessionRecord | undefined> {
    const digest = this.sessionDigest(rawToken)
    return this.readAndTouchWithOwner(digest, nowMs)
  }

  public csrfToken(record: StoredSessionRecord): string {
    return this.crypto.hmac(
      this.config.csrfSecret,
      `${record.publicId}.${record.csrfSeed}`,
    )
  }

  public async list(
    userId: string,
    currentPublicId: string,
  ): Promise<readonly BrowserSessionSummary[]> {
    try {
      const pairs = await this.readIndex(userId)
      const records: BrowserSessionSummary[] = []
      for (let index = 0; index < pairs.length; index += 2) {
        const publicId = pairs[index]
        const digest = pairs[index + 1]
        if (publicId === undefined || digest === undefined) continue
        const payload = await this.executor.execute(
          'session-list-record',
          (client) =>
            client.sendCommand<string | null>(['GET', this.sessionKey(digest)]),
        )
        if (payload === null) continue
        const decoded = sessionRecordCodec.decode(payload)
        if (!decoded.ok || decoded.value.userId !== userId) continue
        records.push({
          publicId: decoded.value.publicId,
          createdAt: new Date(decoded.value.createdAtMs),
          lastSeenAt: new Date(decoded.value.lastSeenAtMs),
          absoluteExpiresAt: new Date(decoded.value.absoluteExpiresAtMs),
          deviceLabel: decoded.value.deviceLabel,
          current: decoded.value.publicId === currentPublicId,
        })
      }
      return Object.freeze(
        records.sort(
          (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
        ),
      )
    } catch {
      throw new AuthDependencyUnavailableError()
    }
  }

  public async revoke(userId: string, publicId: string): Promise<boolean> {
    try {
      const digest = await this.executor.execute(
        'session-revoke-lookup',
        (client) =>
          client.sendCommand<string | null>([
            'HGET',
            this.indexKey(userId),
            publicId,
          ]),
      )
      if (digest === null) return false
      const revoked = await this.scripts.run<number>(
        'auth-session-revoke-one-v1',
        [this.sessionKey(digest), this.indexKey(userId)],
        [publicId, userId, digest],
      )
      return revoked === 1
    } catch {
      throw new AuthDependencyUnavailableError()
    }
  }

  public async revokeAll(userId: string): Promise<number> {
    try {
      const pairs = await this.readIndex(userId)
      if (pairs.length === 0) return 0
      const sessionKeys: string[] = []
      for (let index = 1; index < pairs.length; index += 2) {
        const digest = pairs[index]
        if (digest !== undefined) sessionKeys.push(this.sessionKey(digest))
      }
      return await this.scripts.run<number>(
        'auth-session-revoke-all-v1',
        [this.indexKey(userId), ...sessionKeys],
        pairs,
      )
    } catch {
      throw new AuthDependencyUnavailableError()
    }
  }

  private async readAndTouchWithOwner(
    digest: string,
    nowMs: number,
  ): Promise<StoredSessionRecord | undefined> {
    try {
      const payload = await this.executor.execute(
        'session-owner-read',
        (client) =>
          client.sendCommand<string | null>(['GET', this.sessionKey(digest)]),
      )
      if (payload === null) return undefined
      const decoded = sessionRecordCodec.decode(payload)
      if (!decoded.ok) {
        await this.executor.execute('session-delete-invalid', (client) =>
          client.sendCommand<number>(['DEL', this.sessionKey(digest)]),
        )
        return undefined
      }
      const touched = await this.scripts.run<string | null>(
        'auth-session-touch-v1',
        [this.sessionKey(digest), this.indexKey(decoded.value.userId)],
        [
          String(nowMs),
          String(this.config.idleTimeoutMs),
          String(this.config.touchIntervalMs),
          decoded.value.publicId,
        ],
      )
      if (touched === null) return undefined
      const result = sessionRecordCodec.decode(touched)
      return result.ok ? result.value : undefined
    } catch {
      throw new AuthDependencyUnavailableError()
    }
  }

  private sessionDigest(rawToken: string): string {
    return this.crypto.hmac(this.config.sessionKeySecret, rawToken)
  }

  private sessionKey(digest: string): string {
    return this.keys.build('session', digest)
  }

  private indexKey(userId: string): string {
    return this.keys.build('user-sessions', userId)
  }

  private async readIndex(userId: string): Promise<string[]> {
    const indexKey = this.indexKey(userId)
    const publicIds = await this.executor.execute(
      'session-index-public-ids',
      (client) => client.sendCommand<string[]>(['HKEYS', indexKey]),
    )
    if (publicIds.length === 0) return []
    const digests = await this.executor.execute(
      'session-index-digests',
      (client) =>
        client.sendCommand<(string | null)[]>([
          'HMGET',
          indexKey,
          ...publicIds,
        ]),
    )
    const pairs: string[] = []
    for (let index = 0; index < publicIds.length; index += 1) {
      const publicId = publicIds[index]
      const digest = digests[index]
      if (publicId !== undefined && digest !== undefined && digest !== null)
        pairs.push(publicId, digest)
    }
    return pairs
  }
}
