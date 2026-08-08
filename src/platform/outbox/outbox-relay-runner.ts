import type { OutboxRelay } from './outbox-relay'

export interface OutboxRelayRunnerPort {
  run(signal: AbortSignal): Promise<void>
}

export class OutboxRelayRunner implements OutboxRelayRunnerPort {
  public constructor(
    private readonly relay: Pick<OutboxRelay, 'runOnce'>,
    private readonly pollIntervalMs: number = 1_000,
    private readonly shutdownGraceMs: number = 10_000,
  ) {}

  public async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const cycle = this.relay.runOnce()
      const completed = await this.waitForCycleOrAbort(cycle, signal)
      if (!completed) {
        await this.waitForCycleWithinGrace(cycle)
        return
      }
      await this.waitForPoll(signal)
    }
  }

  private async waitForCycleOrAbort(
    cycle: Promise<void>,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (signal.aborted) return false
    return new Promise<boolean>((resolve, reject) => {
      const onAbort = (): void => done(false)
      const done = (completed: boolean): void => {
        signal.removeEventListener('abort', onAbort)
        resolve(completed)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      void cycle.then(() => done(true), reject)
    })
  }

  private async waitForCycleWithinGrace(cycle: Promise<void>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const bounded = await Promise.race([
      cycle.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), this.shutdownGraceMs)
      }),
    ]).finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    })
    if (!bounded) {
      void cycle.catch(() => undefined)
    }
  }

  private async waitForPoll(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      return
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, this.pollIntervalMs)
      const onAbort = (): void => done()
      function done(): void {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        resolve()
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }
}
