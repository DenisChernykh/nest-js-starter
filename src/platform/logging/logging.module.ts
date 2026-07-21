import { Global, Module, type DynamicModule } from '@nestjs/common'

import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { CorrelationFieldsProvider } from '@/platform/http/context/correlation-fields.provider'
import { RequestContext } from '@/platform/http/context/request-context'
import { HttpMetrics } from '@/platform/observability/http-metrics'
import { OtelTelemetryAdapter } from '@/platform/observability/otel-telemetry.adapter'
import { RuntimeMetrics } from '@/platform/observability/runtime-metrics'
import { TELEMETRY_PORT } from '@/shared/application/telemetry.port'

import { STRUCTURED_LOGGER } from './logging.contracts'
import { NestLoggerAdapter } from './nest-logger.adapter'
import { PinoLogSink } from './pino-log.sink'
import { AuthAuditLogger } from './auth-audit.logger'

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
        {
          provide: RuntimeMetrics,
          inject: [STRUCTURED_LOGGER],
          useFactory: (logger: PinoLogSink): RuntimeMetrics =>
            new RuntimeMetrics(undefined, (code) =>
              logger.write({
                level: 'warn',
                event: 'telemetry.adapter.failure',
                module: 'Observability',
                attributes: { code },
              }),
            ),
        },
        {
          provide: OtelTelemetryAdapter,
          inject: [RuntimeMetrics, STRUCTURED_LOGGER],
          useFactory: (
            metrics: RuntimeMetrics,
            logger: PinoLogSink,
          ): OtelTelemetryAdapter =>
            new OtelTelemetryAdapter(undefined, metrics, (code) =>
              logger.write({
                level: 'warn',
                event: 'telemetry.adapter.failure',
                module: 'Observability',
                attributes: { code },
              }),
            ),
        },
        { provide: TELEMETRY_PORT, useExisting: OtelTelemetryAdapter },
        {
          provide: AuthAuditLogger,
          inject: [STRUCTURED_LOGGER],
          useFactory: (logger: PinoLogSink): AuthAuditLogger =>
            new AuthAuditLogger(logger),
        },
        NestLoggerAdapter,
      ],
      exports: [
        STRUCTURED_LOGGER,
        PinoLogSink,
        NestLoggerAdapter,
        RequestContext,
        CorrelationFieldsProvider,
        HttpMetrics,
        RuntimeMetrics,
        TELEMETRY_PORT,
        AuthAuditLogger,
      ],
    }
  }
}
