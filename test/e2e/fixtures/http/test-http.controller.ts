import { Body, Controller, Get, Post, Req } from '@nestjs/common'
import type { Request } from 'express'

import { TestRequestDto } from './test-request.dto'

@Controller('technical')
export class TestHttpController {
  @Post('echo')
  public echo(@Body() body: TestRequestDto): TestRequestDto {
    return body
  }

  @Get('ip')
  public ip(@Req() request: Request): { readonly ip: string | undefined } {
    return { ip: request.ip }
  }
}
