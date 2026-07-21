import { Module } from '@nestjs/common'

import { HealthModule } from '@/platform/http/health/health.module'

import { TestHttpController } from './test-http.controller'

@Module({ imports: [HealthModule], controllers: [TestHttpController] })
export class TestHttpModule {}
