export interface StoppableTestRuntime {
  stop(): Promise<void>
}

export function startRuntimeGroup<
  Runtimes extends readonly StoppableTestRuntime[],
>(factories: {
  readonly [Index in keyof Runtimes]: () => Promise<Runtimes[Index]>
}): Promise<Runtimes> {
  return settleRuntimeGroup(factories)
}

async function settleRuntimeGroup<
  Runtimes extends readonly StoppableTestRuntime[],
>(factories: {
  readonly [Index in keyof Runtimes]: () => Promise<Runtimes[Index]>
}): Promise<Runtimes> {
  const results = await Promise.allSettled(
    factories.map((factory) => Promise.resolve().then(factory)),
  )
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (failure !== undefined) {
    await Promise.allSettled(
      results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value.stop()] : [],
      ),
    )
    const reason: unknown = failure.reason
    throw reason
  }
  return results.map((result) => {
    if (result.status === 'rejected') throw new Error('unreachable')
    return result.value
  }) as unknown as Runtimes
}
