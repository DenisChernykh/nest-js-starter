import type { OrdersApi } from '@/modules/orders'
export type BillingPolicy = (orders: OrdersApi) => void
