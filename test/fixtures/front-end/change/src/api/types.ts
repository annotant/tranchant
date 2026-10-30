import type { CartItem } from '../cart/types'

export type CartResponse = {
  items: CartItem[]
}

export type DiscountResponse = {
  code: string
  percent: number
  expiresAt: string
}
