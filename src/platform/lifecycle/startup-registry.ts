import { Injectable } from '@nestjs/common'

import type { StartupParticipant } from './startup-participant'

/** Sealed sequential startup graph with reverse rollback of completed work. */
@Injectable()
export class StartupRegistry {
  private readonly participants = new Map<string, StartupParticipant>()
  private readonly started: StartupParticipant[] = []
  private sealed = false
  private startPromise: Promise<void> | undefined

  /** Registers one unique participant before the graph is sealed. */
  public register(participant: StartupParticipant): void {
    if (this.sealed || this.participants.has(participant.name))
      throw new Error('Startup participant registration rejected')
    this.participants.set(participant.name, participant)
  }

  /** Permanently closes registration before the first startup attempt. */
  public seal(): void {
    this.sealed = true
  }

  /** Returns successfully started names in their original start order. */
  public get completedNames(): readonly string[] {
    return Object.freeze(this.started.map(({ name }) => name))
  }

  /** Starts every participant sequentially and rolls back on any failure. */
  public startAll(signal: AbortSignal): Promise<void> {
    this.startPromise ??= this.startInternal(signal)
    return this.startPromise
  }

  /** Stops only completed participants in reverse start order. */
  public async stopStarted(signal: AbortSignal): Promise<void> {
    const failures: string[] = []
    for (const participant of [...this.started].reverse()) {
      if (signal.aborted) {
        failures.push(participant.name)
        continue
      }
      try {
        await participant.stop(signal)
        const index = this.started.lastIndexOf(participant)
        if (index >= 0) this.started.splice(index, 1)
      } catch {
        failures.push(participant.name)
      }
    }
    if (failures.length > 0) throw new Error('Startup cleanup incomplete')
  }

  private async startInternal(signal: AbortSignal): Promise<void> {
    if (!this.sealed) throw new Error('Startup registry is not sealed')
    const ordered = [...this.participants.values()].sort(
      (left, right) =>
        left.order - right.order || left.name.localeCompare(right.name),
    )
    try {
      for (const participant of ordered) {
        if (signal.aborted) throw new Error('Startup aborted')
        await participant.start(signal)
        this.started.push(participant)
      }
    } catch {
      await this.stopStarted(new AbortController().signal).catch(
        () => undefined,
      )
      throw new Error('Startup participant failed')
    }
  }
}
