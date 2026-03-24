---
name: BTC 5-Min Bot Architecture
description: How the BTC scalper bot is structured — API endpoints, process model, signal pipeline, WebSocket, and sandbox behavior
type: project
---

The BTC 5-min scalper bot spans three layers: a dedicated PM2 process, REST API endpoints, and a frontend page with polling.

## API endpoints

All under `/api/btc-bot/` — registered in `packages/backend/src/routes/index.ts`. No auth middleware is applied to the btc-bot router (unlike most routes). All three endpoints respond without a JWT token.

- `GET  /api/btc-bot/status` — returns `{ active, latest_signals, bot_status, stats, last_decision }`. Reads `BTC_5MIN_BOT_ACTIVE` from `system_config` (DB), latest signals from Redis key `btc-5min:latest-signals`, enriched cycle status from `btc-5min:status`, and trade stats by querying `positionHistory`/`order` tables filtered to markets with "bitcoin" + "5 min" in the title.
- `POST /api/btc-bot/start` — sets `BTC_5MIN_BOT_ACTIVE = true` in `system_config`. Does NOT spawn a process; the process is always running but only acts when the flag is true.
- `POST /api/btc-bot/stop`  — sets `BTC_5MIN_BOT_ACTIVE = false`. Same: the PM2 process keeps running but skips every cycle.

**Why:** The bot start/stop is a config flag, not a process lifecycle event. This avoids PM2 restarts and keeps the signal computation running even when trading is paused.

## Process model

The bot runs as `btc-5min-bot` — but this process is NOT in `ecosystem.config.js` as of the investigation (only `api-server`, `market-scanner`, `data-ingestion`, `decision-engine`, `execution-manager`, `scheduler` are listed). The entry point exists at `packages/backend/src/processes/btc-5min-bot.ts` and can be launched separately.

The `Btc5MinBot` class (`packages/backend/src/services/btc-5min/bot.ts`) runs on a `setInterval` (default 10 s). Each cycle:
1. Checks `BTC_5MIN_BOT_ACTIVE` in DB — skips if false
2. Computes signals from Binance 1-min candles in `external_data_points`; caches to Redis with 60 s TTL
3. Finds an active BTC 5-min market (end_date within next 10 min) from DB; refreshes prices from Polymarket CLOB
4. On new window: makes one AI call (OpenRouter) for directional bias, persists to `ai_decisions`
5. Runs state machine (flat / long_yes / long_no) based on `direction_score` vs thresholds scaled by `RISK_APPETITE`
6. Executes trades via `orderManager.placeOrder()` which respects `EXECUTION_MODE` env var
7. Caches full status blob to Redis `btc-5min:status` with 30 s TTL

## Sandbox / mock mode

Execution mode is controlled by `process.env.EXECUTION_MODE`. If `EXECUTION_MODE !== 'live'`, `OrderManager` uses mock fills (95% fill rate, ±0.5% slippage simulation, 200–800 ms simulated latency). Live execution path exists but falls back to mock with a warning. Sandbox mode (the `/api/sandbox/*` routes) is a separate system managing a virtual $1000 balance — not the same flag.

## Signal pipeline

`signals.ts` queries the last 30 rows of `external_data_points` (source=binance, data_type=kline_1m, symbol=btcusdt), computes RSI(14), momentum (1/3/5 min), volume ratio vs 20-candle avg, VWAP, and a composite `direction_score` (-100 to +100). The Binance feed is ingested by the `data-ingestion` PM2 process via `BinanceFeed` (WebSocket to `wss://stream.binance.com:9443/ws`).

## WebSocket

There is no dedicated BTC bot WebSocket channel. The bot's real-time data flows to the frontend via:
- `decision:new` — emitted when a new AI decision is persisted (via `emitDecisionNew`)
- `order:update` — emitted when orders fill
- `position:update` — emitted when positions open/close

The frontend `BtcBot.tsx` page does NOT use WebSocket for BTC bot data. It polls `/api/btc-bot/status` every 5 seconds via React Query (`refetchInterval: 5000, staleTime: 3000`).

## Frontend

