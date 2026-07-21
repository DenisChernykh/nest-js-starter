import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import type { Request, Response } from 'express'
import { defer, type Observable } from 'rxjs'
import { finalize } from 'rxjs/operators'

import { ActiveOperationTracker } from './active-operation-tracker'
import { RequestOperationContext } from './request-operation.context'

/** Tracks readiness and application handler settlement with cooperative abort. */
@Injectable()
export class RequestOperationInterceptor implements NestInterceptor {
  public constructor(
    private readonly tracker: ActiveOperationTracker,
    private readonly operationContext: RequestOperationContext,
  ) {}

  /** Wraps non-trivial handlers in an operation lease. */
  public intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const http = context.switchToHttp()
    const request = http.getRequest<Request>()
    if (request.path === '/health/live' || request.path === '/health/startup') {
      return next.handle()
    }
    const response = http.getResponse<Response>()
    const lease = this.tracker.begin()
    const abort = (): void => lease.abort()
    request.once('aborted', abort)
    response.once('close', abort)
    return defer(() =>
      this.operationContext.run(lease.signal, () => next.handle()),
    ).pipe(
      finalize(() => {
        request.off('aborted', abort)
        response.off('close', abort)
        lease.complete()
      }),
    )
  }
}
