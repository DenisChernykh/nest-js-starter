import * as Nest from '@nestjs/common'

import { SafeEndpoint as Safe } from '@/platform/http/policy/safe-endpoint.decorator'

class SafeController {
  @Safe()
  @Nest.Head('safe')
  public read(): void {}
}

export const safeController = SafeController
