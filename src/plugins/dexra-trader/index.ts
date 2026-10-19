import type { Action, ActionResult, HandlerCallback, IAgentRuntime, Memory, Plugin, Provider } from '@elizaos/core'
import { buy, loadConfig, sell, type Config, type TradeResult } from '../../core/index.ts'
import { formatTrade } from './format.ts'
import { parseBuy, parseSell } from './parse.ts'

type Env = Record<string, string | undefined>

export interface TraderOptions {
  /** Where the core reads its settings; process.env by default. Keys never come from the character file. */
  env?: () => Env
}

function readConfig(env: () => Env): { config: Config | null; error: string | null } {
  try {
    return { config: loadConfig(env()), error: null }
  } catch (error) {
    return { config: null, error: error instanceof Error ? error.message : String(error) }
  }
}

async function reply(
  name: string,
  message: Memory,
  callback: HandlerCallback | undefined,
  text: string,
  success: boolean,
  data: Record<string, unknown> = {},
): Promise<ActionResult> {
  await callback?.({ text, actions: [name], source: message.content.source })
  return { success, text, data: { action: name, ...data } }
}

function tradeResult(name: string, message: Memory, callback: HandlerCallback | undefined, result: TradeResult, config: Config | null) {
  const text = formatTrade(result, config?.dryRunReason ?? null)
  return reply(name, message, callback, text, result.ok, {
    status: result.status,
    mode: result.mode,
    allowed: result.decision?.allowed ?? false,
    verdicts: result.decision?.verdicts ?? null,
    reasons: result.decision?.reasons ?? [],
    trade: result,
  })
}

function buyAction(env: () => Env): Action {
  return {
    name: 'DEXRA_BUY',
    similes: ['BUY_TOKEN', 'SWAP_SOL_FOR_TOKEN', 'APE'],
    description:
      'Buy a Solana token with SOL. Runs Dexra token_deep_check and swap_preflight first and refuses unless every verdict passes. Respects DRY_RUN and MAX_TRADE_SOL. Needs a token mint and an amount in SOL.',
    validate: async (_runtime: IAgentRuntime, message: Memory) => {
      const text = message.content.text ?? ''
      return /\bbuy\b/i.test(text) && parseBuy(text) !== null
    },
    handler: async (_runtime, message, _state, _options, callback) => {
      const request = parseBuy(message.content.text ?? '')
      if (!request) return reply('DEXRA_BUY', message, callback, 'Which token? Send its mint address.', false)
      if (request.amountSol === null) {
        return reply('DEXRA_BUY', message, callback, 'How much SOL should I spend? For example "buy 0.01 SOL of <mint>".', false)
      }
      const { config, error } = readConfig(env)
      if (!config) return reply('DEXRA_BUY', message, callback, `Buy not sent: ${error}`, false)
      const result = await buy(request.mint, request.amountSol, config)
      return tradeResult('DEXRA_BUY', message, callback, result, config)
    },
    examples: [
      [
        { name: '{{user}}', content: { text: 'Buy 0.01 SOL of DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' } },
        { name: '{{agent}}', content: { text: 'Checking it with Dexra before buying.', actions: ['DEXRA_BUY'] } },
      ],
    ],
  }
}

function sellAction(env: () => Env): Action {
  return {
    name: 'DEXRA_SELL',
    similes: ['SELL_TOKEN', 'EXIT_POSITION', 'SWAP_TOKEN_FOR_SOL'],
    description:
      'Sell a Solana token for SOL. The amount is in the token\'s smallest units. Dexra swap_preflight runs and its verdict is reported, but a sell is never blocked so a position can always exit. Respects DRY_RUN.',
    validate: async (_runtime: IAgentRuntime, message: Memory) => {
      const text = message.content.text ?? ''
      return /\bsell\b/i.test(text) && parseSell(text) !== null
    },
    handler: async (_runtime, message, _state, _options, callback) => {
      const request = parseSell(message.content.text ?? '')
      if (!request) return reply('DEXRA_SELL', message, callback, 'Which token? Send its mint address.', false)
      if (request.amountAtomic === null) {
        return reply(
          'DEXRA_SELL',
          message,
          callback,
          'How much should I sell, in the token\'s smallest units? For example "sell 1500000 of <mint>".',
          false,
        )
      }
      const { config, error } = readConfig(env)
      if (!config) return reply('DEXRA_SELL', message, callback, `Sell not sent: ${error}`, false)
      const result = await sell(request.mint, request.amountAtomic, config)
      return tradeResult('DEXRA_SELL', message, callback, result, config)
    },
    examples: [
      [
        { name: '{{user}}', content: { text: 'Sell 1500000 of DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' } },
        { name: '{{agent}}', content: { text: 'Running the sell preflight and selling.', actions: ['DEXRA_SELL'] } },
      ],
    ],
  }
}

function modeProvider(env: () => Env): Provider {
  return {
    name: 'DEXRA_TRADER_MODE',
    description: 'Whether trades are a dry run or live, and the safety caps',
    get: async () => {
      const { config, error } = readConfig(env)
      if (!config) return { text: `Trading is off: ${error}`, values: { tradingMode: 'error' } }
      const mode = config.live ? 'live (real transactions)' : `dry run (${config.dryRunReason})`
      return {
        text: [
          `# Dexra trading mode`,
          `Mode: ${mode}.`,
          `Max per buy: ${config.maxTradeSol} SOL. Slippage: ${config.slippageBps} bps. Caution verdicts ${config.allowCaution ? 'pass' : 'block'}.`,
          `Every buy runs Dexra checks first and is refused unless each verdict passes.`,
        ].join('\n'),
        values: { tradingMode: config.live ? 'live' : 'dry_run', maxTradeSol: config.maxTradeSol },
      }
    },
  }
}

export function createDexraTraderPlugin(options: TraderOptions = {}): Plugin {
  const env = options.env ?? (() => process.env)
  return {
    name: 'dexra-trader',
    description: 'Buy and sell Solana tokens through the Dexra-guarded trading core. Dry run by default.',
    actions: [buyAction(env), sellAction(env)],
    providers: [modeProvider(env)],
  }
}

export const dexraTraderPlugin = createDexraTraderPlugin()
export default dexraTraderPlugin
