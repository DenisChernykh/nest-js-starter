import type { OrderId } from '../domain/order-id'
export type ReadOrder = (id: OrderId) => Promise<unknown>
