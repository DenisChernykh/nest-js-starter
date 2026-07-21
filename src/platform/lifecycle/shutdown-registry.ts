import { Injectable } from '@nestjs/common'

import type {
  ShutdownParticipant,
  ShutdownResult,
} from './shutdown-participant'

/** Sealed ordered registry for cooperative resource cleanup. */
@Injectable()
export class ShutdownRegistry {
  private readonly participants = new Map<string, ShutdownParticipant>()
  private sealed = false
  private closePromise: Promise<ShutdownResult> | undefined

  /** Registers one unique participant before sealing. */
  public register(participant: ShutdownParticipant): void {
    if (this.sealed || this.participants.has(participant.name)) {
      throw new Error('Shutdown participant registration rejected')
    }
    this.participants.set(participant.name, participant)
  }

  /** Permanently closes registration. */
  public seal(): void {
    this.sealed = true
  }

  /** Closes participants by order with one shared signal and result. */
  public closeAll(signal: AbortSignal): Promise<ShutdownResult> {
    this.closePromise ??= this.closeInternal(signal)
    return this.closePromise
  }

  private async closeInternal(signal: AbortSignal): Promise<ShutdownResult> {
    if (!this.sealed) throw new Error('Shutdown registry is not sealed')
    const completed: string[] = []
    const failed: string[] = []
    const ordered = [...this.participants.values()].sort(
      (left, right) =>
        left.order - right.order || left.name.localeCompare(right.name),
    )
    for (const participant of ordered) {
      if (signal.aborted) break
      try {
        await participant.close(signal)
        completed.push(participant.name)
      } catch {
        failed.push(participant.name)
      }
    }
    return Object.freeze({
      completed: Object.freeze(completed),
      failed: Object.freeze(failed),
      timedOut: signal.aborted,
    })
  }
}
