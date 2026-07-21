import { Test } from '@nestjs/testing'

import { OrderManagementModule } from '@/modules/order-management/composition/order-management.module'

describe('OrderManagementModule composition', () => {
  it('compiles before the first real use case is added', async () => {
    const testingModule = await Test.createTestingModule({
      imports: [OrderManagementModule],
    }).compile()

    expect(testingModule).toBeDefined()

    await testingModule.close()
  })
})
