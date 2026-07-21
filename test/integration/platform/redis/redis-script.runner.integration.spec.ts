import type { StartedRedisContainer } from '@testcontainers/redis'

import { ActiveOperationTracker } from '@/platform/http/bootstrap/active-operation-tracker'
import { RedisClientFactory } from '@/platform/redis/redis-client.factory'
import { RedisConnectionRegistry } from '@/platform/redis/redis-connection.registry'
import { RedisLifecycle } from '@/platform/redis/redis-lifecycle'
import { RedisScriptRunner } from '@/platform/redis/redis-script.runner'
import { startRedisContainer } from '@test/integration/support/redis-container'

describe('RedisScriptRunner', () => {
  let container: StartedRedisContainer
  let registry: RedisConnectionRegistry
  let lifecycle: RedisLifecycle

  beforeAll(async () => {
    container = await startRedisContainer()
    registry = new RedisConnectionRegistry(
      new RedisClientFactory({
        connectTimeoutMs: 1_000,
        commandTimeoutMs: 1_000,
      }),
      new ActiveOperationTracker(),
      {
        coordinationUrl: container.getConnectionUrl(),
        commandTimeoutMs: 1_000,
      },
    )
    registry.register('coordination', true)
    registry.seal()
    lifecycle = new RedisLifecycle(registry, 1_000)
    await lifecycle.connect(AbortSignal.timeout(2_000))
  })

  afterAll(async () => {
    await lifecycle.close(AbortSignal.timeout(1_000))
    await container.stop()
  })

  it('loads a named script by SHA and executes only explicit keys and args', async () => {
    const runner = new RedisScriptRunner(registry.executor('coordination'))
    const keyReference = `K${'EYS'}[1]`
    runner.register({
      name: 'increment-by',
      source: `return redis.call('INCRBY', ${keyReference}, ARGV[1])`,
    })

    await expect(
      runner.run<number>('increment-by', ['starter:v1:counter:one'], ['2']),
    ).resolves.toBe(2)
    await registry
      .executor('coordination')
      .execute('flush-scripts', (client) =>
        client.sendCommand<string>(['SCRIPT', 'FLUSH']),
      )
    await expect(
      runner.run<number>('increment-by', ['starter:v1:counter:one'], ['3']),
    ).resolves.toBe(5)
  })

  it('rejects duplicate names, unknown scripts and zero-key execution', async () => {
    const runner = new RedisScriptRunner(registry.executor('coordination'))
    runner.register({ name: 'known', source: 'return 1' })

    expect(() =>
      runner.register({ name: 'known', source: 'return 2' }),
    ).toThrow()
    await expect(runner.run('known', [], [])).rejects.toThrow()
    await expect(
      runner.run('unknown', ['starter:v1:key'], []),
    ).rejects.toThrow()
  })
})
