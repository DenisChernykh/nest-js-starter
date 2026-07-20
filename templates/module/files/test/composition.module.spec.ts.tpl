import { Test } from '@nestjs/testing'

import { {{pascalCase}}Module } from '@/modules/{{kebabCase}}/composition/{{kebabCase}}.module'

describe('{{pascalCase}}Module composition', () => {
  it('compiles before the first real use case is added', async () => {
    const testingModule = await Test.createTestingModule({
      imports: [{{pascalCase}}Module],
    }).compile()

    expect(testingModule).toBeDefined()

    await testingModule.close()
  })
})
