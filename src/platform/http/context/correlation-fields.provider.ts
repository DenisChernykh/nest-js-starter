import { Injectable } from '@nestjs/common'
import { isSpanContextValid, trace } from '@opentelemetry/api'

import { RequestContext } from './request-context'

interface CorrelationFieldsSnapshot {
  readonly requestId?: string
  readonly traceId?: string
  readonly spanId?: string
}

/** Resolves request and active OpenTelemetry identifiers at log-write time. */
@Injectable()
export class CorrelationFieldsProvider {
  public constructor(private readonly requestContext: RequestContext) {}

  /** Returns only identifiers backed by currently active valid contexts. */
  public getFields(): CorrelationFieldsSnapshot {
    const requestId = this.requestContext.getRequestId()
    const spanContext = trace.getActiveSpan()?.spanContext()
    const validSpan =
      spanContext !== undefined && isSpanContextValid(spanContext)
        ? spanContext
        : undefined

    return {
      ...(requestId === undefined ? {} : { requestId }),
      ...(validSpan === undefined
        ? {}
        : { traceId: validSpan.traceId, spanId: validSpan.spanId }),
    }
  }
}
