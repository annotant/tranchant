import { useEffect, useState } from 'react'
import { request } from '../api/client'
import type { CartResponse } from '../api/types'
import type { CartItem, Discount } from './types'

type Status = 'loading' | 'ready' | 'failed'

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [discount, setDiscount] = useState<Discount | null>(null)

  useEffect(() => {
    let cancelled = false
    request<CartResponse>('/api/cart')
      .then((cart) => {
        if (cancelled) return
        setItems(cart.items)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('failed')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const remove = (id: string) => setItems((all) => all.filter((item) => item.id !== id))

  return { items, status, discount, remove, setDiscount }
}
