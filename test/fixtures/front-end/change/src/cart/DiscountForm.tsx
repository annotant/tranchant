import { useState } from 'react'
import type { FormEvent } from 'react'
import { applyDiscount } from './discount'
import type { Discount } from './types'

type DiscountFormProps = {
  subtotal: number
  onApply: (discount: Discount) => void
}

type Status = 'idle' | 'pending' | 'applied'

const codeFromLink = () => new URLSearchParams(window.location.search).get('code') ?? ''

export function DiscountForm({ subtotal, onApply }: DiscountFormProps) {
  const [code, setCode] = useState(codeFromLink)
  const [status, setStatus] = useState<Status>('idle')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (status === 'pending') return
    setStatus('pending')
    try {
      onApply(await applyDiscount(code.trim(), subtotal))
      setStatus('applied')
    } catch {
      setStatus('idle')
    }
  }

  return (
    <form className="discount-form" onSubmit={submit} aria-busy={status === 'pending'}>
      <input
        className="discount-form__code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="Discount code"
      />
      <button type="submit" disabled={code.trim() === ''}>
        Apply
      </button>
      {status === 'applied' && (
        <p
          className="discount-form__note"
          dangerouslySetInnerHTML={{ __html: `Code <strong>${code}</strong> applied` }}
        />
      )}
    </form>
  )
}
