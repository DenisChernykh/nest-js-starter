import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { RuntimeConfigService } from './runtime-config.service'
import { validateRuntimeEnvironment } from './runtime-environment'

/**
 * Explicit Nest boundary for validated runtime configuration.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      expandVariables: false,
      validate: validateRuntimeEnvironment,
    }),
  ],
  providers: [RuntimeConfigService],
  exports: [RuntimeConfigService],
})
export class RuntimeConfigModule {}
