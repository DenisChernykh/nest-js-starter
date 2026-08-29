import { PublicAuthResponseDelay } from '@/modules/auth/account-lifecycle/presentation/public-auth-response-delay'

describe('PublicAuthResponseDelay', () => {
  it('uses the monotonic clock by default', async () => {
    const now = jest.spyOn(performance, 'now').mockReturnValue(1_250)
    const sleep = jest.fn(() => Promise.resolve())

    try {
      const delay = new PublicAuthResponseDelay(2_000, undefined, sleep)

      await delay.wait(0)

      expect(sleep).toHaveBeenCalledWith(750)
    } finally {
      now.mockRestore()
    }
  })

  it('pads an accepted response to the configured floor', async () => {
    const sleep = jest.fn(() => Promise.resolve())
    const delay = new PublicAuthResponseDelay(2_000, () => 1_250, sleep)

    await delay.wait(0)

    expect(sleep).toHaveBeenCalledWith(750)
  })

  it('does not delay a response that already exceeded the floor', async () => {
    const sleep = jest.fn(() => Promise.resolve())
    const delay = new PublicAuthResponseDelay(2_000, () => 2_001, sleep)

    await delay.wait(0)

    expect(sleep).not.toHaveBeenCalled()
  })
})
