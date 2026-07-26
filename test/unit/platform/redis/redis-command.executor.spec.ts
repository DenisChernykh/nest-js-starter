import type { Span, Tracer } from '@opentelemetry/api'
import type { RedisManagedClient } from '@/platform/redis/redis-client.factory'
import {
  RedisCommandExecutor,
  RedisCommandTimeoutError,
} from '@/platform/redis/redis-command.executor'

/* eslint-disable @typescript-eslint/unbound-method */

function managedClient(): RedisManagedClient {
  return {
    isOpen: true,
    isReady: true,
    connect: jest.fn(() => Promise.resolve(undefined)),
    ping: jest.fn(() => Promise.resolve('PONG')),
    sendCommand: <T>() => Promise.resolve(undefined as T),
    close: jest.fn(() => Promise.resolve(undefined)),
    destroy: jest.fn(),
    duplicate: jest.fn(),
    onError: jest.fn(),
  }
}

describe('RedisCommandExecutor', () => {
  it('returns a successful operation without an active-operation lease', async () => {
    await expect(
      new RedisCommandExecutor(managedClient(), 50).execute('ping', (client) =>
        client.ping(),
      ),
    ).resolves.toBe('PONG')
  })
  it('destroys the socket when a command misses its absolute deadline', async () => {
    const client = managedClient()
    await expect(
      new RedisCommandExecutor(client, 5).execute(
        'blocked',
        () => new Promise<never>(() => undefined),
      ),
    ).rejects.toBeInstanceOf(RedisCommandTimeoutError)
    expect(client.destroy).toHaveBeenCalledTimes(1)
  })
  it('creates one fixed command span without the internal operation name', async () => {
    const span = { setStatus: jest.fn(), end: jest.fn() } as unknown as Span
    const tracer = {
      startActiveSpan: jest.fn(
        (_name: string, _options: unknown, work: (active: Span) => unknown) =>
          work(span),
      ),
    } as unknown as Tracer
    await expect(
      new RedisCommandExecutor(managedClient(), 50, tracer).execute(
        'session-owner-read-private-id',
        () => Promise.resolve('owned'),
      ),
    ).resolves.toBe('owned')
    expect(tracer.startActiveSpan).toHaveBeenCalledWith(
      'redis.command',
      expect.objectContaining({
        attributes: {
          'db.system.name': 'redis',
          'db.operation.name': 'OTHER',
          'db.query.text': 'OTHER',
        },
      }),
      expect.any(Function),
    )
    expect(
      JSON.stringify(jest.mocked(tracer.startActiveSpan).mock.calls),
    ).not.toContain('private-id')
  })
})
