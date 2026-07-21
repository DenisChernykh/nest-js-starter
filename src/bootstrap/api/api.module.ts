import { Module } from '@nestjs/common'

import { RuntimeConfigModule } from '@/platform/config/runtime-config.module'
import { DatabaseModule } from '@/platform/database/database.module'
import { HealthModule } from '@/platform/http/health/health.module'
import { LifecycleModule } from '@/platform/lifecycle/lifecycle.module'

/**
 * Определяет composition root API process без прямых driver imports.
 */
@Module({
  imports: [RuntimeConfigModule, DatabaseModule, LifecycleModule, HealthModule],
})
export class ApiModule {}
