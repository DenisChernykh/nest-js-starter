import { Module } from '@nestjs/common'

import { LifecycleModule } from '@/platform/lifecycle/lifecycle.module'
import { ActiveOperationTracker } from '@/platform/http/bootstrap/active-operation-tracker'
import { ActiveRequestTracker } from '@/platform/http/bootstrap/active-request-tracker'
import { RequestOperationContext } from '@/platform/http/bootstrap/request-operation.context'

import { HealthController } from './health.controller'
import { HealthRegistry } from './health-registry'
import { HealthService } from './health.service'

/** Composes lifecycle-aware health registry, service and HTTP controller. */
@Module({
  imports: [LifecycleModule],
  controllers: [HealthController],
  providers: [
    HealthRegistry,
    HealthService,
    ActiveOperationTracker,
    ActiveRequestTracker,
    RequestOperationContext,
  ],
  exports: [
    LifecycleModule,
    HealthRegistry,
    HealthService,
    ActiveOperationTracker,
    ActiveRequestTracker,
    RequestOperationContext,
  ],
})
export class HealthModule {}
