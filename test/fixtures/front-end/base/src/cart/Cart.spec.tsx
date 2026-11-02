import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { Cart } from './Cart'

const cart = {
  items: [
    { id: 'mug', name: 'Mug', unitCents: 1200, quantity: 2 },
    { id: 'tee', name: 'Tee', unitCents: 2500, quantity: 1 },
  ],
}

const respond = (status: number, body: unknown) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }))

afterEach(() => vi.restoreAllMocks())

test('lists the items and their total', async () => {
  respond(200, cart)
  render(<Cart />)
  expect(await screen.findByText('Mug × 2')).toBeInTheDocument()
  expect(screen.getByText('$49.00')).toBeInTheDocument()
})

test('removes an item', async () => {
  respond(200, cart)
  render(<Cart />)
  await userEvent.click(await screen.findByRole('button', { name: 'Remove Mug' }))
  expect(screen.queryByText('Mug × 2')).not.toBeInTheDocument()
  expect(screen.getByText('$25.00')).toBeInTheDocument()
})

test('tells when the cart cannot be loaded', async () => {
  respond(500, {})
  render(<Cart />)
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded')
})
