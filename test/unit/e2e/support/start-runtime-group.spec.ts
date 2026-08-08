import { startRuntimeGroup } from '@test/e2e/support/start-runtime-group'

interface TestRuntime {
  readonly name: string
  stop(): Promise<void>
}

function createRuntime(name: string, stopped: string[]): TestRuntime {
  return {
    name,
    stop: () => {
      stopped.push(name)
      return Promise.resolve()
    },
  }
}

describe('startRuntimeGroup', () => {
  it('stops every successful runtime when one sibling startup fails', async () => {
    const startupFailure = new Error('runtime startup failed')
    const stopped: string[] = []
    const first = createRuntime('first', stopped)
    const late = createRuntime('late', stopped)
    const deferred = Promise.withResolvers<TestRuntime>()

    const starting = startRuntimeGroup([
      () => Promise.resolve(first),
      () => Promise.reject(startupFailure),
      () => deferred.promise,
    ] as const)
    deferred.resolve(late)

    await expect(starting).rejects.toBe(startupFailure)
    expect(stopped).toEqual(['first', 'late'])
  })

  it('contains a synchronous factory failure and cleans started siblings', async () => {
    const startupFailure = new Error('synchronous startup failure')
    const stopped: string[] = []
    const first = createRuntime('first', stopped)
    const last = createRuntime('last', stopped)

    const starting = startRuntimeGroup([
      () => Promise.resolve(first),
      () => {
        throw startupFailure
      },
      () => Promise.resolve(last),
    ] as const)

    await expect(starting).rejects.toBe(startupFailure)
    expect(stopped).toEqual(['first', 'last'])
  })
})
