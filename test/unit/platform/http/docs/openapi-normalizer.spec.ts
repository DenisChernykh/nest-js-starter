import { canonicalizeJson } from '@/platform/http/docs/openapi-normalizer'

describe('canonicalizeJson', () => {
  it('sorts object keys recursively while preserving array order', () => {
    const canonical = canonicalizeJson({
      zeta: { second: 2, first: 1 },
      alpha: [
        { zeta: 'last-key', alpha: 'first-key' },
        'second-array-member',
        'third-array-member',
      ],
    })
    const parsed = JSON.parse(canonical) as {
      readonly alpha: readonly unknown[]
      readonly zeta: Readonly<Record<string, unknown>>
    }

    expect(Object.keys(parsed)).toEqual(['alpha', 'zeta'])
    expect(Object.keys(parsed.zeta)).toEqual(['first', 'second'])
    expect(Object.keys(parsed.alpha[0] as object)).toEqual(['alpha', 'zeta'])
    expect(parsed.alpha.slice(1)).toEqual([
      'second-array-member',
      'third-array-member',
    ])
  })

  it('is byte-stable and writes exactly one terminal newline', () => {
    const value = { nested: { beta: true, alpha: null } }
    const first = canonicalizeJson(value)
    const second = canonicalizeJson(value)

    expect(first).toBe(second)
    expect(first.endsWith('\n')).toBe(true)
    expect(first.endsWith('\n\n')).toBe(false)
  })
})
