import { AsyncLocalStorage } from 'node:async_hooks'

import { Injectable } from '@nestjs/common'

/** Carries the cooperative handler AbortSignal through async execution. */
@Injectable()
export class RequestOperationContext {
  private readonly storage = new AsyncLocalStorage<AbortSignal>()

  /** Returns the current handler signal when the endpoint is tracked. */
  public get signal(): AbortSignal | undefined {
    return this.storage.getStore()
  }

  /** Runs one handler factory inside its signal context. */
  public run<T>(signal: AbortSignal, operation: () => T): T {
    return this.storage.run(signal, operation)
  }
}
