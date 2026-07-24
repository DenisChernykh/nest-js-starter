import { StartupRegistry } from '@/platform/lifecycle/startup-registry'
import type { StartupParticipant } from '@/platform/lifecycle/startup-participant'

function participant(
  name: string,
  order: number,
  events: string[],
  start: () => Promise<void> = () => Promise.resolve(),
): StartupParticipant {
  return {
    name,
    order,
    start: async () => {
      events.push(`start:${name}`)
      await start()
    },
    stop: () => {
      events.push(`stop:${name}`)
      return Promise.resolve()
    },
  }
}

describe('StartupRegistry', () => {
  it('starts sequentially by order and stops completed participants in reverse', async () => {
    const events: string[] = []
    const registry = new StartupRegistry()
    registry.register(participant('redis', 200, events))
    registry.register(participant('database', 100, events))
    registry.seal()

    await registry.startAll(new AbortController().signal)
    expect(events).toEqual(['start:database', 'start:redis'])
    expect(registry.completedNames).toEqual(['database', 'redis'])

    await registry.stopStarted(new AbortController().signal)
    expect(events).toEqual([
      'start:database',
      'start:redis',
      'stop:redis',
      'stop:database',
    ])
  })

  it('cleans only completed participants and aborts later startup after failure', async () => {
    const events: string[] = []
    const registry = new StartupRegistry()
    const failure = new Error('secret redis URL')
    registry.register(participant('database', 100, events))
    registry.register(
      participant('redis', 200, events, () => Promise.reject(failure)),
    )
    registry.register(participant('later', 300, events))
    registry.seal()

    await expect(
      registry.startAll(new AbortController().signal),
    ).rejects.toMatchObject({
      message: 'Startup participant failed',
      cause: failure,
    })
    expect(events).toEqual(['start:database', 'start:redis', 'stop:database'])
    expect(registry.completedNames).toEqual([])
  })

  it('rejects duplicate and late registration', () => {
    const registry = new StartupRegistry()
    registry.register(participant('database', 100, []))
    expect(() => registry.register(participant('database', 101, []))).toThrow(
      'Startup participant registration rejected',
    )
    registry.seal()
    expect(() => registry.register(participant('redis', 200, []))).toThrow(
      'Startup participant registration rejected',
    )
  })
})
