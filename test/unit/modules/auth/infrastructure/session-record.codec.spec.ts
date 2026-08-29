import type { StoredSessionRecord } from '@/modules/auth/sessions/application/session-store.port'
import { sessionRecordCodec } from '@/modules/auth/sessions/infrastructure/session-record.codec'

const validRecord: StoredSessionRecord = {
  schema: 1,
  publicId: 'AQEBAQEBAQEBAQEBAQEBAQ',
  userId: '0f739752-52a2-45bc-aa9f-3de43f47f47b',
  sessionGeneration: '0',
  globalSessionEpoch: '12',
  csrfSeed: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI',
  createdAtMs: 1_000,
  lastSeenAtMs: 1_000,
  absoluteExpiresAtMs: 10_000,
  deviceLabel: 'Firefox on macOS',
  networkFingerprint: 'network-hmac',
}

describe('sessionRecordCodec', () => {
  it('round-trips the exact schema without unchecked coercion', () => {
    const encoded = sessionRecordCodec.encode(validRecord)

    expect(sessionRecordCodec.decode(encoded)).toEqual({
      ok: true,
      value: validRecord,
    })
  })

  it.each([
    { ...validRecord, schema: 2 },
    { ...validRecord, extra: true },
    { ...validRecord, userId: 'not-a-uuid' },
    { ...validRecord, publicId: 'not+base64url' },
    { ...validRecord, csrfSeed: '' },
    { ...validRecord, sessionGeneration: '01' },
    { ...validRecord, globalSessionEpoch: '-1' },
    { ...validRecord, createdAtMs: -1 },
    { ...validRecord, lastSeenAtMs: 11_000 },
    { ...validRecord, absoluteExpiresAtMs: 1_000 },
  ])('rejects invalid or non-canonical payload %#', (record) => {
    expect(sessionRecordCodec.decode(JSON.stringify(record))).toEqual({
      ok: false,
    })
  })

  it('rejects malformed JSON', () => {
    expect(sessionRecordCodec.decode('{')).toEqual({ ok: false })
  })
})
