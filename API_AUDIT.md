# API Audit — Response Shape vs Frontend Hook Expectations

**Date**: 2026-03-23
**Purpose**: Identify mismatches between actual API responses and what frontend hooks expect.

---

## Key Observations

### API Client Unwrapping (`packages/frontend/src/lib/api.ts`)
The `api.get()` client **automatically unwraps** `{ success, data }` envelopes. Hooks receive `data` directly, not the full wrapper. Pagination `meta` is **silently discarded** (not accessible to hooks).

### Prisma Decimal → String Serialization
Prisma `Decimal` fields are serialized as **strings** in JSON. The frontend types expect `number`. This is a systemic issue affecting multiple endpoints.

---

## Endpoint-by-Endpoint Audit

---

### `GET /api/health`

**HTTP Status**: 200
**Actual shape** (after unwrap):
```json
{
  "status": "ok",          // string
  "uptime": 11032.59,      // number
  "timestamp": "2026-03-23T14:05:55.318Z",  // string
  "environment": "development"  // string
}
```
**Paginated**: NO — single object
**Casing**: camelCase N/A — flat object
**Decimal-as-string**: NO

**Frontend expects** (`useHealth` → `HealthStatus`):
```ts
{ status: 'ok' | 'degraded' | 'down'; uptime: number; services?: Record<...>; timestamp: string; environment?: string }
```

**Mismatch?** NO
**Fix needed**: None

---

### `GET /api/markets`

**HTTP Status**: 200
**Actual shape** (after unwrap): `Market[]`
Sample item field types:
```
id:              string  ✓
polymarket_id:   string  ✓
slug:            string  ✓
title:           string  ✓
description:     null    ✓
category:        string  ✓
subcategory:     string  ✓
status:          string  ✓
resolution_source:    string  ✓
resolution_criteria:  string  ✓
outcomes:        array   ✓
current_prices:  object  ✓
volume_24h:      "38200"    ← STRING (Prisma Decimal) ✗
liquidity:       "16500"    ← STRING (Prisma Decimal) ✗
end_date:        string  ✓
resolved_outcome: null  ✓
tags:            array   ✓
metadata:        null    ✓
is_tradeable:    bool    ✓
exclusion_reason: null   ✓
first_seen_at:   string  ✓
updated_at:      string  ✓
```
**Paginated**: NO — raw array (no meta wrapper)
**Casing**: snake_case ✓
**Decimal-as-string**: YES — `volume_24h`, `liquidity`

**Frontend expects** (`useMarkets` → `Market[]`):
```ts
volume_24h: number | null
liquidity:  number | null
```

**Mismatch?** YES
**Fix needed**: Serialize `volume_24h` and `liquidity` as `parseFloat()` in the markets controller, or use a Prisma response transformer.

---

### `GET /api/markets?category=crypto`

Same shape as `/api/markets`. Same mismatch applies.

---

### `GET /api/markets/:id`

**HTTP Status**: 200
**Actual shape** (after unwrap): single `Market` object
Same field types as list endpoint.

**Mismatch?** YES — same `volume_24h` and `liquidity` Decimal-as-string issue.
**Fix needed**: Same as `/api/markets`

---

### `GET /api/scorers`

**HTTP Status**: 200
**Actual shape** (after unwrap): `ScorerConfig[]`
Sample item:
```json
{
  "id": "97b6ed19-...",
  "category": "crypto",
  "scorer_name": "exchange_divergence",
  "description": "...",
  "is_enabled": true,
  "parameters": { "ema_period": 9, ... },
  "created_at": "2026-03-23T12:00:07.591Z",
  "updated_at": "2026-03-23T12:00:07.591Z"
}
```
**Paginated**: NO — raw array
**Casing**: snake_case ✓
**Decimal-as-string**: NO (all numbers in `parameters` are native JSON numbers)

**Frontend expects** (`useScorerConfigs` → `ScorerConfig[]`):
```ts
{ id, category, scorer_name, description, is_enabled, parameters, created_at, updated_at }
```

