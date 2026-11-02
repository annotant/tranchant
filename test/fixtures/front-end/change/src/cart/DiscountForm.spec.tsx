import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { DiscountForm } from './DiscountForm'

const respond = (status: number, body: unknown) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }))

afterEach(() => vi.restoreAllMocks())

test('applies the code the user typed', async () => {
  respond(200, { code: 'SAVE10', percent: 10, expiresAt: '2027-01-01' })
  const onApply = vi.fn()
  render(<DiscountForm subtotal={2500} onApply={onApply} />)
  await userEvent.type(screen.getByRole('textbox'), 'SAVE10')
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
  await waitFor(() =>
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ code: 'SAVE10' })),
  )
  expect(screen.getByText('SAVE10')).toBeInTheDocument()
})

test('tells the user when the code is refused', async () => {
  respond(404, { error: 'unknown code' })
  render(<DiscountForm subtotal={2500} onApply={vi.fn()} />)
  await userEvent.type(screen.getByRole('textbox'), 'NOPE')
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
  await waitFor(() => expect(screen.queryByText(/refused/)).toBeDefined())
})
