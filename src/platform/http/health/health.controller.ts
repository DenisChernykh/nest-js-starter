import { Controller, Get, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'

import { SafeEndpoint } from '@/platform/http/policy/safe-endpoint.decorator'
import { PublicEndpoint } from '@/platform/http/policy/public-endpoint.decorator'
import { RequestOperationContext } from '@/platform/http/bootstrap/request-operation.context'

import { HealthService } from './health.service'
import type {
  HealthHttpResult,
  LivenessSnapshot,
  ReadinessSnapshot,
  StartupSnapshot,
} from './health.types'

/** Serves stable health endpoints outside the application prefix. */
@Controller('health')
@PublicEndpoint()
export class HealthController {
  public constructor(
    private readonly health: HealthService,
    private readonly operationContext: RequestOperationContext,
  ) {}

  /** Serves unconditional process liveness. */
  @Get('live')
  @SafeEndpoint()
  public live(
    @Res({ passthrough: true }) response: Response,
  ): LivenessSnapshot {
    return this.write(response, this.health.live())
  }

  /** Serves the irreversible startup latch. */
  @Get('startup')
  @SafeEndpoint()
  public startup(
    @Res({ passthrough: true }) response: Response,
  ): StartupSnapshot {
    return this.write(response, this.health.startup())
  }

  /** Serves bounded dependency readiness tied to transport cancellation. */
  @Get('ready')
  @SafeEndpoint()
  public async ready(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReadinessSnapshot> {
    const parent = new AbortController()
    const abort = (): void => parent.abort()
    request.once('aborted', abort)
    response.once('close', abort)
    try {
      return this.write(
        response,
        await this.health.ready(this.operationContext.signal ?? parent.signal),
      )
    } finally {
      request.off('aborted', abort)
      response.off('close', abort)
    }
  }

  private write<T>(response: Response, result: HealthHttpResult<T>): T {
    response.status(result.statusCode)
    return result.body
  }
}