**Mismatch?** NO
**Fix needed**: None

---

### `GET /api/scorers?category=crypto`

Same shape as `/api/scorers`. No mismatch.

---

### `GET /api/decisions`

**HTTP Status**: 200
**Actual shape** (after unwrap): `AIDecision[]`
Field types on actual response:
```
id:               string (integer string, e.g. "4")  ← Note: not UUID
market_id:        string (UUID)          ✓
category:         string                 ✓
timestamp:        string (ISO date)      ✓
cycle_number:     number                 ✓
dashboard_text:   string                 ✓
account_state:    object                 ✓
trade_feedback:   object                 ✓
action:           string                 ✓
direction:        null                   ✓
outcome_token:    null                   ✓
confidence:       "0.58"   ← STRING (Prisma Decimal) ✗
size_hint:        null                   ✓
estimated_edge:   "0.021"  ← STRING (Prisma Decimal) ✗
estimated_cost:   "0.004"  ← STRING (Prisma Decimal) ✗
fair_value:       "0.43"   ← STRING (Prisma Decimal) ✗
market_price:     "0.41"   ← STRING (Prisma Decimal) ✗
reasoning:        string                 ✓
regime_assessment: string                ✓
regime_confidence: "0.65"  ← STRING (Prisma Decimal) ✗
was_executed:     bool                   ✓
veto_reason:      null                   ✓
order_id:         null                   ✓
model_used:       string                 ✓
latency_ms:       number                 ✓
tokens_used:      number                 ✓
prompt_version:   string                 ✓
```
**Paginated**: NO — raw array
**Casing**: snake_case ✓
**Decimal-as-string**: YES — 6 fields: `confidence`, `estimated_edge`, `estimated_cost`, `fair_value`, `market_price`, `regime_confidence`

**Frontend expects** (`useDecisions` → `AIDecision[]`):
```ts
confidence:        number
estimated_edge:    number | null
estimated_cost:    number | null
fair_value:        number | null
market_price:      number | null
regime_confidence: number | null
```

**Mismatch?** YES
**Fix needed**: Serialize all Decimal fields as floats in decisions controller.

---

### `GET /api/decisions/stats`

**HTTP Status**: 200
**Actual shape** (after unwrap):
```json
{
  "total": 4,
  "tradeCount": 2,
  "holdCount": 2,
  "executedCount": 1,
  "vetoedCount": 1,
  "avgConfidence": 0.6325
}
```
**Paginated**: NO — single object
**Casing**: camelCase ✗
**Decimal-as-string**: NO (`avgConfidence` is native float)

**Frontend expects** (`useDecisionStats` → `DecisionStats`):
```ts
{
  total:           number
  trades:          number   ← API sends "tradeCount"
  holds:           number   ← API sends "holdCount"
  executed:        number   ← API sends "executedCount"
  vetoed:          number   ← API sends "vetoedCount"
  avg_confidence:  number | null  ← API sends "avgConfidence"
  avg_edge:        number | null  ← API sends NOTHING (field missing)
}
```

**Mismatch?** YES — CRITICAL
Field name mismatches:
| API field | Frontend expects |
|---|---|
| `tradeCount` | `trades` |
| `holdCount` | `holds` |
| `executedCount` | `executed` |
| `vetoedCount` | `vetoed` |
| `avgConfidence` | `avg_confidence` |
| *(missing)* | `avg_edge` |

**Fix needed**: Rename all fields in the decisions stats controller response to snake_case and add `avg_edge: null`.

---

### `GET /api/orders`

**HTTP Status**: 200
**Actual shape** (after unwrap): `[]` (empty array — no orders in seed data)
```json
{ "data": [], "meta": { "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 } }
```
After unwrap: `[]` — meta discarded
**Paginated**: YES (server-side), but meta silently discarded by api client
**Casing**: snake_case ✓ (inferred from DB schema)
**Decimal-as-string**: LIKELY (fields like `price`, `size`, `filled_size`, `avg_fill_price`, `fees_paid` are Prisma `Decimal` — cannot confirm with empty dataset)

