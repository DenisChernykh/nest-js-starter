import { Global, Module, type DynamicModule } from '@nestjs/common'

import { RuntimeConfigService } from '@/platform/config/runtime-config.service'

import { STRUCTURED_LOGGER } from './logging.contracts'
import { NestLoggerAdapter } from './nest-logger.adapter'
import { PinoLogSink } from './pino-log.sink'

/** Global composition boundary for the direct Pino and Nest logger adapters. */
@Global()
@Module({})
export class LoggingModule {
  /** Returns providers backed by the already registered typed runtime config. */
  public static forRoot(): DynamicModule {
    return {
      module: LoggingModule,
      providers: [
        {
          provide: PinoLogSink,
          inject: [RuntimeConfigService],
          useFactory: (config: RuntimeConfigService): PinoLogSink =>
            new PinoLogSink(config),
        },
        { provide: STRUCTURED_LOGGER, useExisting: PinoLogSink },
        NestLoggerAdapter,
      ],
      exports: [STRUCTURED_LOGGER, PinoLogSink, NestLoggerAdapter],
    }
  }
}
