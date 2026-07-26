import { ApiRuntime } from '@/bootstrap/api/api-runtime'

function harness(): {
  readonly runtime: ApiRuntime
  readonly factory: jest.Mock
  readonly application: {
    readonly listen: jest.Mock
    readonly close: jest.Mock
    readonly address: jest.Mock
  }
  readonly database: { readonly connect: jest.Mock; readonly close: jest.Mock }
  readonly redis: { readonly connect: jest.Mock; readonly close: jest.Mock }
  readonly lifecycle: {
    readonly phase: 'starting'
    readonly markReady: jest.Mock
    readonly beginDrain: jest.Mock
  }
} {
  const connecting = { promise: Promise.resolve(), resolve: () => undefined }
  const application = {
    listen: jest.fn(() => Promise.resolve()),
    close: jest.fn(() => Promise.resolve()),
    address: jest.fn(() => ({
      address: '127.0.0.1',
      family: 'IPv4',
      port: 3210,
    })),
  }
  const database = {
    connect: jest.fn(() => connecting.promise),
    close: jest.fn(() => Promise.resolve()),
  }
  const redis = {
    connect: jest.fn(() => Promise.resolve()),
    close: jest.fn(() => Promise.resolve()),
  }
  const lifecycle = {
    phase: 'starting' as const,
    markReady: jest.fn(),
    beginDrain: jest.fn(() => true),
  }
  const factory = jest.fn(() =>
    Promise.resolve({
      application,
      database,
      redis: redis as never,
      lifecycle,
    }),
  )
  return {
    runtime: new ApiRuntime(factory),
    factory,
    application,
    database,
    redis,
    lifecycle,
  }
}

describe('ApiRuntime', () => {
  it('starts listener, database, Redis and only then marks ready', async () => {
    const { runtime, application, database, redis, lifecycle } = harness()
    await expect(runtime.start()).resolves.toEqual({
      address: '127.0.0.1',
      family: 'IPv4',
      port: 3210,
    })
    expect(application.listen).toHaveBeenCalledTimes(1)
    expect(database.connect).toHaveBeenCalledTimes(1)
    expect(redis.connect).toHaveBeenCalledTimes(1)
    expect(lifecycle.markReady).toHaveBeenCalledTimes(1)
  })
  it('shares one startup promise and closes Redis before database during stop', async () => {
    const target = harness()
    expect(target.runtime.start()).toBe(target.runtime.start())
    await target.runtime.start()
    await target.runtime.stop()
    expect(target.redis.close.mock.invocationCallOrder[0]!).toBeLessThan(
      target.database.close.mock.invocationCallOrder[0]!,
    )
    expect(target.database.close.mock.invocationCallOrder[0]!).toBeLessThan(
      target.application.close.mock.invocationCallOrder[0]!,
    )
  })
})