**Frontend expects** (`useOrders` → `Order[]`):
```ts
{ price: number; size: number; filled_size: number; avg_fill_price: number | null; fees_paid: number; ... }
```

**Mismatch?** LIKELY YES when data exists — Decimal fields will serialize as strings
**Fix needed**: Serialize `price`, `size`, `filled_size`, `avg_fill_price`, `fees_paid` as floats in orders controller.

---

### `GET /api/positions`

**HTTP Status**: 200
**Actual shape** (after unwrap): `[]`
```json
{ "data": [], "meta": { "total": 0 } }
```
After unwrap: `[]`
**Paginated**: Partial (meta has only `total`, not `page`/`pageSize`)
**Decimal-as-string**: LIKELY for `size`, `avg_entry_price`, `current_price`, `unrealized_pnl`, `realized_pnl`, `total_fees`, `stop_loss_price`

**Frontend expects** (`usePositions` → `Position[]`):
```ts
{ size: number; avg_entry_price: number; current_price: number | null; unrealized_pnl: number | null; realized_pnl: number; total_fees: number; stop_loss_price: number | null; ... }
```

**Mismatch?** LIKELY YES when data exists
**Fix needed**: Serialize Decimal fields as floats in positions controller.

---

### `GET /api/risk/events`

**HTTP Status**: 200
**Actual shape** (after unwrap): `[]`
```json
{ "data": [], "meta": { "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 } }
```
After unwrap: `[]`
**Paginated**: YES (server-side), meta discarded
**Decimal-as-string**: None expected for risk events

**Frontend expects** (`useRiskEvents` → `RiskEvent[]`):
```ts
{ id, event_type, timestamp, severity, decision_id, market_id, details, message, auto_resolved, resolved_at }
```

**Mismatch?** NO (for empty state; field names match schema)
**Fix needed**: None expected

---

### `GET /api/risk/config`

**HTTP Status**: 200
**Actual shape** (after unwrap): **ARRAY** of scoped config rows:
```json
[
  {
    "id": "00000000-...-0001",
    "scope": "global",
    "scope_value": null,
    "parameters": {
      "max_spread": 0.05,
      "min_liquidity": 1000,
      "max_daily_loss": 100,
      "max_single_trade": 30,
      "max_position_size": 50,
      "kill_switch_enabled": false,
      "max_total_exposure": 500,
      "max_trades_per_hour": 20,
      "latency_threshold_ms": 3000,
      "max_position_size_pct": 0.05,
      "max_consecutive_losses": 5,
      "max_daily_drawdown_pct": 0.1,
      "max_total_exposure_pct": 0.5,
      "max_position_hold_hours": 72,
      "max_single_trade_risk_pct": 0.03,
      "max_ai_token_budget_per_hour": 200000,
      "min_scorer_data_freshness_seconds": 120,
      "cooldown_after_loss_streak_minutes": 30
    },
    "updated_at": "...",
    "updated_by": "system"
  },
  { "scope": "category", "scope_value": "crypto", "parameters": {...} },
  { "scope": "category", "scope_value": "politics", "parameters": {...} },
  { "scope": "category", "scope_value": "sports", "parameters": {...} }
]
```
**Paginated**: NO — raw array
**Casing**: snake_case ✓ (outer fields), nested `parameters` keys snake_case ✓
**Decimal-as-string**: NO (all parameters are native JSON numbers)

**Frontend expects** (`useRiskConfig` → `RiskConfig`):
```ts
// Single flat object — NOT an array
{
  kill_switch_enabled: boolean
  max_daily_loss: number
  max_position_size: number
  max_total_exposure: number
  max_single_trade: number
  max_consecutive_losses: number
  cooldown_after_loss_streak_minutes: number
  min_liquidity: number
  max_spread: number
  max_latency_ms: number       ← API has "latency_threshold_ms"
  max_data_age_seconds: number ← API has "min_scorer_data_freshness_seconds"
}
```

