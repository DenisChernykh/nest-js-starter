import type { Order } from '@/modules/orders/domain/order'
export type BillOrder = (order: Order) => void
