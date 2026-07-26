import { Controller, Get, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'

import { PublicEndpoint } from '@/platform/http/policy/public-endpoint.decorator'

import { HealthService } from './health.service'
import type { HealthHttpResult } from './health.types'
import {
  LivenessResponseDto,
  ReadinessResponseDto,
  StartupResponseDto,
} from './health-response.dto'
import { ApiProblemResponses } from '@/platform/http/docs/api-problem-responses.decorator'

/** Serves stable health endpoints outside the application prefix. */
@Controller('health')
@PublicEndpoint()
@ApiTags('health')
export class HealthController {
  public constructor(private readonly health: HealthService) {}

  /** Serves unconditional process liveness. */
  @Get('live')
  @ApiOperation({
    operationId: 'healthLive',
    summary: 'Check process liveness',
    security: [],
  })
  @ApiOkResponse({
    type: LivenessResponseDto,
    description: 'The HTTP process is alive.',
  })
  @ApiProblemResponses('INTERNAL_ERROR')
  public live(
    @Res({ passthrough: true }) response: Response,
  ): LivenessResponseDto {
    return this.write(response, this.health.live())
  }

  /** Serves the irreversible startup latch. */
  @Get('startup')
  @ApiOperation({
    operationId: 'healthStartup',
    summary: 'Check the irreversible startup latch',
    security: [],
  })
  @ApiOkResponse({
    type: StartupResponseDto,
    description: 'Startup completed successfully.',
  })
  @ApiResponse({
    status: 503,
    type: StartupResponseDto,
    description: 'Startup is incomplete or has failed.',
  })
  @ApiProblemResponses('INTERNAL_ERROR')
  public startup(
    @Res({ passthrough: true }) response: Response,
  ): StartupResponseDto {
    return this.write(response, this.health.startup())
  }

  /** Serves bounded dependency readiness tied to transport cancellation. */
  @Get('ready')
  @ApiOperation({
    operationId: 'healthReady',
    summary: 'Check bounded dependency readiness',
    security: [],
  })
  @ApiOkResponse({
    type: ReadinessResponseDto,
    description: 'All required readiness indicators are available.',
  })
  @ApiResponse({
    status: 503,
    type: ReadinessResponseDto,
    description: 'One or more required indicators are unavailable or skipped.',
  })
  @ApiProblemResponses('INTERNAL_ERROR')
  public async ready(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReadinessResponseDto> {
    const parent = new AbortController()
    const abort = (): void => parent.abort()
    request.once('aborted', abort)
    response.once('close', abort)
    try {
      return this.write(response, await this.health.ready(parent.signal))
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