**Mismatch?** YES — CRITICAL
Issues:
1. API returns **array of 4 objects**, frontend expects **single flat object**
2. Risk params are nested under `parameters` key, frontend expects them flat at top level
3. Field name mismatches: `latency_threshold_ms` → `max_latency_ms`, `min_scorer_data_freshness_seconds` → `max_data_age_seconds`
4. `kill_switch_enabled` lives in `parameters` object, not top-level

**Fix needed**: Risk config controller must merge the global `parameters` object and expose it as a single flat object matching `RiskConfig` type, renaming `latency_threshold_ms` → `max_latency_ms` and `min_scorer_data_freshness_seconds` → `max_data_age_seconds`.

---

### `GET /api/risk/kill-switch`

**HTTP Status**: 200
**Actual shape** (after unwrap):
```json
{ "kill_switch_enabled": false }
```
**Paginated**: NO
**Casing**: snake_case ✓
**Decimal-as-string**: NO

**Frontend expects** (`useToggleKillSwitch` mutation only — no query hook for this):
The mutation response type `{ kill_switch_enabled: boolean }` matches.

**Mismatch?** NO
**Fix needed**: None

---

### `GET /api/bankroll`

**HTTP Status**: 200
**Actual shape** (after unwrap):
```
id:                  string   ✓
total_balance:       "1000"   ← STRING (Prisma Decimal) ✗
previous_balance:    "1000"   ← STRING (Prisma Decimal) ✗
reserved_balance:    "50"     ← STRING (Prisma Decimal) ✗
active_balance:      "950"    ← STRING (Prisma Decimal) ✗
deployed_balance:    "0"      ← STRING (Prisma Decimal) ✗
unrealized_pnl:      "0"      ← STRING (Prisma Decimal) ✗
balance_delta_today: "0"      ← STRING (Prisma Decimal) ✗
balance_delta_total: "0"      ← STRING (Prisma Decimal) ✗
initial_deposit:     "1000"   ← STRING (Prisma Decimal) ✗
updated_at:          string   ✓
```
**Paginated**: NO — single object
**Casing**: snake_case ✓
**Decimal-as-string**: YES — ALL balance/pnl fields (9 fields)

**Frontend expects** (`useBankroll` → `Bankroll`):
All balance fields typed as `number`.

**Mismatch?** YES
**Fix needed**: Parse all Decimal fields as `parseFloat()` in bankroll controller.

---

### `GET /api/bankroll/history`

**HTTP Status**: 200
**Actual shape** (after unwrap): `BankrollHistory[]` (meta discarded)
```
id:               "1"     ← string integer (not UUID)
date:             string  ✓
opening_balance:  "1000"  ← STRING (Prisma Decimal) ✗
closing_balance:  "1000"  ← STRING (Prisma Decimal) ✗
deposits:         "1000"  ← STRING (Prisma Decimal) ✗
withdrawals:      "0"     ← STRING (Prisma Decimal) ✗
trading_pnl:      "0"     ← STRING (Prisma Decimal) ✗
fees_total:       "0"     ← STRING (Prisma Decimal) ✗
trades_count:     0       ← number ✓
win_rate:         null    ✓
```
**Paginated**: YES (server-side), meta discarded
**Casing**: snake_case ✓
**Decimal-as-string**: YES — 6 fields

**Frontend expects** (`useBankrollHistory` → `BankrollHistory[]`):
All balance/pnl fields typed as `number`.

**Mismatch?** YES
**Fix needed**: Parse all Decimal fields as `parseFloat()` in bankroll/history controller.

---

### `GET /api/alerts`

**HTTP Status**: 200
**Actual shape** (after unwrap): `[]` (empty)
**Paginated**: YES (server-side), meta discarded
**Casing**: snake_case ✓
**Decimal-as-string**: NO expected