- Page: `packages/frontend/src/pages/BtcBot.tsx`
- Hook: `packages/frontend/src/hooks/useBtcBot.ts`
- Start/stop via `useMutation` → `api.post('/api/btc-bot/start|stop')` → invalidates `btc-bot-status` query
- Renders: BTC price, direction score, momentum bars, RSI gauge, volume/VWAP, active market panel (from `bot_status.activeMarket`), last AI decision card

## Bankroll / sandbox integration (investigated 2026-03-24)

### How the bot reads balance
In `runCycle()` (step 11), the bot reads `bankrollService.get()` → uses `bankroll.active_balance` as `availableBalance`. This is the correct field — it represents cash not currently deployed in open positions. Sandbox start/reset writes this field directly.

### How mock trades affect bankroll
Flow for a filled mock order:
1. `orderManager.placeOrder()` — creates trade record only; does NOT touch bankroll directly.
2. `positionManager.openPosition()` → calls `adjustBankroll(size, 'deploy')`:
   - Increments `deployed_balance` by `size`
   - Decrements `active_balance` by `size`
   - `total_balance` unchanged
3. `positionManager.closePosition()` → calls `adjustBankroll(size, 'release', realizedPnl)`:
   - Decrements `deployed_balance` by `size`
   - Increments `active_balance` by `size + pnl`
   - Increments `total_balance` by `pnl`
   - Updates `balance_delta_today` and `balance_delta_total`

The bankroll IS correctly updated on open and close. There is no second path in `recordTradeOutcome()` being called by the bot — that function in `bankroll/balance-delta.ts` is only used by the daily-review scheduler, not the bot.

### Sandbox mode integration
`EXECUTION_MODE` (env var) and `SANDBOX_ACTIVE` (DB config) are two separate concepts that should be in sync but are managed independently:
- `EXECUTION_MODE` env var (read at module load in `order-manager.ts`, line 35): `const MOCK_MODE = process.env.EXECUTION_MODE !== 'live';`. This is evaluated ONCE at process startup, not per-cycle. Changing `EXECUTION_MODE` in the DB via sandbox start/stop has NO effect on a running process unless it is restarted.
- Sandbox start/stop sets `EXECUTION_MODE = "mock"` in `system_config` (DB), but `OrderManager` only reads `process.env.EXECUTION_MODE` — so the DB value is currently decorative for the running process.
- `SANDBOX_ACTIVE` (DB config) is read per-cycle by the bot (`systemConfigService.getValue<boolean>('SANDBOX_ACTIVE')`) to adjust thresholds (`isSandbox` flag) — this DOES respond to changes without a restart.

### Current balance state (as of 2026-03-24 ~10:13 UTC)
```
total_balance:    1000.000000   (unchanged from sandbox start)
active_balance:    994.677279   (5.32 deployed to one open position)
deployed_balance:    5.322721   (one live position open)
balance_delta_today: 0.000000   (no closed positions yet)
```
One order exists (`buy`, `filled`, size=5.322721, price=0.327).
One position exists (`long`, size=5.322721, entry=0.325636, pnl=0 unrealized).
The bankroll deduction happened correctly when the position was opened.

### Gap: EXECUTION_MODE is read from env at startup, not from DB per-cycle
If the process started before sandbox was activated (or with `EXECUTION_MODE=live` in the environment), mock mode will not apply even though the DB says `"mock"`. The bot's threshold logic (`isSandbox`) does dynamically read the DB, but execution routing does not.

**How to apply:** If a future task involves fixing sandbox/live mode switching without restarting the process, the fix is in `order-manager.ts` — `MOCK_MODE` needs to be determined per-call (reading from `systemConfigService` or checking `process.env`) rather than a module-level constant.

## Observed live responses (2026-03-24)

Status endpoint (bot was initially active):
```json
{ "active": true, "latest_signals": { "current_price": 71283.09, "trend": "flat", "direction_score": 13.93, "candle_count": 17 }, "bot_status": null, "stats": { "total_trades": 0, "wins": 0, "losses": 0, "pnl": 0 }, "last_decision": null }
```
- `bot_status` is `null` because the `btc-5min-bot` process is not running as a PM2 service (not in ecosystem.config.js), so nothing writes to `btc-5min:status` in Redis
- `stats` are all zeros because no BTC 5-min markets have been traded yet

**How to apply:** When debugging why `bot_status` is always null — the PM2 process for the bot (`btc-5min-bot`) is missing from ecosystem.config.js and needs to be added.
