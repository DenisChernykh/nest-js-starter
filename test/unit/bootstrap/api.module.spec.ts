import { Test } from '@nestjs/testing'

import { ApiModule } from '@/bootstrap/api/api.module'

describe('ApiModule foundation shell', () => {
  it('compiles without runtime providers or controllers', async () => {
    const testingModule = await Test.createTestingModule({
      imports: [ApiModule],
    }).compile()

    expect(testingModule).toBeDefined()

    await testingModule.close()
  })
})
