import { ShutdownRegistry } from '@/platform/lifecycle/shutdown-registry'

describe('ShutdownRegistry', () => {
  it('seals registration, closes by order and records later-safe failures', async () => {
    const registry = new ShutdownRegistry()
    const calls: string[] = []
    registry.register({
      name: 'database',
      order: 300,
      close: () => {
        calls.push('database')
        return Promise.resolve()
      },
    })
    registry.register({
      name: 'redis',
      order: 100,
      close: () => {
        calls.push('redis')
        return Promise.reject(new Error('failed'))
      },
    })
    registry.register({
      name: 'opentelemetry',
      order: 400,
      close: () => {
        calls.push('opentelemetry')
        return Promise.resolve()
      },
    })
    expect(() =>
      registry.register({
        name: 'redis',
        order: 1,
        close: () => Promise.resolve(),
      }),
    ).toThrow()
    registry.seal()
    expect(() =>
      registry.register({
        name: 'late',
        order: 1,
        close: () => Promise.resolve(),
      }),
    ).toThrow()
    const signal = new AbortController().signal
    const first = registry.closeAll(signal)
    expect(registry.closeAll(signal)).toBe(first)
    await expect(first).resolves.toEqual({
      completed: ['database', 'opentelemetry'],
      failed: ['redis'],
      timedOut: false,
    })
    expect(calls).toEqual(['redis', 'database', 'opentelemetry'])
  })

  it('reports a shared aborted deadline', async () => {
    const registry = new ShutdownRegistry()
    const controller = new AbortController()
    registry.register({
      name: 'first',
      order: 1,
      close: () => {
        controller.abort()
        return Promise.resolve()
      },
    })
    registry.register({
      name: 'second',
      order: 2,
      close: () => Promise.resolve(),
    })
    registry.seal()
    await expect(registry.closeAll(controller.signal)).resolves.toEqual({
      completed: ['first'],
      failed: [],
      timedOut: true,
    })
  })
})
