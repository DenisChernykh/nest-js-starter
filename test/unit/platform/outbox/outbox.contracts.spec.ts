import {
  OutboxMessageValidationError,
  validateOutboxMessageDraft,
} from '@/platform/outbox/outbox.contracts'

describe('outbox message drafts', () => {
  const validDraft = (): {
    readonly destination: string
    readonly type: string
    readonly version: number
    readonly partitionKey: string
    readonly correlationId: string
    readonly occurredAt: Date
    readonly payload: { readonly inquiryId: string }
  } => ({
    destination: 'notifications',
    type: 'inquiry.submitted',
    version: 1,
    partitionKey: 'inquiry-123',
    correlationId: 'request-456',
    occurredAt: new Date('2026-08-08T00:00:00.000Z'),
    payload: { inquiryId: 'inquiry-123' },
  })

  it('returns a frozen canonical draft for a bounded JSON object payload', () => {
    const result = validateOutboxMessageDraft(validDraft())

    expect(result).toEqual(validDraft())
    expect(Object.isFrozen(result)).toBe(true)
  })

  it.each([
    ['a non-positive version', { version: 0 }],
    ['an array payload', { payload: ['inquiry-123'] }],
    ['a null payload', { payload: null }],
    ['an oversized payload', { payload: { body: 'x'.repeat(65_537) } }],
    ['a binary payload value', { payload: { body: Buffer.from('binary') } }],
    ['a credential-bearing payload', { payload: { accessToken: 'secret' } }],
  ])('rejects %s', (_name, override) => {
    expect(() =>
      validateOutboxMessageDraft({ ...validDraft(), ...override }),
    ).toThrow(OutboxMessageValidationError)
  })
})
