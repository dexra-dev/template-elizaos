import type { Content, IAgentRuntime, Memory } from '@elizaos/core'

export const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
export const DEXRA = 'dexra.test'
export const JUP = 'api.jup.ag'

export interface Call {
  method: string
  url: URL
  headers: Record<string, string>
}

type Reply = { status?: number; body: unknown }
export type Routes = Record<string, Reply | ((call: Call) => Reply)>

/** Replaces globalThis.fetch with a router keyed by "METHOD host/path"; unknown routes fail the test. */
export function mockFetch(routes: Routes): { calls: Call[]; restore: () => void } {
  const original = globalThis.fetch
  const calls: Call[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = (init?.method ?? 'GET').toUpperCase()
    const raw = new Headers(init?.headers)
    const headers: Record<string, string> = {}
    raw.forEach((value, key) => (headers[key] = value))
    calls.push({ method, url, headers })
    const key = `${method} ${url.host}${url.pathname}`
    const route = routes[key]
    if (!route) throw new Error(`unexpected request ${key}`)
    const reply = typeof route === 'function' ? route({ method, url, headers }) : route
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return { calls, restore: () => void (globalThis.fetch = original) }
}

export function dexraResult(verdict: string, reasons: string[] = [], extra: Record<string, unknown> = {}): Reply {
  return { body: { result: { verdict, reasons, summary: `summary ${verdict}`, ...extra } } }
}

/** The core's settings for a test: local fake Dexra, dry run unless overridden. */
export function testEnv(extra: Record<string, string> = {}): () => Record<string, string> {
  return () => ({ DEXRA_BASE_URL: `http://${DEXRA}`, DEXRA_API_KEY: 'dxr_test', ...extra })
}

export function fakeRuntime(settings: Record<string, string> = {}): IAgentRuntime {
  return { getSetting: (key: string) => settings[key] ?? null } as unknown as IAgentRuntime
}

export function message(text: string): Memory {
  return { content: { text, source: 'test' } } as Memory
}

/** A callback that records what the action would post to the chat. */
export function recorder(): { sent: Content[]; callback: (c: Content) => Promise<Memory[]> } {
  const sent: Content[] = []
  return { sent, callback: async (c: Content) => (sent.push(c), []) }
}
