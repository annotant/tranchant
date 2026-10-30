const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export const formatPrice = (cents: number) => dollars.format(cents / 100)
