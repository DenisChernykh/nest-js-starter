import { ApiRuntime } from '@/bootstrap/api/api-runtime'

function deferred(): {
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly reject: (error: Error) => void
} {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

interface RuntimeHarness {
  readonly runtime: ApiRuntime
  readonly factory: jest.Mock
  readonly application: {
    readonly listen: jest.Mock
    readonly close: jest.Mock
    readonly address: jest.Mock
  }
  readonly database: { readonly connect: jest.Mock; readonly close: jest.Mock }
  readonly startupRegistry: {
    readonly startAll: jest.Mock
    readonly stopStarted: jest.Mock
  }
  readonly lifecycle: {
    phase: 'starting' | 'ready' | 'draining'
    readonly markReady: jest.Mock
    readonly beginDrain: jest.Mock
  }
  readonly connecting: ReturnType<typeof deferred>
}

function harness(): RuntimeHarness {
  const connecting = deferred()
  const lifecycle = {
    phase: 'starting' as 'starting' | 'ready' | 'draining',
    markReady: jest.fn(),
    beginDrain: jest.fn(() => {
      lifecycle.phase = 'draining'
      return true
    }),
  }
  const database = {
    connect: jest.fn(() => connecting.promise),
    close: jest.fn(() => Promise.resolve()),
  }
  const startupRegistry = {
    startAll: jest.fn(() => connecting.promise),
    stopStarted: jest.fn(() => Promise.resolve()),
  }
  const application = {
    listen: jest.fn(() => Promise.resolve()),
    close: jest.fn(() => Promise.resolve()),
    address: jest.fn(() => ({
      address: '127.0.0.1',
      family: 'IPv4',
      port: 3210,
    })),
  }
  const factory = jest.fn(() =>
    Promise.resolve({ application, database, startupRegistry, lifecycle }),
  )
  return {
    runtime: new ApiRuntime(factory),
    factory,
    application,
    database,
    startupRegistry,
    lifecycle,
    connecting,
  }
}

describe('ApiRuntime', () => {
  it('marks ready only after listener and every startup participant complete', async () => {
    const { runtime, application, startupRegistry, lifecycle, connecting } =
      harness()
    const starting = runtime.start()
    await Promise.resolve()
    await Promise.resolve()
    expect(application.listen).toHaveBeenCalled()
    expect(startupRegistry.startAll).toHaveBeenCalled()
    expect(lifecycle.markReady).not.toHaveBeenCalled()
    connecting.resolve()
    await expect(starting).resolves.toEqual({
      address: '127.0.0.1',
      family: 'IPv4',
      port: 3210,
    })
    expect(lifecycle.markReady).toHaveBeenCalledTimes(1)
  })

  it('shares one startup promise across concurrent callers', () => {
    const { runtime, factory } = harness()
    expect(runtime.start()).toBe(runtime.start())
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('cancels before start without initializing', async () => {
    const { runtime, factory, lifecycle } = harness()
    runtime.cancelStartup()
    await expect(runtime.start()).rejects.toThrow('API startup failed')
    expect(factory).not.toHaveBeenCalled()
    expect(lifecycle.markReady).not.toHaveBeenCalled()
  })

  it('aborts deferred connect, prevents late ready and cleans partial handles', async () => {
    const { runtime, application, startupRegistry, lifecycle, connecting } =
      harness()
    const starting = runtime.start()
    await Promise.resolve()
    await Promise.resolve()
    runtime.cancelStartup()
    expect(startupRegistry.startAll).toHaveBeenCalledWith(
      expect.objectContaining({ aborted: true }),
    )
    connecting.resolve()
    await expect(starting).rejects.toThrow('API startup failed')
    expect(lifecycle.markReady).not.toHaveBeenCalled()
    expect(application.close).toHaveBeenCalledTimes(1)
    expect(startupRegistry.stopStarted).toHaveBeenCalledTimes(1)
  })

  it('cleans partial handles when startup fails', async () => {
    const { runtime, application, startupRegistry, lifecycle, connecting } =
      harness()
    const starting = runtime.start()
    connecting.reject(new Error('secret driver failure'))
    await expect(starting).rejects.toThrow('API startup failed')
    expect(lifecycle.markReady).not.toHaveBeenCalled()
    expect(application.close).toHaveBeenCalledTimes(1)
    expect(startupRegistry.stopStarted).toHaveBeenCalledTimes(1)
  })
})
