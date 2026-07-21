import { Test } from '@nestjs/testing'

import type { ApiModule as ApiModuleClass } from '@/bootstrap/api/api.module'

describe('ApiModule composition', () => {
  it('compiles the configured runtime providers and health controller', async () => {
    Object.assign(process.env, {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_COORDINATION_URL: 'redis://127.0.0.1:6379',
      AUTH_SESSION_KEY_SECRET: Buffer.alloc(32, 1).toString('base64url'),
      AUTH_CSRF_SECRET: Buffer.alloc(32, 2).toString('base64url'),
      AUTH_RATE_LIMIT_KEY_SECRET: Buffer.alloc(32, 3).toString('base64url'),
      AUTH_NETWORK_METADATA_SECRET: Buffer.alloc(32, 4).toString('base64url'),
      AUTH_CSRF_ORIGINS: 'http://localhost:3000',
    })
    const apiModule =
      (await import('../../../src/bootstrap/api/api.module.js')) as {
        readonly ApiModule: typeof ApiModuleClass
      }
    const testingModule = await Test.createTestingModule({
      imports: [apiModule.ApiModule],
    }).compile()

    expect(testingModule).toBeDefined()

    await testingModule.close()
    for (const key of [
      'DATABASE_URL',
      'REDIS_COORDINATION_URL',
      'AUTH_SESSION_KEY_SECRET',
      'AUTH_CSRF_SECRET',
      'AUTH_RATE_LIMIT_KEY_SECRET',
      'AUTH_NETWORK_METADATA_SECRET',
      'AUTH_CSRF_ORIGINS',
    ]) {
      delete process.env[key]
    }
  })
})
