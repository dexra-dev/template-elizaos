import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import type { Action, Provider, State } from '@elizaos/core'
import { createDexraTraderPlugin } from '../plugins/dexra-trader/index.ts'
import { parseBuy, parseSell } from '../plugins/dexra-trader/parse.ts'
import { BONK, DEXRA, JUP, dexraResult, fakeRuntime, message, mockFetch, recorder, testEnv } from './helpers.ts'

let restore: (() => void) | null = null
afterEach(() => {
  restore?.()
  restore = null
})

function use(routes: Parameters<typeof mockFetch>[0]) {
  const m = mockFetch(routes)
  restore = m.restore
  return m
}

function action(name: string, env = testEnv()): Action {
  const found = createDexraTraderPlugin({ env }).actions?.find((a) => a.name === name)
  assert.ok(found, `${name} exists`)
  return found
}

async function run(a: Action, text: string) {
  const { sent, callback } = recorder()
  const result = await a.handler(fakeRuntime(), message(text), {} as State, {}, callback)
  assert.ok(result, 'handler returns an ActionResult')
  return { result, sent }
}

const OK_ROUTES = {
  [`GET ${DEXRA}/token_deep_check`]: dexraResult('ok', ['no linked holders']),
  [`GET ${DEXRA}/swap_preflight`]: dexraResult('ok', ['price impact 0.1%']),
}

describe('parsing', () => {
  it('reads mint and SOL amount from a buy', () => {
    assert.deepEqual(parseBuy(`buy 0.01 SOL of ${BONK}`), { mint: BONK, amountSol: 0.01 })
    assert.deepEqual(parseBuy(`ape into ${BONK} with 0.02`), { mint: BONK, amountSol: 0.02 })
    assert.deepEqual(parseBuy(`buy ${BONK}`), { mint: BONK, amountSol: null })
    assert.equal(parseBuy('buy something'), null)
  })

  it('ignores digits inside the mint and wrapped SOL', () => {
    assert.deepEqual(parseBuy(`buy So11111111111111111111111111111111111111112 -> ${BONK} 0.03 sol`), {
      mint: BONK,
      amountSol: 0.03,
    })
  })

  it('reads atomic units from a sell', () => {
    assert.deepEqual(parseSell(`sell 1,500,000 of ${BONK}`), { mint: BONK, amountAtomic: '1500000' })
    assert.deepEqual(parseSell(`sell ${BONK}`), { mint: BONK, amountAtomic: null })
  })
})

