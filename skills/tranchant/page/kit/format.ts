// Numbers and times as both pages word them.

/** `2.90M`, `412k`, `950`. */
export function formatTokens(count: number) {
  if (count >= 999_500) {
    const millions = count / 1_000_000
    return `${millions.toFixed(millions >= 10 ? 1 : 2)}M`
  }
  return count >= 1000 ? `${Math.round(count / 1000)}k` : String(count)
}
