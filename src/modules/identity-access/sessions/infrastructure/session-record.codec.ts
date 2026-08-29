import type {
  RedisCodec,
  RedisDecodeResult,
} from '@/platform/redis/redis-codec'

import type { StoredSessionRecord } from '../application/session-store.port'

const fields = Object.freeze([
  'schema',
  'publicId',
  'userId',
  'sessionGeneration',
  'globalSessionEpoch',
  'csrfSeed',
  'createdAtMs',
  'lastSeenAtMs',
  'absoluteExpiresAtMs',
  'deviceLabel',
  'networkFingerprint',
])
const fieldSet = new Set<string>(fields)
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const canonicalIntegerPattern = /^(?:0|[1-9][0-9]*)$/u

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCanonicalBase64Url(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value))
    return false
  return Buffer.from(value, 'base64url').toString('base64url') === value
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0
}

function decodeSessionRecord(
  serialized: string,
): RedisDecodeResult<StoredSessionRecord> {
  try {
    const value: unknown = JSON.parse(serialized)
    if (!isPlainObject(value)) return { ok: false }
    const keys = Object.keys(value)
    if (keys.length !== fields.length || keys.some((key) => !fieldSet.has(key)))
      return { ok: false }
    if (
      value['schema'] !== 1 ||
      !isCanonicalBase64Url(value['publicId']) ||
      typeof value['userId'] !== 'string' ||
      !uuidPattern.test(value['userId']) ||
      typeof value['sessionGeneration'] !== 'string' ||
      !canonicalIntegerPattern.test(value['sessionGeneration']) ||
      typeof value['globalSessionEpoch'] !== 'string' ||
      !canonicalIntegerPattern.test(value['globalSessionEpoch']) ||
      !isCanonicalBase64Url(value['csrfSeed']) ||
      !isNonnegativeSafeInteger(value['createdAtMs']) ||
      !isNonnegativeSafeInteger(value['lastSeenAtMs']) ||
      !isNonnegativeSafeInteger(value['absoluteExpiresAtMs']) ||
      value['absoluteExpiresAtMs'] <= value['createdAtMs'] ||
      value['lastSeenAtMs'] < value['createdAtMs'] ||
      value['lastSeenAtMs'] >= value['absoluteExpiresAtMs'] ||
      typeof value['deviceLabel'] !== 'string' ||
      value['deviceLabel'].length > 256 ||
      typeof value['networkFingerprint'] !== 'string' ||
      value['networkFingerprint'].length === 0 ||
      value['networkFingerprint'].length > 256
    ) {
      return { ok: false }
    }
    return {
      ok: true,
      value: Object.freeze({
        schema: 1,
        publicId: value['publicId'],
        userId: value['userId'],
        sessionGeneration: value['sessionGeneration'],
        globalSessionEpoch: value['globalSessionEpoch'],
        csrfSeed: value['csrfSeed'],
        createdAtMs: value['createdAtMs'],
        lastSeenAtMs: value['lastSeenAtMs'],
        absoluteExpiresAtMs: value['absoluteExpiresAtMs'],
        deviceLabel: value['deviceLabel'],
        networkFingerprint: value['networkFingerprint'],
      }),
    }
  } catch {
    return { ok: false }
  }
}

/** Strict codec for untrusted versioned session records stored in Redis. */
export const sessionRecordCodec: RedisCodec<StoredSessionRecord> =
  Object.freeze({
    encode: (record: StoredSessionRecord) => JSON.stringify(record),
    decode: decodeSessionRecord,
  })
