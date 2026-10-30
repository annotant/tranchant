import { request } from '../api/client'
import type { Discount } from './types'

export async function applyDiscount(code: string, subtotal: number): Promise<Discount> {
  const data: any = await request('/api/discounts', {
    method: 'POST',
    body: JSON.stringify({ code, subtotal }),
  })
  return { code: data.code, percent: data.percentage }
}
