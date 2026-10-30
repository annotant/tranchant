import { formatPrice } from './format'
import { subtotal } from './total'
import { useCart } from './useCart'

export function Cart() {
  const { items, status, remove } = useCart()

  if (status === 'loading') return <p className="cart__status">Loading your cart…</p>
  if (status === 'failed') {
    return (
      <p className="cart__status" role="alert">
        Your cart could not be loaded. Reload the page to try again.
      </p>
    )
  }

  return (
    <section className="cart" aria-labelledby="cart-title">
      <h1 id="cart-title">Your cart</h1>
      {items.length === 0 ? (
        <p className="cart__status">Your cart is empty.</p>
      ) : (
        <ul className="cart__items">
          {items.map((item) => (
            <li key={item.id} className="cart__item">
              <span>{`${item.name} × ${item.quantity}`}</span>
              <span>{formatPrice(item.unitCents * item.quantity)}</span>
              <button
                type="button"
                className="cart__remove"
                onClick={() => remove(item.id)}
                aria-label={`Remove ${item.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="cart__total">
        Total <strong>{formatPrice(subtotal(items))}</strong>
      </p>
    </section>
  )
}
