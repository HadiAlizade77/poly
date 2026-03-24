---
name: Real Polymarket 5-min BTC market structure
description: Verified API shape, slug pattern, series ID, and correct discovery endpoint for BTC Up/Down 5-minute markets
type: project
---

## Verified as of 2026-03-24

### Series
- Series ID: 10684
- Series slug: `btc-up-or-down-5m`
- Series ticker: `btc-up-or-down-5m`
- 24h volume: ~$49M
- Recurrence: every 5 minutes, 24/7

### Individual Event (window) shape
- Event slug pattern: `btc-updown-5m-<unix_timestamp>` where timestamp is the window END time in seconds
  - Example: `btc-updown-5m-1774347000` = ends at Unix 1774347000 = 2026-03-24T10:15:00Z
- Event ticker: same as slug
- Event title: `"Bitcoin Up or Down - March 24, 6:10AM-6:15AM ET"`
- `startTime` / `eventStartTime`: beginning of the 5-min window (e.g. 6:10AM ET)
- `endDate`: end of the 5-min window (e.g. 6:15AM ET)
- `restricted: true` (geo-restricted for US)

### Nested market (CLOB market) shape
- Each event contains exactly one market in `markets[]` array
- `conditionId`: the EVM condition ID (hex, e.g. `0x62394eb868af8af3b2e9261dc1a00a2618e9426f9c1dde6fedc0bffa3e98affa`)
- `clobTokenIds`: JSON string array of two token IDs — index 0 = "Up", index 1 = "Down"
- `outcomes`: `'["Up", "Down"]'` (JSON string)
- `outcomePrices`: `'["0.005", "0.995"]'` — live prices, sum to 1
- `acceptingOrders: true` while window is open
- `eventStartTime`: ISO string for window open
- `negRisk: false`
- `orderPriceMinTickSize: 0.001`
- `orderMinSize: 5` (USDC)
- `feesEnabled: true`, `feeType: "crypto_fees"`, taker fee rate 0.25%
- `makerRebatesFeeShareBps: 10000` (full rebate to makers)

### Resolution
- Source: Chainlink BTC/USD data stream at https://data.chain.link/streams/btc-usd
- NOT spot market price
- Resolves "Up" if close >= open at start of window; "Down" otherwise
- `eventMetadata.priceToBeat`: the opening price recorded at window start

### Tags on events
- `crypto-prices` (id 1312, forceShow true)
- `recurring` (id 101757)
- `bitcoin` (id 235, forceShow true)
- `up-or-down` (id 102127, forceShow true)
- `5M` (id 102892)
- `crypto` (id 21)
- `hide-from-new` (id 102169)

### Correct API to find the current/next window
```
GET https://gamma-api.polymarket.com/events?slug=btc-updown-5m-<timestamp>
```
Or to list upcoming windows by series:
```
GET https://gamma-api.polymarket.com/events?series_slug=btc-up-or-down-5m&active=true&limit=5
```
Note: `series_slug` as a filter parameter did NOT work in testing (returned unrelated old events).
The reliable approach is to fetch by exact event slug, constructing the timestamp from the target window end time.

**Why:** The Gamma `/events` endpoint with `series_slug` filter returns the full historical corpus (old events), not just upcoming ones — pagination does not sort by recency without a working `order` param. The slug-by-timestamp approach is deterministic and avoids this.

**How to apply:** To find the NEXT active window: round current UTC time up to the next 5-min boundary, convert to Unix seconds, construct slug `btc-updown-5m-<ts>`, fetch from Gamma events endpoint. Alternatively poll `GET /events?slug=btc-updown-5m-<ts>` for each upcoming slot.
