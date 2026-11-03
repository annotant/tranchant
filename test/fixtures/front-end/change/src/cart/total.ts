import type { CartItem, Discount } from './types'

export const subtotal = (items: CartItem[]) =>
  items.reduce((sum, item) => sum + item.unitCents * item.quantity, 0)

export const discountAmount = (subtotalCents: number, discount: Discount) =>
  Math.round((subtotalCents * discount.percent) / 100)

export const discounted = (subtotalCents: number, discount: Discount | null) =>
  discount ? subtotalCents - discountAmount(subtotalCents, discount) : subtotalCents
