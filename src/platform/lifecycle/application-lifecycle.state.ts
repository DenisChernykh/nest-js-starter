import { Injectable } from '@nestjs/common'

/** One-way process traffic lifecycle. */
export type ApplicationPhase = 'starting' | 'ready' | 'draining'

/** Owns explicit, monotonic startup and drain transitions. */
@Injectable()
export class ApplicationLifecycleState {
  private currentPhase: ApplicationPhase = 'starting'
  private startupLatch = false

  /** Returns the current one-way process phase. */
  public get phase(): ApplicationPhase {
    return this.currentPhase
  }

  /** Reports whether startup reached ready at least once. */
  public get startupComplete(): boolean {
    return this.startupLatch
  }

  /** Moves a starting process to ready without reversing a drain. */
  public markReady(): void {
    if (this.currentPhase === 'starting') {
      this.currentPhase = 'ready'
      this.startupLatch = true
    }
  }

  /** Begins drain and returns true only to the transition winner. */
  public beginDrain(): boolean {
    if (this.currentPhase === 'draining') {
      return false
    }
    this.currentPhase = 'draining'
    return true
  }
}
