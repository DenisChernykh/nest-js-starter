import { Test } from '@nestjs/testing'

import type { ApiModule as ApiModuleClass } from '@/bootstrap/api/api.module'

describe('ApiModule composition', () => {
  it('compiles the configured runtime providers and health controller', async () => {
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test'
    const apiModule = (await import(
      '../../../src/bootstrap/api/api.module.js'
    )) as {
      readonly ApiModule: typeof ApiModuleClass
    }
    const testingModule = await Test.createTestingModule({
      imports: [apiModule.ApiModule],
    }).compile()

    expect(testingModule).toBeDefined()

    await testingModule.close()
    delete process.env['DATABASE_URL']
  })
})