**Frontend expects** (`useAlerts` → `Alert[]`):
```ts
{ id, alert_type, severity, title, message, data, is_read, is_dismissed, created_at, read_at }
```

**Mismatch?** NO (for empty state; field names match schema)
**Fix needed**: None expected

---

### `GET /api/alerts/unread-count`

**HTTP Status**: 200
**Actual shape** (after unwrap):
```json
{ "count": 0 }
```
**Paginated**: NO
**Decimal-as-string**: NO

**Frontend expects** (`useUnreadAlertCount` → `{ count: number }`):
Exact match.

**Mismatch?** NO
**Fix needed**: None

---

### `GET /api/analytics/summary`

**HTTP Status**: 200
**Actual shape** (after unwrap):
```json
{
  "bankroll": {
    "totalBalance": "1000",         ← camelCase + STRING (Decimal)
    "unrealizedPnl": "0",           ← camelCase + STRING (Decimal)
    "balanceDeltaToday": "0",       ← camelCase + STRING (Decimal)
    "balanceDeltaTotal": "0"        ← camelCase + STRING (Decimal)
  },
  "positions": { "open": 0 },
  "orders": { "open": 0 },
  "alerts": { "unread": 0 },
  "trades": {
    "count24h": 0,
    "count7d": 0,
    "count30d": 0
  },
  "performance30d": {
    "closedPositions": 0,
    "winCount": 0,
    "lossCount": 0,
    "winRate": null,
    "decisions": 4,
    "decisionsExecuted": 1,
    "avgConfidence": 0.6325
  }
}
```
**Paginated**: NO
**Casing**: camelCase throughout ✗
**Decimal-as-string**: YES — bankroll sub-object values

**Frontend expects** (`useAnalyticsSummary` → `AnalyticsSummary`):
```ts
{
  total_trades:       number        ← not present (API has trades.count30d)
  winning_trades:     number        ← not present (API has performance30d.winCount)
  losing_trades:      number        ← not present (API has performance30d.lossCount)
  win_rate:           number | null ← not present at top level
  total_pnl:          number        ← not present
  avg_pnl_per_trade:  number | null ← not present
  best_trade_pnl:     number | null ← not present
  worst_trade_pnl:    number | null ← not present
  total_fees:         number        ← not present
  avg_hold_time_hours: number | null ← not present
  by_category:        Record<...>   ← not present
}
```

**Mismatch?** YES — CRITICAL
The API returns a completely different shape (nested dashboard summary) vs what the frontend expects (flat trade analytics). Almost no field names overlap.

**Fix needed**: The `/api/analytics/summary` controller must be rewritten to return the flat `AnalyticsSummary` shape the frontend expects, or the frontend type and hook must be updated to match the API's actual shape. Both the shape and casing need to change.

---

### `GET /api/system-config`

**HTTP Status**: 200
**Actual shape** (after unwrap): `SystemConfig[]`
```json
[
  {
    "id": "7c41272e-...",
    "key": "ai_dashboard_format",
    "value": { ... },
    "description": "Text dashboard configuration...",
    "updated_at": "2026-03-23T12:00:07.551Z"
  },
  ...
]
```
**Paginated**: NO — raw array
**Casing**: snake_case ✓
**Decimal-as-string**: NO

**Frontend expects** (`useSystemConfigs` → `SystemConfig[]`):
```ts
{ key: string; value: unknown; updated_at: string }
```
API returns extra `id` and `description` fields — these are ignored by TypeScript (structural typing).

**Mismatch?** NO
**Fix needed**: None

---

### `GET /api/audit-log`

**HTTP Status**: 200
**Actual shape** (after unwrap): `[]` (empty, with meta)
**No frontend hook** — this endpoint has no corresponding hook in `/hooks/`.

**Mismatch?** N/A
**Fix needed**: None

---

## Summary Table

