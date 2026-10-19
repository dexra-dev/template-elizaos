# Dexra Trader for elizaOS

An [elizaOS](https://docs.elizaos.ai) agent that gets a Dexra verdict (`ok`, `caution`, `avoid` or `unknown`) with reasons before it buys any Solana token, and only buys when the verdict passes. It checks tokens, swaps and fresh launches with [Dexra](https://dexra.dev/?utm_source=github&utm_medium=referral&utm_campaign=templates&utm_content=template-elizaos), then buys and sells through Jupiter. Every trade reply shows the guard's decision in plain words and says whether it was a dry run. It runs as a dry run until you switch live trading on.

## Safety

- **Dry run by default.** Nothing is sent unless `DRY_RUN=false`, `SOLANA_PRIVATE_KEY` and `JUPITER_API_KEY` are all set. If any one is missing, the agent stays in dry run and says why.
- **Caps.** `MAX_TRADE_SOL` (default `0.05`) is a hard limit per buy. A larger buy is refused, not reduced. `SLIPPAGE_BPS` defaults to `100` and can't go above `1000`.
- **What blocks a buy:**
  - an invalid mint or an amount of 0 or less, or above the cap;
  - a `token_deep_check` or `swap_preflight` verdict that isn't `ok` (`caution` passes only with `ALLOW_CAUTION=true`; `avoid` and `unknown` always block);
  - any Dexra failure: no key (402), rate limit (429), server or network error. The guard fails closed.
- **Sells are never blocked**, so you can always exit. The sell preflight verdict is still reported.
- Buys and sells only go through the guarded core in `src/core`. The character tells the model never to work around a blocked trade, and the optional MCP connection only adds read-only checks.
- Keys come only from the environment. The wallet key is never logged or shown to the model.
- Use a dedicated wallet that holds little SOL. The caps limit each trade, not the total.

Not financial advice. A Dexra `ok` means launches like it survived more often in our published report, not that the price will go up.

## Quick start

You need [Bun](https://bun.sh) 1.3+ (elizaOS runs on it) and Node 20.18+ for the tests.

1. Click **Use this template** on GitHub, or clone it:

   ```sh
   git clone https://github.com/dexra-dev/template-elizaos.git
   cd template-elizaos
   ```

2. Copy the settings and fill in a model key and your Dexra key:

   ```sh
   cp .env.example .env
   ```

   Get a Dexra key at [dexra.dev/app/keys](https://dexra.dev/app/keys?utm_source=github&utm_medium=referral&utm_campaign=templates&utm_content=template-elizaos). The free tier gives 100 credits a day. Dexra also offers pay-per-call over x402; this template uses an API key.

3. Install and run:

   ```sh
   bun install
   bun run start
   ```

   Open the elizaOS web UI at http://localhost:3000 and try "Buy 0.01 SOL of DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263".

To see the tool layer work without a model, run the actions directly. This always forces a dry run:

```sh
bun run dry-run                       # BONK, 0.01 SOL
bun run dry-run -- <mint> <amountSol>
```

### Model provider

The model comes from elizaOS's standard provider plugins. Each one loads only when its key is set (see `src/character.ts`).

- **OpenAI** (`@elizaos/plugin-openai`): set `OPENAI_API_KEY`. Optional `OPENAI_LARGE_MODEL`, `OPENAI_SMALL_MODEL`, `OPENAI_BASE_URL`. It also provides embeddings for the agent's memory.
- **Anthropic** (`@elizaos/plugin-anthropic`): set `ANTHROPIC_API_KEY`, `ANTHROPIC_LARGE_MODEL` and `ANTHROPIC_SMALL_MODEL`. When both keys are set, Anthropic handles text and OpenAI handles embeddings. With Anthropic alone the agent works, but logs that no embedding model is registered. Plugin version 1.5.12 always sends a `temperature`, and the newest Claude models reject that, so `.env.example` uses `claude-sonnet-4-6` and `claude-haiku-4-5`.

Other elizaOS provider plugins (OpenRouter, Ollama, Google) can be added to the `plugins` list in the same way.

## Configuration

| Variable | Default | Meaning |
| - | - | - |
| `OPENAI_API_KEY` | unset | Loads `@elizaos/plugin-openai`. |
| `OPENAI_LARGE_MODEL` / `OPENAI_SMALL_MODEL` | plugin defaults | OpenAI model overrides. |
| `ANTHROPIC_API_KEY` | unset | Loads `@elizaos/plugin-anthropic`. |
| `ANTHROPIC_LARGE_MODEL` / `ANTHROPIC_SMALL_MODEL` | plugin defaults | Claude model IDs. Set them; see above. |
| `DEXRA_API_KEY` | unset | `dxr_…` key. Without it, paid checks answer 402, so every buy is blocked. |
| `DEXRA_BASE_URL` | `https://api.dexra.dev` | Point it at a local API for testing. |
| `DEXRA_MCP` | `false` | `true` also connects Dexra's remote MCP server through `@elizaos/plugin-mcp`. |
| `DEXRA_MCP_URL` | `https://api.dexra.dev/mcp` | MCP endpoint (Streamable HTTP, `Authorization: Bearer $DEXRA_API_KEY`). |
| `JUPITER_API_KEY` | unset | Needed for live trading. In a dry run it adds a Jupiter quote. |
| `SOLANA_PRIVATE_KEY` | unset | Base58 64-byte secret key. Live trading only. |
| `DRY_RUN` | `true` | Only `false`/`0`/`no`/`off` turn it off. |
| `MAX_TRADE_SOL` | `0.05` | Hard cap per buy. |
| `SLIPPAGE_BPS` | `100` | Jupiter `slippageBps`, 0 to 1000. |
| `ALLOW_CAUTION` | `false` | When true, a `caution` verdict passes. |
| `SERVER_PORT` | `3000` | elizaOS server and web UI port. |

An invalid trading setting doesn't crash the agent. The trade action answers with the error and sends nothing.

With `DEXRA_MCP=true`, the MCP server config, including the Bearer header, lives in the character's settings. Don't expose the elizaOS server publicly without `ELIZA_SERVER_AUTH_TOKEN`.

## How the guard works

The agent has these actions:

| Action | From | Does |
| - | - | - |
| `DEXRA_TOKEN_CHECK` | `@dexra-dev/plugin-elizaos` | `token_deep_check`: real holders after merging linked wallets, authorities, Token-2022 extensions. |
| `DEXRA_SWAP_PREFLIGHT` | `@dexra-dev/plugin-elizaos` | `swap_preflight`: price impact, sandwich share, fees and hooks for a planned swap. |
| `DEXRA_NEW_LAUNCHES` | `@dexra-dev/plugin-elizaos` | `new_launches`: fresh launches, each with its own verdict. |
| `DEXRA_BUY` | local `dexra-trader` | Core `buy`: runs `token_deep_check` and `swap_preflight` in parallel, blocks unless both pass, then quotes and (only when live) executes through Jupiter. |
| `DEXRA_SELL` | local `dexra-trader` | Core `sell`: runs the sell preflight for the record and sells. The amount is in the token's smallest units. |

The published plugin also adds holder-change, wallet, pool and address checks. The `DEXRA_TRADER_MODE` provider tells the model the current mode and caps on every turn.

A buy reply looks like this:

```
Buy 0.01 SOL of DezX…B263: blocked by the Dexra guard.
Verdicts: token_deep_check caution, swap_preflight ok.
Reasons:
- token_deep_check verdict caution blocks the buy (set ALLOW_CAUTION=true to accept caution)
- token_deep_check: 2 top holders share funders and together hold 10.5%
Mode: dry run (DRY_RUN is not false). No transaction was sent.
```

The rules live in `src/core/guard.ts` (`decideBuy`, `decideSell`), and the live path is in `src/core/trade.ts`. The core is shared by all Dexra templates; see the [template docs](https://dexra.dev/docs/templates?utm_source=github&utm_medium=referral&utm_campaign=templates&utm_content=template-elizaos) for its full rules.

## Project layout

```
src/
  index.ts                  elizaOS project: one agent, plus the local trader plugin
  character.ts              "Dexra Trader": system prompt, style, plugin list, MCP option
  plugins/dexra-trader/     DEXRA_BUY, DEXRA_SELL and the DEXRA_TRADER_MODE provider
    index.ts                actions and provider on top of src/core
    parse.ts                reads mint and amount from the message
    format.ts               turns a trade result into the chat reply
  core/                     Dexra-guarded trading core (shared, do not edit lightly)
  __tests__/                action handlers with mocked fetch; no keys, no LLM
scripts/dry-run.ts          runs the actions without a model, always as a dry run
```

Checks: `bun run typecheck` and `bun run test`.

## Links

- [Dexra template docs](https://dexra.dev/docs/templates?utm_source=github&utm_medium=referral&utm_campaign=templates&utm_content=template-elizaos)
- [Dexra API keys](https://dexra.dev/app/keys?utm_source=github&utm_medium=referral&utm_campaign=templates&utm_content=template-elizaos)
- [How Dexra measures its verdicts](https://dexra.dev/accuracy?utm_source=github&utm_medium=referral&utm_campaign=templates&utm_content=template-elizaos)
- [`@dexra-dev/plugin-elizaos` on npm](https://www.npmjs.com/package/@dexra-dev/plugin-elizaos)
- [elizaOS docs](https://docs.elizaos.ai): [projects](https://docs.elizaos.ai/projects/overview), [character](https://docs.elizaos.ai/agents/character-interface), [plugin components](https://docs.elizaos.ai/plugins/components)
- [Jupiter Swap API](https://developers.jup.ag/docs/swap/order-and-execute)

## License

MIT. See [LICENSE](LICENSE).
