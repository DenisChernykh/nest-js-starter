import { GracefulShutdownCoordinator } from '@/bootstrap/api/graceful-shutdown'
import type { ApiRuntime } from '@/bootstrap/api/api-runtime'

describe('GracefulShutdownCoordinator', () => {
  it('drains before listener close, then participants and app, and shares result', async () => {
    const calls: string[] = []
    const resources = {
      lifecycle: {
        phase: 'ready',
        markReady: jest.fn(),
        beginDrain: jest.fn(() => {
          calls.push('drain')
          return true
        }),
      },
      application: {
        listen: jest.fn(),
        address: jest.fn(),
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
      database: { connect: jest.fn(), close: jest.fn() },
      requestTracker: { waitForIdle: jest.fn(() => Promise.resolve(true)) },
      operationTracker: {
        waitForIdle: jest.fn(() => Promise.resolve(true)),
        abortAll: jest.fn(),
      },
      shutdownRegistry: {
        closeAll: jest.fn(() => {
          calls.push('participants')
          return Promise.resolve({
            completed: ['database'],
            failed: [],
            timedOut: false,
          })
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
      'participants',
      'app.close',
    ])
  })

  it('aborts operations, force-closes transport and exits 1 after HTTP deadline', async () => {
    const abortAll = jest.fn()
    const closeAllConnections = jest.fn()
    const runtime = {
      cancelStartup: jest.fn(),
      currentResources: {
        lifecycle: { phase: 'draining' },
        application: {
          closeListener: () => Promise.resolve(),
          closeIdleConnections: jest.fn(),
          closeAllConnections,
          close: () => Promise.resolve(),
        },
        database: { close: () => Promise.resolve() },
        requestTracker: { waitForIdle: () => Promise.resolve(false) },
        operationTracker: {
          waitForIdle: () => Promise.resolve(false),
          abortAll,
        },
        httpDrainTimeoutMs: 5,
        shutdownGraceMs: 20,
      },
    } as unknown as ApiRuntime
    await expect(
      new GracefulShutdownCoordinator(runtime).shutdown('SIGTERM'),
    ).resolves.toEqual({ exitCode: 1, forced: true })
    expect(abortAll).toHaveBeenCalledTimes(1)
    expect(closeAllConnections).toHaveBeenCalledTimes(1)
  })
})
