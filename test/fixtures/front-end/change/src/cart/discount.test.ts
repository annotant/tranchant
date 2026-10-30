import { afterEach, expect, test, vi } from 'vitest'
import { ApiError } from '../api/client'
import { applyDiscount } from './discount'

const respond = (status: number, body: unknown) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }))

afterEach(() => vi.restoreAllMocks())

test('posts the code and the subtotal', async () => {
  const fetch = respond(200, { code: 'SAVE10', percent: 10, expiresAt: '2027-01-01' })
  await applyDiscount('SAVE10', 2500)
  expect(fetch).toHaveBeenCalledWith(
    '/api/discounts',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ code: 'SAVE10', subtotal: 2500 }),
    }),
  )
})

test('rejects an unknown code', async () => {
  respond(404, { error: 'unknown code' })
  await expect(applyDiscount('NOPE', 2500)).rejects.toBeInstanceOf(ApiError)
})