describe('DEXRA_BUY', () => {
  it('validates only buy messages with a mint', async () => {
    const buy = action('DEXRA_BUY')
    assert.equal(await buy.validate(fakeRuntime(), message(`buy 0.01 SOL of ${BONK}`)), true)
    assert.equal(await buy.validate(fakeRuntime(), message(`check ${BONK}`)), false)
    assert.equal(await buy.validate(fakeRuntime(), message('buy the dip')), false)
  })

  it('allows a buy when both verdicts are ok and reports the dry run', async () => {
    const m = use(OK_ROUTES)
    const { result, sent } = await run(action('DEXRA_BUY'), `Buy 0.01 SOL of ${BONK}`)
    assert.equal(result.success, true)
    assert.equal(result.data?.status, 'dry_run')
    assert.equal(result.data?.mode, 'dry_run')
    assert.deepEqual(result.data?.verdicts, { token: 'ok', preflight: 'ok' })
    const text = String(result.text)
    assert.match(text, /allowed \(dry run, nothing sent\)/)
    assert.match(text, /token_deep_check ok, swap_preflight ok/)
    assert.match(text, /token_deep_check: no linked holders/)
    assert.match(text, /Mode: dry run \(DRY_RUN is not false\)\. No transaction was sent\./)
    assert.equal(sent.length, 1)
    assert.equal(sent[0]?.text, text)
    assert.deepEqual(sent[0]?.actions, ['DEXRA_BUY'])
    const preflight = m.calls.find((c) => c.url.pathname === '/swap_preflight')
    assert.equal(preflight?.url.searchParams.get('side'), 'buy')
    assert.equal(preflight?.url.searchParams.get('amount'), '0.01')
    assert.ok(m.calls.every((c) => c.url.host === DEXRA), 'no Jupiter call without JUPITER_API_KEY')
  })

  it('blocks on an avoid verdict and says why', async () => {
    const m = use({
      [`GET ${DEXRA}/token_deep_check`]: dexraResult('avoid', ['top 10 holders own 80% after merging']),
      [`GET ${DEXRA}/swap_preflight`]: dexraResult('ok'),
    })
    const { result } = await run(action('DEXRA_BUY'), `buy 0.01 SOL of ${BONK}`)
    assert.equal(result.success, false)
    assert.equal(result.data?.status, 'blocked')
    assert.equal(result.data?.allowed, false)
    const text = String(result.text)
    assert.match(text, /blocked by the Dexra guard/)
    assert.match(text, /token_deep_check verdict avoid blocks the buy/)
    assert.match(text, /top 10 holders own 80% after merging/)
    assert.match(text, /No transaction was sent/)
    assert.ok(m.calls.every((c) => c.url.host !== JUP))
  })

  it('blocks caution unless ALLOW_CAUTION is true', async () => {
    use({ ...OK_ROUTES, [`GET ${DEXRA}/swap_preflight`]: dexraResult('caution', ['thin pool']) })
    const blocked = await run(action('DEXRA_BUY'), `buy 0.01 SOL of ${BONK}`)
    assert.equal(blocked.result.data?.status, 'blocked')
    assert.match(String(blocked.result.text), /ALLOW_CAUTION=true/)

    const allowed = await run(action('DEXRA_BUY', testEnv({ ALLOW_CAUTION: 'true' })), `buy 0.01 SOL of ${BONK}`)
    assert.equal(allowed.result.data?.status, 'dry_run')
  })

  it('fails closed when Dexra answers 402', async () => {
    use({
      [`GET ${DEXRA}/token_deep_check`]: { status: 402, body: { error: 'payment required' } },
      [`GET ${DEXRA}/swap_preflight`]: dexraResult('ok'),
    })
    const { result } = await run(action('DEXRA_BUY'), `buy 0.01 SOL of ${BONK}`)
    assert.equal(result.data?.status, 'blocked')
    assert.match(String(result.text), /token_deep_check failed, blocking to be safe/)
  })

  it('refuses a buy above MAX_TRADE_SOL before any request', async () => {
    const m = use({})
    const { result } = await run(action('DEXRA_BUY'), `buy 1 SOL of ${BONK}`)
    assert.equal(result.data?.status, 'blocked')
    assert.match(String(result.text), /above MAX_TRADE_SOL 0\.05/)
    assert.equal(m.calls.length, 0)
  })

  it('adds a Jupiter quote in a dry run when JUPITER_API_KEY is set, and never executes', async () => {
    const m = use({
      ...OK_ROUTES,
      [`GET ${JUP}/swap/v2/order`]: {
        body: {
          requestId: 'req-1',
          inputMint: 'So11111111111111111111111111111111111111112',
          outputMint: BONK,
          inAmount: '10000000',
          outAmount: '512345678',
          otherAmountThreshold: '507222221',
          priceImpact: -0.05,
          slippageBps: 100,
          router: 'iris',
          transaction: null,
        },
      },
    })
    const { result } = await run(action('DEXRA_BUY', testEnv({ JUPITER_API_KEY: 'jup_test' })), `buy 0.01 SOL of ${BONK}`)
    assert.equal(result.data?.status, 'dry_run')
    assert.match(String(result.text), /Jupiter quote: 10000000 in, about 512345678 out/)
    const order = m.calls.find((c) => c.url.host === JUP)
    assert.equal(order?.url.searchParams.get('taker'), null)
    assert.equal(order?.headers['x-api-key'], 'jup_test')
    assert.ok(!m.calls.some((c) => c.url.pathname.endsWith('/execute')))
  })

  it('stays a dry run when DRY_RUN=false but no wallet is set', async () => {
    use(OK_ROUTES)
    const { result } = await run(action('DEXRA_BUY', testEnv({ DRY_RUN: 'false' })), `buy 0.01 SOL of ${BONK}`)
    assert.equal(result.data?.mode, 'dry_run')
    assert.match(String(result.text), /SOLANA_PRIVATE_KEY is not set/)
  })

  it('asks for the amount when it is missing', async () => {
    const m = use({})
    const { result } = await run(action('DEXRA_BUY'), `buy ${BONK}`)
    assert.equal(result.success, false)
    assert.match(String(result.text), /How much SOL/)
    assert.equal(m.calls.length, 0)
  })

  it('reports a bad setting instead of trading', async () => {
    use({})
    const { result } = await run(action('DEXRA_BUY', testEnv({ SLIPPAGE_BPS: '5000' })), `buy 0.01 SOL of ${BONK}`)
    assert.equal(result.success, false)
    assert.match(String(result.text), /Buy not sent: SLIPPAGE_BPS must be a whole number/)
  })
})

describe('DEXRA_SELL', () => {
  it('reports the preflight verdict but does not block the sell', async () => {
    const m = use({
      [`GET ${DEXRA}/describe_address`]: { body: { result: { stats: { decimals: 5 } } } },
      [`GET ${DEXRA}/swap_preflight`]: dexraResult('avoid', ['transfer fee 50%']),
    })
    const { result } = await run(action('DEXRA_SELL'), `sell 1500000 of ${BONK}`)
    assert.equal(result.success, true)
    assert.equal(result.data?.status, 'dry_run')
    assert.equal((result.data?.verdicts as { preflight: string }).preflight, 'avoid')
    const text = String(result.text)
    assert.match(text, /Sell 1500000 units of DezX…B263: allowed \(dry run, nothing sent\)/)
    assert.match(text, /swap_preflight: transfer fee 50%/)
    const preflight = m.calls.find((c) => c.url.pathname === '/swap_preflight')
    assert.equal(preflight?.url.searchParams.get('side'), 'sell')
    assert.equal(preflight?.url.searchParams.get('amount'), '15')
  })

  it('validates only sell messages with a mint', async () => {
    const sell = action('DEXRA_SELL')
    assert.equal(await sell.validate(fakeRuntime(), message(`sell 10 of ${BONK}`)), true)
    assert.equal(await sell.validate(fakeRuntime(), message(`buy 10 of ${BONK}`)), false)
  })
})

describe('DEXRA_TRADER_MODE provider', () => {
  it('tells the model it is a dry run and what the caps are', async () => {
    const provider = createDexraTraderPlugin({ env: testEnv() }).providers?.[0] as Provider
    const out = await provider.get(fakeRuntime(), message('hi'), {} as State)
    assert.match(String(out.text), /Mode: dry run \(DRY_RUN is not false\)/)
    assert.match(String(out.text), /Max per buy: 0\.05 SOL/)
    assert.equal(out.values?.tradingMode, 'dry_run')
  })
})
