import { randomUUID } from 'node:crypto'

import {
  Catch,
  Inject,
  Injectable,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'

import { RequestContext } from '@/platform/http/context/request-context'
import { REQUEST_ID_HEADER } from '@/platform/http/context/request-id'
import {
  STRUCTURED_LOGGER,
  type StructuredLogger,
} from '@/platform/logging/logging.contracts'

import { mapHttpProblem } from './http-problem.mapper'
import type { ProblemDocument } from './problem.contracts'

/** Sole HTTP failure boundary producing safe RFC 9457 documents. */
@Catch()
@Injectable()
export class ProblemExceptionFilter implements ExceptionFilter<unknown> {
  public constructor(
    @Inject(HttpAdapterHost)
    private readonly adapterHost: HttpAdapterHost,
    @Inject(RequestContext)
    private readonly requestContext: RequestContext,
    @Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  /** Writes at most one response and one error record for an unexpected 5xx. */
  public catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.adapterHost
    const response = host.switchToHttp().getResponse<unknown>()
    if (httpAdapter.isHeadersSent(response)) return

    const mapped = mapHttpProblem(exception)
    const requestId = this.requestContext.getRequestId() ?? randomUUID()
    const document: ProblemDocument = {
      type: mapped.definition.type,
      title: mapped.definition.title,
      status: mapped.definition.status,
      detail: mapped.definition.detail,
      instance: `urn:request:${requestId}`,
      code: mapped.definition.code,
      requestId,
      ...(mapped.errors === undefined ? {} : { errors: mapped.errors }),
    }

    httpAdapter.setHeader(response, REQUEST_ID_HEADER, requestId)
    httpAdapter.setHeader(response, 'Content-Type', 'application/problem+json')
    if (mapped.retryAfterSeconds !== undefined) {
      httpAdapter.setHeader(
        response,
        'Retry-After',
        String(mapped.retryAfterSeconds),
      )
    }
    if (mapped.unexpected) {
      try {
        this.logger.write({
          level: 'error',
          event: 'http_unhandled_error',
          module: 'ProblemExceptionFilter',
          error: exception,
        })
      } catch {
        // A logging sink failure must not prevent the safe HTTP response.
      }
    }
    httpAdapter.reply(response, document, mapped.definition.status)
  }
}
