import { PublicAuthResponseDelay } from '@/modules/auth/presentation/public-auth-response-delay'

describe('PublicAuthResponseDelay', () => {
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
