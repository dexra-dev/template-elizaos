// Runs the agent's actions without an LLM, always as a dry run (DRY_RUN is forced to true).
// Usage: npm run dry-run -- [mint] [amountSol]
import type { Action, IAgentRuntime, Memory, State } from '@elizaos/core'
import dexraPlugin from '@dexra-dev/plugin-elizaos'
import { createDexraTraderPlugin } from '../src/plugins/dexra-trader/index.ts'

const mint = process.argv[2] ?? 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
const amount = process.argv[3] ?? '0.01'

const env: Record<string, string | undefined> = { ...process.env, DRY_RUN: 'true' }
const runtime = {
  getSetting: (key: string) => env[key]?.trim() || null,
} as unknown as IAgentRuntime
const trader = createDexraTraderPlugin({ env: () => env })
const actions = [...(dexraPlugin.actions ?? []), ...(trader.actions ?? [])]

async function run(name: string, text: string) {
  const action = actions.find((a) => a.name === name) as Action
  const memory = { content: { text, source: 'dry-run' } } as Memory
  const result = await action.handler(runtime, memory, {} as State, {})
  console.log(`\n=== ${name}: "${text}"`)
  console.log(result?.text ?? '(no text)')
  return result
}

console.log(`Dexra: ${env.DEXRA_BASE_URL ?? 'https://api.dexra.dev'}, Jupiter quote: ${env.JUPITER_API_KEY ? 'yes' : 'skipped (no JUPITER_API_KEY)'}`)
await run('DEXRA_TOKEN_CHECK', `check ${mint}`)
await run('DEXRA_SWAP_PREFLIGHT', `preflight buy ${amount} SOL of ${mint}`)
await run('DEXRA_NEW_LAUNCHES', 'new launches in the last 30 minutes')
const bought = await run('DEXRA_BUY', `buy ${amount} SOL of ${mint}`)
console.log('\nDEXRA_BUY data:', JSON.stringify(bought?.data?.trade, null, 2))
const trade = bought?.data?.trade as { mode?: string; signature?: string | null } | undefined
if (trade?.mode !== 'dry_run' || trade.signature !== null) {
  console.error('dry-run: expected a dry run with no signature')
  process.exit(1)
}
