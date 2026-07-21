import { Module } from '@nestjs/common'

import { LifecycleModule } from '@/platform/lifecycle/lifecycle.module'

import { HealthController } from './health.controller'
import { HealthRegistry } from './health-registry'
import { HealthService } from './health.service'

/** Composes lifecycle-aware health registry, service and HTTP controller. */
@Module({
  imports: [LifecycleModule],
  controllers: [HealthController],
  providers: [HealthRegistry, HealthService],
  exports: [LifecycleModule, HealthRegistry, HealthService],
})
export class HealthModule {}
