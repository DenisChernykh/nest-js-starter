import { Global, Module, type DynamicModule } from '@nestjs/common'

import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { CorrelationFieldsProvider } from '@/platform/http/context/correlation-fields.provider'
import { RequestContext } from '@/platform/http/context/request-context'
import { HttpMetrics } from '@/platform/observability/http-metrics'

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
        RequestContext,
        CorrelationFieldsProvider,
        { provide: HttpMetrics, useFactory: () => new HttpMetrics() },
        {
          provide: PinoLogSink,
          inject: [RuntimeConfigService, CorrelationFieldsProvider],
          useFactory: (
            config: RuntimeConfigService,
            correlation: CorrelationFieldsProvider,
          ): PinoLogSink =>
            new PinoLogSink(config, {
              correlationFields: () => correlation.getFields(),
            }),
        },
        { provide: STRUCTURED_LOGGER, useExisting: PinoLogSink },
        NestLoggerAdapter,
      ],
      exports: [
        STRUCTURED_LOGGER,
        PinoLogSink,
        NestLoggerAdapter,
        RequestContext,
        CorrelationFieldsProvider,
        HttpMetrics,
      ],
    }
  }
}
