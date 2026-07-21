import { AsyncLocalStorage } from 'node:async_hooks'

import { Injectable } from '@nestjs/common'

/** Minimal immutable data propagated through one inbound request chain. */
export interface RequestContextState {
  readonly requestId: string
}

/** Process-local request correlation storage without transport or auth data. */
@Injectable()
export class RequestContext {
  private readonly storage = new AsyncLocalStorage<RequestContextState>()

  /** Runs a callback inside an isolated immutable request context. */
  public run<T>(requestId: string, callback: () => T): T {
    return this.storage.run(Object.freeze({ requestId }), callback)
  }

  /** Returns the active request ID, or undefined outside an inbound request. */
  public getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId
  }

  /** Returns the RFC 9457 occurrence URI for the active request. */
  public getProblemInstance(): string | undefined {
    const requestId = this.getRequestId()
    return requestId === undefined ? undefined : `urn:request:${requestId}`
  }
}
