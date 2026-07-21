import { HealthRegistry } from '@/platform/http/health/health-registry'
import type { ReadinessIndicator } from '@/platform/http/health/readiness-indicator'

function indicator(
  name: string,
  required: boolean,
  check: ReadinessIndicator['check'],
  timeoutMs = 100,
): ReadinessIndicator {
  return { name, required, timeoutMs, check }
}

describe('HealthRegistry', () => {
  it('registers before seal and rejects duplicate, reserved and late names', () => {
    const registry = new HealthRegistry()
    registry.register(
      indicator('postgresql', true, () => Promise.resolve('up')),
    )
    expect(() =>
      registry.register(
        indicator('postgresql', true, () => Promise.resolve('up')),
      ),
    ).toThrow()
    expect(() =>
      registry.register(
        indicator('startup', true, () => Promise.resolve('up')),
      ),
    ).toThrow()
    expect(() =>
      registry.register(
        indicator('draining', true, () => Promise.resolve('up')),
      ),
    ).toThrow()
    registry.seal()
    expect(() =>
      registry.register(indicator('late', false, () => Promise.resolve('up'))),
    ).toThrow()
  })

  it('runs checks concurrently, stable-sorts keys and distinguishes optional down', async () => {
    const registry = new HealthRegistry()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started: string[] = []
    registry.register(
      indicator('zeta', true, async () => {
        started.push('zeta')
        await gate
        return 'up'
      }),
    )
    registry.register(
      indicator('auxiliary', false, async () => {
        started.push('auxiliary')
        await gate
        return 'down'
      }),
    )
    registry.seal()
    const checking = registry.checkAll(new AbortController().signal)
    await Promise.resolve()
    expect(started.sort()).toEqual(['auxiliary', 'zeta'])
    release?.()
    await expect(checking).resolves.toEqual({
      checks: { auxiliary: 'down', zeta: 'up' },
      requiredAvailable: true,
    })
  })

  it('maps throws to down without exposing exception text', async () => {
    const registry = new HealthRegistry()
    registry.register(
      indicator('postgresql', true, () =>
        Promise.reject(new Error('secret url')),
      ),
    )
    registry.seal()
    const result = await registry.checkAll(new AbortController().signal)
    expect(result).toEqual({
      checks: { postgresql: 'down' },
      requiredAvailable: false,
    })
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('aborts timed-out checks and waits for their cleanup settlement', async () => {
    const registry = new HealthRegistry()
    let cleaned = false
    registry.register(
      indicator(
        'postgresql',
        true,
        (signal) =>
          new Promise((resolve) => {
            signal.addEventListener(
              'abort',
              () => {
                setTimeout(() => {
                  cleaned = true
                  resolve('up')
                }, 5)
              },
              { once: true },
            )
          }),
        5,
      ),
    )
    registry.seal()
    await expect(
      registry.checkAll(new AbortController().signal),
    ).resolves.toEqual({
      checks: { postgresql: 'down' },
      requiredAvailable: false,
    })
    expect(cleaned).toBe(true)
  })

  it('propagates parent abort to every running indicator', async () => {
    const registry = new HealthRegistry()
    const aborted: string[] = []
    for (const name of ['one', 'two']) {
      registry.register(
        indicator(
          name,
          true,
          (signal) =>
            new Promise((resolve) => {
              signal.addEventListener(
                'abort',
                () => {
                  aborted.push(name)
                  resolve('down')
                },
                { once: true },
              )
            }),
        ),
      )
    }
    registry.seal()
    const parent = new AbortController()
    const checking = registry.checkAll(parent.signal)
    parent.abort()
    await checking
    expect(aborted.sort()).toEqual(['one', 'two'])
  })
})
