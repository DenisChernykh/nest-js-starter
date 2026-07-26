import { ObservabilityRuntime } from '@/platform/observability/observability.runtime'

describe('ObservabilityRuntime', () => {
  it('is a no-op in disabled mode', async () => {
    const runtime = new ObservabilityRuntime()
    await expect(
      runtime.close(new AbortController().signal),
    ).resolves.toBeUndefined()
    expect(runtime).toBeInstanceOf(ObservabilityRuntime)
  })

  it('shares one SDK shutdown across callers', async () => {
    const sdk = { shutdown: jest.fn(() => Promise.resolve()) }
    const runtime = new ObservabilityRuntime(sdk)

    await Promise.all([
      runtime.close(new AbortController().signal),
      runtime.close(new AbortController().signal),
    ])

    expect(sdk.shutdown).toHaveBeenCalledTimes(1)
  })

  it('rejects its participant when the shared coordinator signal wins', async () => {
    const sdk = { shutdown: jest.fn(() => new Promise<void>(() => undefined)) }
    const runtime = new ObservabilityRuntime(sdk)
    const controller = new AbortController()
    const closing = runtime.close(controller.signal)

    controller.abort()

    await expect(closing).rejects.toThrow('OpenTelemetry shutdown deadline')
    expect(sdk.shutdown).toHaveBeenCalledTimes(1)
  })
})
