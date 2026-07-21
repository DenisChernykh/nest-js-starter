import { Get } from '@nestjs/common'

class UnsafeController {
  @Get('unsafe')
  public read(): void {}
}

export const unsafeController = UnsafeController
