import { GracefulShutdownCoordinator } from '@/bootstrap/api/graceful-shutdown'
import type { ApiRuntime } from '@/bootstrap/api/api-runtime'

describe('GracefulShutdownCoordinator', () => {
  it('drains HTTP and closes Redis, database, OTel in order', async () => {
    const calls: string[] = []
    const resources = {
      lifecycle: {
        phase: 'ready',
        beginDrain: jest.fn(() => {
          calls.push('drain')
          return true
        }),
      },
      application: {
        closeListener: jest.fn(() => {
          calls.push('server.close')
          return Promise.resolve()
        }),
        closeIdleConnections: jest.fn(() => calls.push('idle.close')),
        closeAllConnections: jest.fn(),
        close: jest.fn(() => {
          calls.push('app.close')
          return Promise.resolve()
        }),
      },
      requestTracker: { waitForIdle: jest.fn(() => Promise.resolve(true)) },
      redis: {
        close: jest.fn(() => {
          calls.push('redis.close')
          return Promise.resolve()
        }),
      },
      database: {
        close: jest.fn(() => {
          calls.push('database.close')
          return Promise.resolve()
        }),
      },
      observability: {
        close: jest.fn(() => {
          calls.push('otel.close')
          return Promise.resolve()
        }),
      },
      httpDrainTimeoutMs: 50,
      shutdownGraceMs: 200,
    }
    const runtime = {
      cancelStartup: jest.fn(() => resources.lifecycle.beginDrain()),
      currentResources: resources,
    } as unknown as ApiRuntime
    const coordinator = new GracefulShutdownCoordinator(runtime)
    const first = coordinator.shutdown('SIGTERM')
    expect(coordinator.shutdown('SIGTERM')).toBe(first)
    await expect(first).resolves.toEqual({ exitCode: 0, forced: false })
    expect(calls).toEqual([
      'drain',
      'server.close',
      'idle.close',
      'redis.close',
      'database.close',
      'otel.close',
      'app.close',
    ])
  })
  it('force-closes transport when active requests miss the drain deadline', async () => {
    const closeAllConnections = jest.fn()
    const runtime = {
      cancelStartup: jest.fn(),
      currentResources: {
        application: {
          closeListener: () => Promise.resolve(),
          closeIdleConnections: jest.fn(),
          closeAllConnections,
          close: () => Promise.resolve(),
        },
        requestTracker: { waitForIdle: () => Promise.resolve(false) },
        redis: { close: () => Promise.resolve() },
        database: { close: () => Promise.resolve() },
        httpDrainTimeoutMs: 5,
        shutdownGraceMs: 20,
      },
    } as unknown as ApiRuntime
    await expect(
      new GracefulShutdownCoordinator(runtime).shutdown('SIGTERM'),
    ).resolves.toEqual({ exitCode: 1, forced: true })
    expect(closeAllConnections).toHaveBeenCalledTimes(1)
  })
})
