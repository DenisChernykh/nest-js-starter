import { Writable } from 'node:stream'

import { PinoLogSink } from '@/platform/logging/pino-log.sink'

function createDestination(lines: string[]): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk))
      callback()
    },
  })
}

describe('PinoLogSink', () => {
  it('emits one correlated redacted JSON record with stable base fields', () => {
    const lines: string[] = []
    const sink = new PinoLogSink(
      {
        environment: 'test',
        logging: {
          level: 'trace',
          serviceName: 'nest-js-starter',
          serviceVersion: '0.1.0-alpha.0',
          serviceRevision: 'abc1234',
        },
      },
      {
        destination: createDestination(lines),
        now: () => new Date('2026-07-21T12:00:00.000Z'),
        correlationFields: () => ({
          requestId: '018f5f3b-6b76-7d40-a3b4-98bd3c301234',
          traceId: '0123456789abcdef0123456789abcdef',
          spanId: '0123456789abcdef',
        }),
      },
    )
    const error = Object.assign(new Error('secret=DO_NOT_LEAK'), {
      nested: [
        {
          authorization: 'Bearer NESTED_SECRET',
          password: 'NESTED_PASSWORD',
        },
      ],
    })

    sink.write({
      level: 'info',
      event: 'runtime_started',
      module: 'Bootstrap',
      attributes: {
        answer: 42,
        enabled: true,
        note: 'token=secret https://user:password@example.com/path',
        authorization: 'Bearer secret',
        cookie: 'session=secret',
        'set-cookie': 'session=secret',
        password: 'secret',
        token: 'secret',
        apiKey: 'secret',
        databaseUrl: 'postgresql://user:secret@database/app',
        redisUrl: 'redis://default:secret@redis/0',
        secret: 'secret',
      },
      error,
    })

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>
    expect(record).toEqual(
      expect.objectContaining({
        timestamp: '2026-07-21T12:00:00.000Z',
        level: 'info',
        service: 'nest-js-starter',
        version: '0.1.0-alpha.0',
        revision: 'abc1234',
        environment: 'test',
        event: 'runtime_started',
        module: 'Bootstrap',
        requestId: '018f5f3b-6b76-7d40-a3b4-98bd3c301234',
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: '0123456789abcdef',
        answer: 42,
        enabled: true,
        note: 'token=[redacted] [redacted-url]',
      }),
    )
    expect(record.error).toEqual(expect.objectContaining({ type: 'Error' }))
    for (const forbidden of [
      'pid',
      'hostname',
      'time',
      'authorization',
      'cookie',
      'set-cookie',
      'password',
      'token',
      'apiKey',
      'databaseUrl',
      'redisUrl',
      'secret',
      'msg',
    ]) {
      expect(record).not.toHaveProperty(forbidden)
    }
    expect(lines[0]).not.toContain('DO_NOT_LEAK')
    expect(lines[0]).not.toContain('NESTED_SECRET')
    expect(lines[0]).not.toContain('NESTED_PASSWORD')
    expect(lines[0]).not.toContain('user:password')
  })

  it.each([
    ['invalid level', { level: 'silent' }],
    ['invalid event', { event: 'not valid' }],
    ['invalid module', { module: 'not valid' }],
    ['non-finite number', { attributes: { durationMs: Number.NaN } }],
    ['nested attribute', { attributes: { payload: { token: 'secret' } } }],
    ['reserved attribute', { attributes: { level: 'fatal' } }],
  ])('rejects %s without writing a partial record', (_name, replacement) => {
    const lines: string[] = []
    const sink = new PinoLogSink(
      {
        environment: 'test',
        logging: {
          level: 'trace',
          serviceName: 'service',
          serviceVersion: '1.0.0',
          serviceRevision: 'test',
        },
      },
      { destination: createDestination(lines) },
    )

    expect(() =>
      sink.write({
        level: 'info',
        event: 'valid_event',
        module: 'ValidModule',
        ...replacement,
      } as never),
    ).toThrow('Invalid structured log record')
    expect(lines).toHaveLength(0)
  })
})
