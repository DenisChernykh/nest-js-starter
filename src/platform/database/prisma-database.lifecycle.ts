import { Injectable } from '@nestjs/common'

import type { DatabaseLifecycle } from './database.contracts'
import { PrismaClientProvider } from './prisma-client.provider'

/** Delegates the public lifecycle contract to the single database owner. */
@Injectable()
export class PrismaDatabaseLifecycle implements DatabaseLifecycle {
  public constructor(private readonly provider: PrismaClientProvider) {}

  public connect(signal: AbortSignal): Promise<void> {
    return this.provider.connect(signal)
  }

  public close(signal: AbortSignal): Promise<void> {
    return this.provider.close(signal)
  }
}
