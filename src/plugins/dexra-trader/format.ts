import type { TradeResult } from '../../core/index.ts'

function short(mint: string): string {
  return mint.length > 12 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint
}

const STATUS: Record<TradeResult['status'], string> = {
  blocked: 'blocked by the Dexra guard',
  dry_run: 'allowed (dry run, nothing sent)',
  executed: 'executed',
  failed: 'failed',
  error: 'not sent (error)',
}

/** Plain words for the chat: what was asked, the guard decision, and whether anything was sent. */
export function formatTrade(result: TradeResult, dryRunReason: string | null): string {
  const amount =
    result.side === 'buy'
      ? `${result.input.amount ?? '?'} SOL of ${short(result.mint)}`
      : `${result.input.amountAtomic} units of ${short(result.mint)}`
  const lines = [`${result.side === 'buy' ? 'Buy' : 'Sell'} ${amount}: ${STATUS[result.status]}.`]

  const decision = result.decision
  if (decision) {
    const verdicts = [
      decision.verdicts.token ? `token_deep_check ${decision.verdicts.token}` : null,
      decision.verdicts.preflight ? `swap_preflight ${decision.verdicts.preflight}` : null,
    ].filter(Boolean)
    lines.push(`Verdicts: ${verdicts.length ? verdicts.join(', ') : 'none (no Dexra answer)'}.`)
    if (decision.reasons.length) {
      lines.push('Reasons:', ...decision.reasons.map((r) => `- ${r}`))
    }
  }

  if (result.quote) {
    lines.push(
      `Jupiter quote: ${result.quote.inAmount} in, about ${result.quote.outAmount} out (min ${result.quote.minOutAmount ?? '?'}), price impact ${result.quote.priceImpactPct ?? '?'}%.`,
    )
  }
  if (result.status === 'executed' && result.explorerUrl) lines.push(`Transaction: ${result.explorerUrl}`)
  if (result.status === 'failed' || result.status === 'error') lines.push(result.message)
  if (result.status === 'dry_run' && result.message.includes('quote failed')) lines.push(result.message)

  lines.push(
    result.mode === 'live'
      ? 'Mode: live. Real transactions are sent.'
      : `Mode: dry run${dryRunReason ? ` (${dryRunReason})` : ''}. No transaction was sent.`,
  )
  return lines.join('\n')
}
