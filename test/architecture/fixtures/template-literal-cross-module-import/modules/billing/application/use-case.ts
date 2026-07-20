export const loadOrderRepository = async (): Promise<unknown> =>
  import(`@/modules/orders/infrastructure/repository`)
