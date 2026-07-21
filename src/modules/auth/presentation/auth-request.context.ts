import { AsyncLocalStorage } from 'node:async_hooks'

import { Injectable } from '@nestjs/common'

import { AuthenticationRequiredError } from '../application/auth-errors'
import type { AuthenticatedPrincipal } from '../application/auth.types'

interface AuthRequestState {
  readonly principal: AuthenticatedPrincipal
  readonly rawToken: string
}

/** Carries authenticated state through guards and the request async chain. */
@Injectable()
export class AuthRequestContext {
  private readonly storage = new AsyncLocalStorage<AuthRequestState>()
  private readonly prepared = new WeakMap<object, AuthRequestState>()

  /** Returns the current principal or fails outside authenticated execution. */
  public get principal(): AuthenticatedPrincipal {
    const state = this.storage.getStore()
    if (state === undefined) throw new AuthenticationRequiredError()
    return state.principal
  }

  /** Returns the current opaque token only inside authenticated execution. */
  public get rawToken(): string {
    const state = this.storage.getStore()
    if (state === undefined) throw new AuthenticationRequiredError()
    return state.rawToken
  }

  /** Binds a guard result to its concrete request until interceptor admission. */
  public prepare(
    request: object,
    principal: AuthenticatedPrincipal,
    rawToken: string,
  ): void {
    this.prepared.set(request, Object.freeze({ principal, rawToken }))
  }

  /** Returns guard-stage state for the same request without starting ALS. */
  public preparedState(request: object): AuthRequestState {
    const state = this.prepared.get(request)
    if (state === undefined) throw new AuthenticationRequiredError()
    return state
  }

  /** Runs a handler inside the principal bound to its concrete request. */
  public run<T>(request: object, operation: () => T): T {
    const state = this.prepared.get(request)
    if (state === undefined) throw new AuthenticationRequiredError()
    this.prepared.delete(request)
    return this.storage.run(state, operation)
  }
}
