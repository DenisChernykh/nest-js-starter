import { trustedProxySetting } from '@/platform/http/bootstrap/trusted-proxy'

describe('trustedProxySetting', () => {
  it('disables proxy trust for an empty list', () => {
    expect(trustedProxySetting([])).toBe(false)
  })

  it('returns an immutable exact CIDR list without hop counts', () => {
    const source = ['10.0.0.0/8', '2001:db8::/32']
    const setting = trustedProxySetting(source)
    expect(setting).toEqual(source)
    expect(setting).not.toBe(source)
    expect(Object.isFrozen(setting)).toBe(true)
  })
})
