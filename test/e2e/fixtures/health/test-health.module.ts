import { Module } from '@nestjs/common'

import { HealthModule } from '@/platform/http/health/health.module'

@Module({ imports: [HealthModule] })
export class TestHealthModule {}
