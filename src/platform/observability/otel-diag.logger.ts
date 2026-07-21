import type { DiagLogger } from '@opentelemetry/api'

import type { StructuredLogger } from '@/platform/logging/logging.contracts'
import { sanitizeLogText } from '@/platform/logging/safe-error.serializer'

/** Bounded OpenTelemetry diagnostic adapter without exporter payload fields. */
export class OtelDiagLogger implements DiagLogger {
  public constructor(private readonly logger: StructuredLogger) {}

  public error(message: string): void {
    this.write('error', message)
  }

  public warn(message: string): void {
    this.write('warn', message)
  }

  public info(message: string): void {
    this.write('info', message)
  }

  public debug(message: string): void {
    this.write('debug', message)
  }

  public verbose(message: string): void {
    this.write('trace', message)
  }

  private write(
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error',
    message: string,
  ): void {
    try {
      this.logger.write({
        level,
        event: 'otel_diagnostic',
        module: 'OpenTelemetry',
        attributes: { message: sanitizeLogText(message) },
      })
    } catch {
      // Diagnostics must never recurse into or fail telemetry setup.
    }
  }
}
