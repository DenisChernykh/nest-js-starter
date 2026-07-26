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
  it('takes one immutable probe list and rejects duplicate/reserved names', () => {
    expect(
      () =>
        new HealthRegistry([
          indicator('postgresql', true, () => Promise.resolve('up')),
          indicator('postgresql', true, () => Promise.resolve('up')),
        ]),
    ).toThrow()
    expect(
      () =>
        new HealthRegistry([
          indicator('startup', true, () => Promise.resolve('up')),
        ]),
    ).toThrow()
    expect(
      () =>
        new HealthRegistry([
          indicator('draining', true, () => Promise.resolve('up')),
        ]),
    ).toThrow()
  })

  it('runs checks concurrently, stable-sorts keys and distinguishes optional down', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started: string[] = []
    const registry = new HealthRegistry([
      indicator('zeta', true, async () => {
        started.push('zeta')
        await gate
        return 'up'
      }),
      indicator('auxiliary', false, async () => {
        started.push('auxiliary')
        await gate
        return 'down'
      }),
    ])
    const checking = registry.checkAll(new AbortController().signal)
    await Promise.resolve()
    expect(started.sort()).toEqual(['auxiliary', 'zeta'])
    release()
    await expect(checking).resolves.toEqual({
      checks: { auxiliary: 'down', zeta: 'up' },
      requiredAvailable: true,
    })
  })

  it('maps throws to down without exposing exception text', async () => {
    const result = await new HealthRegistry([
      indicator('postgresql', true, () =>
        Promise.reject(new Error('secret url')),
      ),
    ]).checkAll(new AbortController().signal)
    expect(result).toEqual({
      checks: { postgresql: 'down' },
      requiredAvailable: false,
    })
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('aborts timed-out checks without awaiting late cleanup', async () => {
    let cleaned = false
    const result = await new HealthRegistry([
      indicator(
        'postgresql',
        true,
        (signal) =>
          new Promise((resolve) =>
            signal.addEventListener(
              'abort',
              () => {
                setTimeout(() => {
                  cleaned = true
                  resolve('up')
                }, 5)
              },
              { once: true },
            ),
          ),
        5,
      ),
    ]).checkAll(new AbortController().signal)
    expect(result).toEqual({
      checks: { postgresql: 'down' },
      requiredAvailable: false,
    })
    expect(cleaned).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(cleaned).toBe(true)
  })

  it('returns down when a probe ignores abort and never settles', async () => {
    const result = await new HealthRegistry([
      indicator('postgresql', true, () => new Promise(() => undefined), 5),
    ]).checkAll(new AbortController().signal)
    expect(result).toEqual({
      checks: { postgresql: 'down' },
      requiredAvailable: false,
    })
  })

  it('propagates parent abort to every running indicator', async () => {
    const aborted: string[] = []
    const registry = new HealthRegistry(
      ['one', 'two'].map((name) =>
        indicator(
          name,
          true,
          (signal) =>
            new Promise((resolve) =>
              signal.addEventListener(
                'abort',
                () => {
                  aborted.push(name)
                  resolve('down')
                },
                { once: true },
              ),
            ),
        ),
      ),
    )
    const parent = new AbortController()
    const checking = registry.checkAll(parent.signal)
    parent.abort()
    await checking
    expect(aborted.sort()).toEqual(['one', 'two'])
  })
})
