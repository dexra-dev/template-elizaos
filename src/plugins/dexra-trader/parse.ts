const ADDRESS = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g
const SOL_MINT = 'So11111111111111111111111111111111111111112'

/** The token the user means: the first address that isn't wrapped SOL. */
export function findMint(text: string): string | null {
  const found = text.match(ADDRESS) ?? []
  return found.find((a) => a !== SOL_MINT) ?? null
}

function withoutAddresses(text: string): string {
  return text.replace(ADDRESS, ' ')
}

export interface BuyRequest {
  mint: string
  amountSol: number | null
}

/** "buy 0.01 SOL of <mint>": the SOL amount, or the first plain number. */
export function parseBuy(text: string): BuyRequest | null {
  const mint = findMint(text)
  if (!mint) return null
  const rest = withoutAddresses(text)
  const match = rest.match(/(\d+(?:\.\d+)?)\s*sol\b/i) ?? rest.match(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/)
  const amountSol = match?.[1] ? Number(match[1]) : null
  return { mint, amountSol }
}

export interface SellRequest {
  mint: string
  /** Smallest token units as a string, or null when the message has no whole number. */
  amountAtomic: string | null
}

/** "sell 1500000 of <mint>": the amount is in the token's smallest units. */
export function parseSell(text: string): SellRequest | null {
  const mint = findMint(text)
  if (!mint) return null
  const rest = withoutAddresses(text)
  const match = rest.match(/(?<![\w.])(\d[\d_,]*)(?![\w.])/)
  const amountAtomic = match?.[1] ? match[1].replace(/[_,]/g, '') : null
  return { mint, amountAtomic }
}
