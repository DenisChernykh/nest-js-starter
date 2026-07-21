import { createCorsOptions } from '@/platform/http/bootstrap/cors-options'

describe('createCorsOptions', () => {
  it('allows no Origin and exact configured origins without wildcard reflection', () => {
    const options = createCorsOptions(['https://allowed.example'])
    const origin = options.origin
    expect(typeof origin).toBe('function')
    if (typeof origin !== 'function')
      throw new Error('origin callback required')
    const callback = jest.fn()

    origin(undefined, callback)
    expect(callback).toHaveBeenLastCalledWith(null, true)
    origin('https://allowed.example', callback)
    expect(callback).toHaveBeenLastCalledWith(null, true)
    origin('https://blocked.example', callback)
    expect(callback).toHaveBeenLastCalledWith(null, false)
    expect(options.credentials).toBe(true)
    expect(callback).not.toHaveBeenCalledWith(null, '*')
  })
})
