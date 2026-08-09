import { PeriodicMaintenanceRunner } from '@/platform/maintenance/periodic-maintenance-runner'

import type { OutboxRelay } from './outbox-relay'

export interface OutboxRelayRunnerPort {
  run(signal: AbortSignal): Promise<void>
}

export class OutboxRelayRunner implements OutboxRelayRunnerPort {
  private readonly runner: PeriodicMaintenanceRunner

  public constructor(
    relay: Pick<OutboxRelay, 'runOnce'>,
    pollIntervalMs: number = 1_000,
    shutdownGraceMs: number = 10_000,
  ) {
    this.runner = new PeriodicMaintenanceRunner(() => relay.runOnce(), {
      delayMs: pollIntervalMs,
      shutdownGraceMs,
    })
  }

  public run(signal: AbortSignal): Promise<void> {
    return this.runner.run(signal)
  }
}
