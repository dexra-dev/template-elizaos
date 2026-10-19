// The read-only checks come from the published @dexra-dev/plugin-elizaos; this pins its wiring.
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import type { Action, State } from '@elizaos/core'
import dexraPlugin from '@dexra-dev/plugin-elizaos'
import project, { character } from '../index.ts'
import { BONK, DEXRA, dexraResult, fakeRuntime, message, mockFetch, recorder } from './helpers.ts'

let restore: (() => void) | null = null
afterEach(() => {
  restore?.()
  restore = null
})

const runtime = fakeRuntime({ DEXRA_BASE_URL: `http://${DEXRA}`, DEXRA_API_KEY: 'dxr_test' })

function action(name: string): Action {
  const found = dexraPlugin.actions?.find((a) => a.name === name)
  assert.ok(found, `${name} exists`)
  return found
}

async function run(name: string, text: string) {
  const a = action(name)
  assert.equal(await a.validate(runtime, message(text)), true, `${name} accepts "${text}"`)
  const { sent, callback } = recorder()
  const result = await a.handler(runtime, message(text), {} as State, {}, callback)
  assert.ok(result)
  return { result, sent }
}

describe('read-only Dexra checks (@dexra-dev/plugin-elizaos)', () => {
  it('check_token: DEXRA_TOKEN_CHECK calls token_deep_check with the mint', async () => {
    const m = mockFetch({ [`GET ${DEXRA}/token_deep_check`]: dexraResult('caution', ['linked top holders']) })
    restore = m.restore
    const { result, sent } = await run('DEXRA_TOKEN_CHECK', `Is ${BONK} safe to buy?`)
    assert.equal(result.success, true)
    assert.equal(result.text, 'Verdict: caution. summary caution')
    assert.equal(sent[0]?.text, result.text)
    assert.equal(m.calls[0]?.url.searchParams.get('mint'), BONK)
  })

  it('preflight: DEXRA_SWAP_PREFLIGHT sends side and amount', async () => {
    const m = mockFetch({ [`GET ${DEXRA}/swap_preflight`]: dexraResult('ok') })
    restore = m.restore
    const { result } = await run('DEXRA_SWAP_PREFLIGHT', `preflight: buy 0.5 SOL of ${BONK}`)
    assert.equal(result.success, true)
    const q = m.calls[0]?.url.searchParams
    assert.equal(q?.get('side'), 'buy')
    assert.equal(q?.get('amount'), '0.5')
  })

  it('fresh_launches: DEXRA_NEW_LAUNCHES passes the window in minutes', async () => {
    const m = mockFetch({ [`GET ${DEXRA}/new_launches`]: { body: { result: { launches: [], summary: 'no launches' } } } })
    restore = m.restore
    const { result } = await run('DEXRA_NEW_LAUNCHES', 'show new launches from the last 15 minutes')
    assert.equal(result.success, true)
    assert.equal(m.calls[0]?.url.searchParams.get('minutes'), '15')
  })

  it('turns a 402 into a plain answer', async () => {
    restore = mockFetch({ [`GET ${DEXRA}/token_deep_check`]: { status: 402, body: { error: 'payment required' } } }).restore
    const { result } = await run('DEXRA_TOKEN_CHECK', `check ${BONK}`)
    assert.equal(result.success, false)
    assert.match(String(result.text), /needs an API key with credits/)
  })
})

describe('project wiring', () => {
  it('loads the Dexra plugins and the local trader', () => {
    assert.equal(character.name, 'Dexra Trader')
    assert.ok(character.plugins?.includes('@dexra-dev/plugin-elizaos'))
    assert.ok(character.plugins?.includes('@elizaos/plugin-sql'))
    const agent = project.agents[0]
    assert.ok(agent?.plugins?.some((p) => p.name === 'dexra-trader'))
  })

  it('tells the model to check first, never bypass, and flag dry runs', () => {
    const system = String(character.system)
    assert.match(system, /Before any buy, check the token/)
    assert.match(system, /Never try to get around a blocked trade/)
    assert.match(system, /dry run/)
    assert.match(system, /not financial advice/)
  })
})
