import {
  sanitizeLogText,
  serializeSafeError,
} from '@/platform/logging/safe-error.serializer'

describe('safe error serializer', () => {
  it('keeps a stable type and frame lines without message or cause payload', () => {
    const sentinel = 'DO_NOT_LEAK_ERROR_SECRET'
    const error = new Error(`password=${sentinel}`, {
      cause: { token: sentinel },
    })
    error.stack = [
      `Error: password=${sentinel}`,
      '    at execute (/srv/app/use-case.ts:10:3)',
      `Caused by token=${sentinel}`,
    ].join('\n')

    const serialized = serializeSafeError(error)

    expect(serialized).toEqual({
      type: 'Error',
      stack: ['at execute (/srv/app/use-case.ts:10:3)'],
    })
    expect(JSON.stringify(serialized)).not.toContain(sentinel)
    expect(serialized).not.toHaveProperty('message')
    expect(serialized).not.toHaveProperty('cause')
  })

  it('does not serialize arbitrary thrown values', () => {
    expect(serializeSafeError({ password: 'secret' })).toEqual({
      type: 'NonError',
    })
  })

  it('redacts labelled secrets, bearer credentials and URLs in bounded text', () => {
    const sanitized = sanitizeLogText(
      'token=abc Bearer ey.secret https://user:password@example.com/path',
    )

    expect(sanitized).toBe('token=[redacted] Bearer [redacted] [redacted-url]')
    expect(sanitizeLogText('x'.repeat(2_000))).toHaveLength(512)
  })
})
