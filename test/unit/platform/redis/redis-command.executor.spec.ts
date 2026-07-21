import { ActiveOperationTracker } from '@/platform/http/bootstrap/active-operation-tracker'
import type { RedisManagedClient } from '@/platform/redis/redis-capability'
import {
  RedisCommandExecutor,
  RedisCommandTimeoutError,
} from '@/platform/redis/redis-command.executor'

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
  it('returns a successful operation and completes its active lease', async () => {
    const client = managedClient()
    const tracker = new ActiveOperationTracker()
    const executor = new RedisCommandExecutor(client, tracker, 50)

    await expect(
      executor.execute('ping', async (commandClient) => commandClient.ping()),
    ).resolves.toBe('PONG')
    expect(tracker.activeCount).toBe(0)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const destroy = jest.mocked(client.destroy)
    expect(destroy).not.toHaveBeenCalled()
  })

  it('destroys the socket when an already-started command misses its deadline', async () => {
    const client = managedClient()
    const tracker = new ActiveOperationTracker()
    const executor = new RedisCommandExecutor(client, tracker, 5)

    await expect(
      executor.execute('blocked', () => new Promise<never>(() => undefined)),
    ).rejects.toBeInstanceOf(RedisCommandTimeoutError)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const destroy = jest.mocked(client.destroy)
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(tracker.activeCount).toBe(0)
  })
})
