---
name: Market scanner gaps for 5-min BTC markets
description: Current scanner misses 5-min BTC markets — runs in demo mode, uses wrong API path, no series support
type: project
---

## Gaps identified 2026-03-24

### 1. Scanner runs in demo mode unless POLYMARKET_API_KEY is set
- `client.ts` line 49: `this.demoMode = !apiKey`
- In demo mode, only 20 synthetic DEMO_MARKETS are returned — none are 5-min BTC markets
- DB shows only 2 fake BTC markets (`btc-15min-up-001`, `btc-above-70k-eod`)

### 2. Gamma `/markets` endpoint misses recurring events
- `client.ts` `getActiveMarkets()` hits `GET /markets?active=true&archived=false&closed=false&offset=N&limit=100`
- The Gamma `/markets` endpoint returns individual binary markets but NOT the recurring 5-min series windows — those require querying via `/events` with a series filter
- No series_slug, tag, or recurrence filter is applied

### 3. No 5-min market discovery logic exists
- No code anywhere targets `series_slug=btc-up-or-down-5m` or constructs slug-by-timestamp queries
- The BTC 5-min scalper bot (added in commit ac4d617) presumably operates on demo data only

### 4. `normalizeGammaMarket()` maps Gamma `/markets` shape (not `/events` shape)
- Real 5-min data comes from Gamma `/events` which nests markets inside `event.markets[]`
- The normalizer expects flat market objects — it would need adaptation for the nested events shape

**Why:** The scanner was built for general market discovery, not for targeting high-frequency recurring series.

**How to apply:** To make the 5-min scalper work with real data, a dedicated `Btc5mWatcher` class is needed that: (1) computes the next window end timestamp, (2) fetches `GET /events?slug=btc-updown-5m-<ts>`, (3) extracts the nested market conditionId and token IDs, (4) subscribes to CLOB WebSocket for real-time price feed, (5) places orders via the CLOB SDK.
