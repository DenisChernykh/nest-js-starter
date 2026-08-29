import {
  AccountEtagMalformedError,
  AccountEtagPreconditionRequiredError,
  formatAccountEtag,
  parseAccountEtag,
} from '@/modules/auth/presentation/account-etag.codec'

const accountId = '95ee8d48-2f19-49be-af21-c5f471c1e502'

describe('account ETag codec', () => {
  it('formats and parses the strong account ETag used by HTTP', () => {
    expect(formatAccountEtag({ id: accountId, revision: 7 })).toBe(
      `"account-${accountId}-7"`,
    )
    expect(
      parseAccountEtag(accountId, `  "account-${accountId.toUpperCase()}-7"  `),
    ).toBe(7)
  })

  it.each([undefined, '', '   '] as const)(
    'requires If-Match when its raw value is %p',
    (value) => {
      expect(() => parseAccountEtag(accountId, value)).toThrow(
        AccountEtagPreconditionRequiredError,
      )
    },
  )

  it.each([
    `W/"account-${accountId}-7"`,
    '"account-2f54e3a8-a613-4a85-b0dc-08ea0c3cf123-7"',
    `"account-${accountId}-9007199254740992"`,
    `"account-${accountId}--1"`,
    `"account-${accountId}-7", "account-${accountId}-8"`,
  ])('rejects malformed or foreign If-Match value %s', (value) => {
    expect(() => parseAccountEtag(accountId, value)).toThrow(
      AccountEtagMalformedError,
    )
  })
})
