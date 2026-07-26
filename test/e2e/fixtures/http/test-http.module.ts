import { Module } from '@nestjs/common'

import { HealthController } from '@/platform/http/health/health.controller'
import { HealthRegistry } from '@/platform/http/health/health-registry'
import { HealthService } from '@/platform/http/health/health.service'
import { LifecycleModule } from '@/platform/lifecycle/lifecycle.module'

import { TestHttpController } from './test-http.controller'

@Module({
  imports: [LifecycleModule],
  controllers: [TestHttpController, HealthController],
  providers: [
    HealthService,
    { provide: HealthRegistry, useFactory: () => new HealthRegistry([]) },
  ],
})
export class TestHttpModule {}
