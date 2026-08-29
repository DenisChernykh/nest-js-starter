import { canonicalizeUserId } from '@/modules/identity-access/public-contracts/canonical-user-id'

describe('canonicalizeUserId', () => {
  it('uses one lowercase representation for UUID identity and lock ordering', () => {
    const lower = '95ee8d48-2f19-49be-af21-c5f471c1e502'

    expect(canonicalizeUserId(lower.toUpperCase())).toBe(lower)
    expect(
      [lower, '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123'.toUpperCase()]
        .map(canonicalizeUserId)
        .sort(),
    ).toEqual([
      '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
      '95ee8d48-2f19-49be-af21-c5f471c1e502',
    ])
  })
})
