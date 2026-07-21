import { HealthRegistry } from '@/platform/http/health/health-registry'
import { HealthService } from '@/platform/http/health/health.service'
import { ApplicationLifecycleState } from '@/platform/lifecycle/application-lifecycle.state'

function createHarness(status: 'up' | 'down' = 'up'): {
  readonly lifecycle: ApplicationLifecycleState
  readonly service: HealthService
  readonly check: jest.Mock
} {
  const lifecycle = new ApplicationLifecycleState()
  const registry = new HealthRegistry()
  const check = jest.fn(() => Promise.resolve(status))
  registry.register({
    name: 'postgresql',
    required: true,
    timeoutMs: 100,
    check,
  })
  registry.seal()
  return { lifecycle, service: new HealthService(lifecycle, registry), check }
}

describe('HealthService', () => {
  it('reports live without calling indicators', () => {
    const { service, check } = createHarness()
    expect(service.live()).toEqual({ statusCode: 200, body: { status: 'ok' } })
    expect(check).not.toHaveBeenCalled()
  })

  it('implements the irreversible startup latch', () => {
    const { lifecycle, service } = createHarness()
    expect(service.startup()).toEqual({
      statusCode: 503,
      body: { status: 'starting' },
    })
    lifecycle.markReady()
    expect(service.startup()).toEqual({
      statusCode: 200,
      body: { status: 'ok' },
    })
    lifecycle.beginDrain()
    expect(service.startup()).toEqual({
      statusCode: 200,
      body: { status: 'ok' },
    })
  })

  it('skips readiness checks while starting or draining', async () => {
    const { lifecycle, service, check } = createHarness()
    await expect(service.ready(new AbortController().signal)).resolves.toEqual({
      statusCode: 503,
      body: {
        status: 'unavailable',
        checks: { draining: 'up', postgresql: 'skipped', startup: 'down' },
      },
    })
    lifecycle.beginDrain()
    await expect(service.ready(new AbortController().signal)).resolves.toEqual({
      statusCode: 503,
      body: {
        status: 'unavailable',
        checks: { draining: 'down', postgresql: 'skipped', startup: 'down' },
      },
    })
    expect(check).not.toHaveBeenCalled()
  })

  it.each([
    ['up', 200, 'ok'],
    ['down', 503, 'unavailable'],
  ] as const)(
    'maps required PostgreSQL %s to readiness',
    async (status, code, top) => {
      const { lifecycle, service } = createHarness(status)
      lifecycle.markReady()
      await expect(
        service.ready(new AbortController().signal),
      ).resolves.toEqual({
        statusCode: code,
        body: {
          status: top,
          checks: { draining: 'up', postgresql: status, startup: 'up' },
        },
      })
    },
  )

  it('re-checks drain state after an awaited indicator', async () => {
    const lifecycle = new ApplicationLifecycleState()
    lifecycle.markReady()
    const registry = new HealthRegistry()
    let release: (() => void) | undefined
    registry.register({
      name: 'postgresql',
      required: true,
      timeoutMs: 100,
      check: () =>
        new Promise((resolve) => {
          release = () => resolve('up')
        }),
    })
    registry.seal()
    const service = new HealthService(lifecycle, registry)
    const checking = service.ready(new AbortController().signal)
    lifecycle.beginDrain()
    release?.()
    await expect(checking).resolves.toEqual({
      statusCode: 503,
      body: {
        status: 'unavailable',
        checks: { draining: 'down', postgresql: 'skipped', startup: 'up' },
      },
    })
  })

  it('reports optional down without blocking readiness', async () => {
    const lifecycle = new ApplicationLifecycleState()
    lifecycle.markReady()
    const registry = new HealthRegistry()
    registry.register({
      name: 'postgresql',
      required: true,
      timeoutMs: 100,
      check: () => Promise.resolve('up'),
    })
    registry.register({
      name: 'auxiliary',
      required: false,
      timeoutMs: 100,
      check: () => Promise.resolve('down'),
    })
    registry.seal()

    await expect(
      new HealthService(lifecycle, registry).ready(
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      statusCode: 200,
      body: {
        status: 'ok',
        checks: {
          auxiliary: 'down',
          draining: 'up',
          postgresql: 'up',
          startup: 'up',
        },
      },
    })
  })
})
