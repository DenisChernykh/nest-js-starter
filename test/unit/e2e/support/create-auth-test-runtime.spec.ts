import { createAuthApiStartupError } from '@test/e2e/support/create-auth-test-runtime'

describe('createAuthApiStartupError', () => {
  it('reports bounded output and process state for every API instance', () => {
    const cause = new Error('readiness deadline exceeded')
    const longOutput = `discarded-prefix${'x'.repeat(5_000)}retained-tail`

    const error = createAuthApiStartupError(
      [
        {
          baseUrl: 'http://127.0.0.1:4101',
          exitCode: null,
          signalCode: null,
          output: () => 'still starting',
        },
        {
          baseUrl: 'http://127.0.0.1:4102',
          exitCode: 1,
          signalCode: null,
          output: () => longOutput,
        },
      ],
      cause,
    )

    expect(error.name).toBe('AuthTestApiStartupError')
    expect(error.cause).toBe(cause)
    expect(error.message).toContain(
      'instance=0 baseUrl=http://127.0.0.1:4101 exitCode=running signal=none',
    )
    expect(error.message).toContain('still starting')
    expect(error.message).toContain(
      'instance=1 baseUrl=http://127.0.0.1:4102 exitCode=1 signal=none',
    )
    expect(error.message).toContain('retained-tail')
    expect(error.message).not.toContain('discarded-prefix')
  })
})
