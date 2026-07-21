import { NestLoggerAdapter } from '@/platform/logging/nest-logger.adapter'
import type {
  StructuredLogger,
  StructuredLogRecord,
} from '@/platform/logging/logging.contracts'

describe('NestLoggerAdapter', () => {
  it('maps Nest levels and context to finite structured records', () => {
    const records: StructuredLogRecord[] = []
    const sink: StructuredLogger = {
      write: (record) => records.push(record),
    }
    const logger = new NestLoggerAdapter(sink)

    logger.log('ready', 'NestFactory')
    logger.warn('token=secret https://user:password@example.com/path', 'Auth')
    logger.debug?.({ password: 'DO_NOT_LEAK' }, 'Auth')
    logger.verbose?.('details', 'Runtime')
    logger.fatal('fatal condition', 'Runtime')

    expect(
      records.map(({ level, event, module }) => ({ level, event, module })),
    ).toEqual([
      { level: 'info', event: 'nest_log', module: 'NestFactory' },
      { level: 'warn', event: 'nest_warn', module: 'Auth' },
      { level: 'debug', event: 'nest_debug', module: 'Auth' },
      { level: 'trace', event: 'nest_verbose', module: 'Runtime' },
      { level: 'fatal', event: 'nest_fatal', module: 'Runtime' },
    ])
    expect(records[1]?.attributes).toEqual({
      message: 'token=[redacted] [redacted-url]',
    })
    expect(records[2]?.attributes).toEqual({ messageType: 'Object' })
    expect(JSON.stringify(records)).not.toContain('DO_NOT_LEAK')
    expect(JSON.stringify(records)).not.toContain('user:password')
  })

  it('passes Error identity only through the dedicated safe serializer field', () => {
    const records: StructuredLogRecord[] = []
    const sink: StructuredLogger = {
      write: (record) => records.push(record),
    }
    const logger = new NestLoggerAdapter(sink)
    const error = new Error('token=DO_NOT_LOG_RAW_MESSAGE')

    logger.error(error, error.stack, 'Database')

    expect(records).toEqual([
      {
        level: 'error',
        event: 'nest_error',
        module: 'Database',
        error,
      },
    ])
  })
})