| Endpoint | Status | Mismatch | Severity | Issue |
|---|---|---|---|---|
| `GET /api/health` | 200 | NO | — | — |
| `GET /api/markets` | 200 | YES | Medium | `volume_24h`, `liquidity` are Decimal strings |
| `GET /api/markets?category=...` | 200 | YES | Medium | Same as above |
| `GET /api/markets/:id` | 200 | YES | Medium | Same Decimal strings |
| `GET /api/scorers` | 200 | NO | — | — |
| `GET /api/scorers?category=...` | 200 | NO | — | — |
| `GET /api/decisions` | 200 | YES | High | 6 Decimal fields are strings: `confidence`, `estimated_edge`, `estimated_cost`, `fair_value`, `market_price`, `regime_confidence` |
| `GET /api/decisions/stats` | 200 | YES | **CRITICAL** | All field names wrong (camelCase vs snake_case), `avg_edge` missing |
| `GET /api/orders` | 200 | LIKELY | High | Decimal fields will be strings when data exists |
| `GET /api/positions` | 200 | LIKELY | High | Decimal fields will be strings when data exists |
| `GET /api/risk/events` | 200 | NO | — | — |
| `GET /api/risk/config` | 200 | YES | **CRITICAL** | Array of scoped rows vs single flat object; params nested; field name mismatches |
| `GET /api/risk/kill-switch` | 200 | NO | — | — |
| `GET /api/bankroll` | 200 | YES | High | ALL balance fields are Decimal strings (9 fields) |
| `GET /api/bankroll/history` | 200 | YES | High | 6 Decimal balance fields are strings |
| `GET /api/alerts` | 200 | NO | — | — |
| `GET /api/alerts/unread-count` | 200 | NO | — | — |
| `GET /api/analytics/summary` | 200 | YES | **CRITICAL** | Completely different shape; camelCase vs snake_case; missing all expected fields |
| `GET /api/system-config` | 200 | NO | — | — |
| `GET /api/audit-log` | 200 | N/A | — | No frontend hook |

---

## Issues by Category

### CRITICAL (shape/structure mismatch — frontend receives wrong type)

1. **`/api/decisions/stats`** — All 5 field names wrong, one missing:
   - `tradeCount` → must be `trades`
   - `holdCount` → must be `holds`
   - `executedCount` → must be `executed`
   - `vetoedCount` → must be `vetoed`
   - `avgConfidence` → must be `avg_confidence`
   - Add `avg_edge: null`

2. **`/api/risk/config`** — API returns array of 4 scope rows, frontend expects single flat object:
   - Must merge global `parameters` into flat top-level object
   - Rename `latency_threshold_ms` → `max_latency_ms`
   - Rename `min_scorer_data_freshness_seconds` → `max_data_age_seconds`
   - Hoist `kill_switch_enabled` from `parameters` to top level

3. **`/api/analytics/summary`** — Completely different shape (nested camelCase dashboard summary vs flat snake_case trade analytics):
   - Must return: `total_trades`, `winning_trades`, `losing_trades`, `win_rate`, `total_pnl`, `avg_pnl_per_trade`, `best_trade_pnl`, `worst_trade_pnl`, `total_fees`, `avg_hold_time_hours`, `by_category`

### HIGH (Prisma Decimal serialized as string)

4. **`/api/decisions`** — Fields `confidence`, `estimated_edge`, `estimated_cost`, `fair_value`, `market_price`, `regime_confidence` are strings, frontend expects numbers.

5. **`/api/bankroll`** — All balance fields are strings, frontend expects numbers.

6. **`/api/bankroll/history`** — Balance/pnl fields are strings, frontend expects numbers.

7. **`/api/markets`** / **`/api/markets/:id`** — `volume_24h` and `liquidity` are strings.

8. **`/api/orders`** — Decimal fields likely strings when data present (`price`, `size`, `filled_size`, `avg_fill_price`, `fees_paid`).

9. **`/api/positions`** — Decimal fields likely strings when data present (`size`, `avg_entry_price`, `current_price`, `unrealized_pnl`, `realized_pnl`, `total_fees`, `stop_loss_price`).
