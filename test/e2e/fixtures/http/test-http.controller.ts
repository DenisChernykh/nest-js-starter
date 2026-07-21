import { Body, Controller, Get, Post, Req } from '@nestjs/common'
import type { Request } from 'express'

import { SafeEndpoint } from '@/platform/http/policy/safe-endpoint.decorator'

import { TestRequestDto } from './test-request.dto'

@Controller('technical')
export class TestHttpController {
  @Post('echo')
  public echo(@Body() body: TestRequestDto): TestRequestDto {
    return body
  }

  @Get('ip')
  @SafeEndpoint()
  public ip(@Req() request: Request): { readonly ip: string | undefined } {
    return { ip: request.ip }
  }
}
