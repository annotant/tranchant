import type { CartItem } from './types'

export const subtotal = (items: CartItem[]) =>
  items.reduce((sum, item) => sum + item.unitCents * item.quantity, 0)
