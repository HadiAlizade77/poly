# Polymarket AI Trading Platform — Complete Build Plan (v2)

## Architecture Philosophy: "Scorers as Context, AI as Brain"

**What changed from v1 and why:**

v1 had separate strategy modules (CryptoLagArb, CryptoMomentum, PollDivergence, etc.) that each generated independent binary signals, with an AI orchestration layer choosing between them. This created a problem: most strategies are in a "no signal" state most of the time, so the AI orchestrator had nothing to work with. It also meant multiple AI calls per cycle (regime classification, strategy selection, trade approval) — adding latency and complexity.

v2 adopts a fundamentally different model inspired by the "Strategies as Context, AI as Brain" reference architecture. The old strategies become **Context Scorers** — they don't decide to trade or not trade. Instead, they continuously score the market across multiple dimensions, always producing information. The AI receives a complete **Market Context Dashboard** (formatted as human-readable text, not JSON) and makes a single unified decision per evaluation cycle: trade or hold, with full reasoning.

**Key architectural shifts:**
1. **Continuous scores replace binary signals** — every dimension always has something to say
2. **One AI call per decision** — not three separate calls (regime, strategy, approval)
3. **Text dashboards for AI** — LLMs reason better over formatted text than raw JSON
4. **Intra-session trade feedback** — AI sees its own recent results to self-correct
5. **No AI position review** — once entered, exits are mechanical (resolution, stop-loss, or manual). The AI does not second-guess open positions under P&L pressure.
6. **Balance-delta P&L** — actual account balance is the source of truth, not trade-level sums that miss fees/slippage
7. **Hard risk governor remains outside the AI** — the AI proposes, the governor vetoes. Non-negotiable.

---

## Table of Contents
1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Database Schema](#4-database-schema)
5. [Backend Services](#5-backend-services)
6. [Context Scorers — Category by Category](#6-context-scorers--category-by-category)
7. [AI Integration Layer](#7-ai-integration-layer)
8. [Frontend — Web Application](#8-frontend--web-application)
9. [WebSocket Real-Time Layer](#9-websocket-real-time-layer)
10. [Testing Strategy](#10-testing-strategy)
11. [Build Order & Phases](#11-build-order--phases)
12. [Deployment & 24/7 Operations](#12-deployment--247-operations)
13. [File & Folder Structure](#13-file--folder-structure)

---

## 1. System Overview

### What This Is
A full-stack web application that operates as an AI-driven trading platform across ALL Polymarket categories. It runs 24/7, monitors every active market, builds rich context dashboards per category, feeds them to an AI decision engine, and executes trades through a hard-governed execution layer. A rich web UI provides full monitoring, customization, and review.

### Core Principles
- **Scorers provide context, AI makes decisions** — no binary strategy signals, continuous information flow
- **Every parameter is configurable through the UI** — no hard-coded magic numbers
- **Every AI decision is logged with full reasoning** — dashboard input, output, and rationale
- **Every component is testable** — unit, integration, and end-to-end tests throughout
- **24/7 resilient** — auto-recovery, health checks, alerting, graceful degradation
- **Layered safety** — hard risk limits sit outside the AI and cannot be overridden
- **No AI position review** — entries are AI-decided, exits are mechanical

### System Actors
- **Operator** (you) — configures, monitors, overrides via web UI
- **Market Scanner** — continuously discovers and tracks all Polymarket markets
- **Data Ingestion** — external feeds (exchanges, polls, odds, news)
- **Context Scorers** — category-specific modules that produce continuous dimension scores
- **AI Decision Engine** — receives context dashboards, makes trade/hold decisions
- **Risk Governor** — hard limits enforced before every execution, non-AI
- **Execution Engine** — order placement, cancellation, position management on Polymarket
- **AI Reviewer** — background analysis of performance drift and strategy health (offline)

---

## 2. Architecture

### High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                      WEB APPLICATION (React)                      │
│  Dashboard | Markets | Scorers | Risk | AI Decisions | Analytics  │
└───────────────────────────┬──────────────────────────────────────┘
                            │ REST + WebSocket
┌───────────────────────────┴──────────────────────────────────────┐
│                       API GATEWAY (Express)                       │
│            Auth | Rate Limit | Request Routing                    │
└────────┬──────────┬───────────┬──────────┬──────────┬────────────┘
         │          │           │          │          │
    ┌────┴───┐ ┌────┴────┐ ┌───┴────┐ ┌───┴───┐ ┌───┴────┐
    │ Market │ │ Context │ │  Risk  │ │  AI   │ │Execution│
    │Scanner │ │ Scorer  │ │Governor│ │Decision│ │ Engine  │
    │        │ │ Engine  │ │        │ │Engine  │ │         │
    └────┬───┘ └────┬────┘ └───┬────┘ └───┬───┘ └────┬────┘
         │          │          │          │           │
    ┌────┴───┐      │          │     ┌────┴────┐     │
    │  Data  │      │          │     │ Claude  │     │
    │Ingestion│     │          │     │   API   │     │
    └────┬───┘      │          │     └─────────┘     │
         │          │          │                      │
    ┌────┴──────────┴──────────┴──────────────────────┴────────────┐
    │                    MESSAGE QUEUE (Redis)                       │
    │          Events | Scores | Decisions | Orders | Alerts        │
    └───────────────────────────┬───────────────────────────────────┘
                                │
    ┌───────────────────────────┴───────────────────────────────────┐
    │                      DATABASE (PostgreSQL)                     │
    │  Markets | Scores | Decisions | Trades | Config | Feedback    │
    └───────────────────────────────────────────────────────────────┘
```

### The Decision Pipeline (replaces v1's signal pipeline)

This is the core loop, run per category on a configurable cycle:

```
1. DATA LAYER
   Ingest all feeds → normalize → store
   
2. CONTEXT SCORING (deterministic, fast, always produces output)
   For each active market in this category:
   → Run category-specific scorers
   → Each scorer produces continuous dimensions (-100 to +100, or labeled)
   → Scores ALWAYS have values — no "no signal" state
   → Output: structured scores + raw data
   
3. DASHBOARD BUILDER (deterministic)
   → Assemble scores into human-readable text dashboard
   → Add: account state, open positions, risk budget
   → Add: intra-session trade feedback (recent results + pattern detection)
   → Add: market metadata (resolution criteria, time to expiry, liquidity)
   → Format as text, not JSON — LLMs reason better over readable text
   
4. AI DECISION (single Claude API call)
   → Input: system prompt + text dashboard
   → Output: structured JSON decision
   → One call replaces v1's three (regime + strategy + approval)
   → Includes: action, direction, confidence, size hint, reasoning
   
5. RISK GOVERNOR (deterministic, synchronous, non-AI)
   → 16 hard checks run AFTER AI decision, BEFORE execution
   → Can veto, reduce size, or block entirely
   → AI has no ability to override governor
   
6. EXECUTION (deterministic)
   → Place order with governed parameters
   → Monitor fill
   → Track position
   → NO AI review of open positions — exits are mechanical
   
7. FEEDBACK LOOP (async, background)
   → Log outcome
   → Update intra-session feedback for next cycle
   → AI Reviewer analyzes patterns offline (daily/weekly)
```

### Why One AI Call Instead of Three

v1 pipeline: Regime Classification (AI call #1) → Strategy Selection (AI call #2) → Trade Approval (AI call #3)

v2 pipeline: Full Context Dashboard → AI Decision (one call)

Benefits:
- **Lower latency**: one round-trip instead of three
- **Better reasoning**: AI sees everything at once, can synthesize across dimensions
- **No information loss**: regime, strategy preference, and trade approval are all in one reasoning chain
- **Cheaper**: ~1200 tokens instead of ~1900 tokens per cycle
- **Easier to debug**: one prompt, one response, one reasoning trace

The AI's output still contains regime assessment, strategy reasoning, and trade decision — but as one coherent thought, not three separate disconnected calls.

### Communication Patterns
- **Frontend ↔ Backend**: REST API for CRUD, WebSocket for real-time streaming
- **Service ↔ Service**: Redis pub/sub for events, direct function calls within monorepo
- **Backend → Polymarket**: REST API for orders, WebSocket for market data
- **Backend → External Data**: REST APIs, WebSocket for exchange data
- **Backend → Claude API**: REST API for AI decisions and reviews

### Process Architecture (Single Server, Multi-Process)
Managed by PM2:
- `api-server` — Express REST + WebSocket server
- `market-scanner` — continuous market monitoring loop
- `data-ingestion` — external data feed consumer
- `decision-engine` — context scoring + AI decision loop (replaces v1's `strategy-runner`)
- `execution-manager` — order lifecycle management
- `ai-reviewer` — periodic background AI analysis (offline)
- `scheduler` — cron-based tasks (cleanup, reports, snapshots)

Each process communicates through Redis pub/sub and shared PostgreSQL.

---

## 3. Technology Stack

### Backend
| Component | Technology | Reason |
|-----------|-----------|--------|
| Runtime | Node.js 20+ (TypeScript) | Async-friendly, good WebSocket support, single language with frontend |
| API Framework | Express.js | Mature, flexible, large middleware ecosystem |
| WebSocket | Socket.IO | Reliable real-time with auto-reconnect |
| Database | PostgreSQL 16 | Relational integrity, JSONB for flexible data, time-series capable |
| ORM | Prisma | Type-safe queries, migrations, schema management |
| Cache / Pub-Sub | Redis | Fast pub/sub between processes, caching, rate limiting |
| Queue | BullMQ (on Redis) | Reliable job queues for background tasks |
| Process Manager | PM2 | Auto-restart, log management, cluster mode |
| AI | Anthropic Claude API (claude-sonnet-4-20250514) | Reasoning, analysis, trade decisions |
| Scheduling | node-cron | Periodic tasks |
| Validation | Zod | Runtime type validation for all inputs |
| Logging | Winston + daily rotate | Structured logging with file rotation |
| HTTP Client | Axios | External API calls |
| Technical Analysis | technicalindicators (npm) | EMA, RSI, MACD, ATR, Bollinger for crypto scorers |

### Frontend
| Component | Technology | Reason |
|-----------|-----------|--------|
| Framework | React 18 + TypeScript | Component-based, strong ecosystem |
| Build Tool | Vite | Fast dev server, optimized builds |
| Styling | Tailwind CSS | Utility-first, rapid UI development |
| UI Components | shadcn/ui + Radix | Accessible, customizable component library |
| Charts | Recharts + Lightweight Charts (TradingView) | Financial charts + general data viz |
| State Management | Zustand | Lightweight, no boilerplate |
| Data Fetching | TanStack Query (React Query) | Caching, background refresh, optimistic updates |
| Forms | React Hook Form + Zod | Performant forms with validation |
| Tables | TanStack Table | Sortable, filterable, paginated tables |
| WebSocket | Socket.IO Client | Real-time data |
| Notifications | Sonner (toast) | Non-intrusive alerts |
| Routing | React Router v6 | Client-side routing |
| Date Handling | date-fns | Lightweight date utilities |
| Icons | Lucide React | Consistent iconography |

### Testing
| Layer | Technology |
|-------|-----------|
| Unit (Backend) | Vitest |
| Unit (Frontend) | Vitest + React Testing Library |
| Integration | Vitest + Supertest (API), Testcontainers (DB) |
| E2E | Playwright |
| Mocking | MSW (Mock Service Worker) for API mocks |
| Coverage | Vitest coverage (v8) |

### Infrastructure
| Component | Technology |
|-----------|-----------|
| Container | Docker + Docker Compose |
| Reverse Proxy | Nginx |
| SSL | Let's Encrypt / Certbot |
| Monitoring | Custom health endpoints + Prometheus metrics (optional) |
| Backup | pg_dump cron job |

---

## 4. Database Schema

### Tables

#### `markets`
Tracks every Polymarket market the system is aware of.
```
id                  UUID PRIMARY KEY
polymarket_id       TEXT UNIQUE NOT NULL        -- Polymarket's market ID
slug                TEXT                        -- URL slug
title               TEXT NOT NULL               -- Market question
description         TEXT                        -- Full description
category            ENUM('crypto','politics','sports','events','entertainment','other')
subcategory         TEXT                        -- e.g., 'btc_15min', 'us_presidential', 'nfl'
status              ENUM('active','closed','resolved','paused','excluded')
resolution_source   TEXT                        -- what oracle/source resolves it
resolution_criteria TEXT                        -- exact wording of resolution rules
outcomes            JSONB NOT NULL              -- [{name: "Yes", token_id: "..."}, ...]
current_prices      JSONB                       -- latest price snapshot per outcome
volume_24h          DECIMAL(20,4)
liquidity           DECIMAL(20,4)
end_date            TIMESTAMPTZ
resolved_outcome    TEXT                        -- which outcome won, if resolved
tags                TEXT[]                      -- searchable tags
metadata            JSONB                       -- any extra Polymarket data
is_tradeable        BOOLEAN DEFAULT true        -- operator can exclude
exclusion_reason    TEXT
first_seen_at       TIMESTAMPTZ DEFAULT NOW()
updated_at          TIMESTAMPTZ DEFAULT NOW()
```

#### `market_snapshots`
Time-series price/volume data per market for analytics and scorer input.
```
id                  BIGSERIAL PRIMARY KEY
market_id           UUID REFERENCES markets(id)
timestamp           TIMESTAMPTZ NOT NULL
prices              JSONB NOT NULL              -- {outcome: price} for each outcome
spread              DECIMAL(10,6)
volume_1h           DECIMAL(20,4)
liquidity           DECIMAL(20,4)
order_book_depth    JSONB                       -- top N bids/asks
metadata            JSONB

INDEX (market_id, timestamp DESC)
```

#### `external_data_points`
Stores ingested external data (exchange prices, polls, odds, news signals).
```
id                  BIGSERIAL PRIMARY KEY
source              TEXT NOT NULL               -- 'binance', 'fivethirtyeight', 'pinnacle', etc.
data_type           TEXT NOT NULL               -- 'price', 'poll', 'odds', 'news_signal', 'liquidation'
symbol              TEXT                        -- 'BTCUSDT', 'us_president_2026', etc.
timestamp           TIMESTAMPTZ NOT NULL
value               JSONB NOT NULL              -- flexible payload
metadata            JSONB

INDEX (source, data_type, timestamp DESC)
INDEX (symbol, timestamp DESC)
```

#### `context_scores` ← NEW (replaces v1 `signals` as the primary data)
Continuous dimension scores produced by context scorers every cycle.
```
id                  BIGSERIAL PRIMARY KEY
market_id           UUID REFERENCES markets(id)
category            TEXT NOT NULL
timestamp           TIMESTAMPTZ DEFAULT NOW()
scores              JSONB NOT NULL
-- Example crypto scores JSONB:
-- {
--   "exchange_divergence": { "value": 42, "label": "MODERATE_DIVERGENCE", "direction": "UP", "detail": "Binance +0.8% vs Polymarket implied" },
--   "momentum": { "value": 67, "label": "STRONG_BULL", "acceleration": "increasing" },
--   "mean_reversion": { "value": 23, "label": "LOW", "snap_direction": "DOWN" },
--   "volatility": { "value": 55, "label": "NORMAL", "atr_ratio": 1.1 },
--   "volume": { "value": 72, "label": "ABOVE_AVG", "session_ratio": 1.4 },
--   "liquidity_quality": { "value": 81, "label": "GOOD", "spread": 0.02, "depth": 5000 },
--   "exhaustion": { "value": 15, "label": "NONE", "liquidation_spike": false },
--   "time_pressure": { "value": 30, "label": "MODERATE", "minutes_to_resolution": 45 }
-- }
-- Example politics scores JSONB:
-- {
--   "poll_divergence": { "value": 58, "label": "MODERATE_MISPRICED", "direction": "UNDERPRICED_YES", "detail": "Polls imply 0.62, market at 0.55" },
--   "sentiment_shift": { "value": 35, "label": "MILD_POSITIVE", "news_count": 3 },
--   "historical_base_rate": { "value": 70, "label": "HIGH_BASE_RATE", "similar_events_pct": 0.72 },
--   "resolution_risk": { "value": 20, "label": "LOW", "ambiguity_notes": "Clear criteria" },
--   "crowd_bias": { "value": 45, "label": "MODERATE_RECENCY_BIAS" },
--   "time_to_resolution": { "value": 60, "label": "WEEKS_AWAY", "days": 21 },
--   "liquidity_quality": { "value": 90, "label": "EXCELLENT", "spread": 0.01 }
-- }
raw_indicators      JSONB                       -- all raw indicator values that produced scores
dashboard_text      TEXT                        -- the formatted text dashboard sent to AI

INDEX (market_id, timestamp DESC)
INDEX (category, timestamp DESC)
```

#### `scorer_configs`
Configuration for each scorer dimension, per category. All editable from UI.
```
id                  UUID PRIMARY KEY
category            TEXT NOT NULL
scorer_name         TEXT NOT NULL               -- 'exchange_divergence', 'poll_divergence', etc.
description         TEXT
is_enabled          BOOLEAN DEFAULT true
parameters          JSONB NOT NULL              -- tunable params with defaults
-- Example crypto exchange_divergence params:
-- {
--   "exchange_source": "binance",
--   "symbol": "BTCUSDT",
--   "comparison_window_seconds": 60,
--   "strong_divergence_threshold": 60,
--   "moderate_divergence_threshold": 30,
--   "ema_period": 9,
--   "weight_in_dashboard": 1.0
-- }
created_at          TIMESTAMPTZ DEFAULT NOW()
updated_at          TIMESTAMPTZ DEFAULT NOW()

UNIQUE (category, scorer_name)
```

#### `ai_decisions` ← RESTRUCTURED (now the primary decision record)
Every unified AI decision. This replaces v1's separate regime/strategy/approval decisions.
```
id                  BIGSERIAL PRIMARY KEY
market_id           UUID REFERENCES markets(id)
category            TEXT NOT NULL
timestamp           TIMESTAMPTZ DEFAULT NOW()
cycle_number        INTEGER                     -- sequential decision cycle for this market

-- The full context the AI received
dashboard_text      TEXT NOT NULL               -- human-readable context dashboard
account_state       JSONB NOT NULL              -- balance, positions, risk budget at decision time
trade_feedback      JSONB                       -- intra-session feedback summary

-- The AI's structured output
action              ENUM('trade','hold')
direction           TEXT                        -- 'buy_yes', 'buy_no', 'sell_yes', 'sell_no' (null if hold)
outcome_token       TEXT                        -- which outcome token (null if hold)
confidence          DECIMAL(5,4)                -- 0 to 1
size_hint           DECIMAL(5,4)                -- 0.1 to 1.0, AI's suggested sizing multiplier
estimated_edge      DECIMAL(8,6)                -- AI's estimate of edge
estimated_cost      DECIMAL(8,6)                -- estimated fees + slippage
fair_value          DECIMAL(8,6)                -- AI's fair probability estimate
market_price        DECIMAL(8,6)                -- current price at decision time
reasoning           TEXT NOT NULL               -- AI's full reasoning text

-- Regime assessment (embedded in single decision, not separate call)
regime_assessment    TEXT                        -- 'quiet', 'trending', 'panic', 'volatile', 'untradeable'
regime_confidence    DECIMAL(5,4)

-- Execution outcome
was_executed        BOOLEAN DEFAULT false
veto_reason         TEXT                        -- if risk governor blocked it
order_id            UUID                        -- if executed, link to order

-- AI call metadata
model_used          TEXT DEFAULT 'claude-sonnet-4-20250514'
latency_ms          INTEGER
tokens_used         INTEGER
prompt_version      TEXT                        -- hash of system prompt used

INDEX (market_id, timestamp DESC)
INDEX (category, timestamp DESC)
INDEX (action, timestamp DESC)
```

#### `trade_feedback` ← NEW (intra-session learning)
Rolling trade feedback fed back into AI context each cycle.
```
id                  BIGSERIAL PRIMARY KEY
category            TEXT NOT NULL
session_date        DATE NOT NULL               -- trading session date
timestamp           TIMESTAMPTZ DEFAULT NOW()
feedback_summary    JSONB NOT NULL
-- Example:
-- {
--   "trades_today": 5,
--   "wins": 3,
--   "losses": 2,
--   "net_pnl": -12.50,
--   "streak": "L1",                            -- current streak
--   "patterns_detected": [
--     "3 of 5 losses were long YES in crypto during low volume",
--     "Exhaustion signals have been unprofitable today"
--   ],
--   "directional_bias": "slight_long_bias",
--   "avg_confidence_on_wins": 0.72,
--   "avg_confidence_on_losses": 0.58,
--   "recent_trades": [
--     { "market": "BTC 15min UP", "direction": "buy_yes", "result": "win", "pnl": 8.20, "minutes_ago": 45 },
--     { "market": "BTC 15min DOWN", "direction": "buy_yes", "result": "loss", "pnl": -15.30, "minutes_ago": 22 }
--   ]
-- }
feedback_text       TEXT NOT NULL               -- human-readable text version for AI prompt

INDEX (category, session_date DESC)
```

#### `orders`
Every order placed on Polymarket.
```
id                  UUID PRIMARY KEY
decision_id         BIGINT REFERENCES ai_decisions(id)  -- link to AI decision (was signal_id in v1)
market_id           UUID REFERENCES markets(id)
polymarket_order_id TEXT                        -- Polymarket's order ID
side                ENUM('buy','sell')
outcome_token       TEXT
order_type          ENUM('limit','market')
price               DECIMAL(10,6)
size                DECIMAL(20,6)               -- in token units
filled_size         DECIMAL(20,6) DEFAULT 0
avg_fill_price      DECIMAL(10,6)
status              ENUM('pending','open','partial','filled','cancelled','failed','expired')
maker_or_taker      ENUM('maker','taker','mixed')
fees_paid           DECIMAL(20,6) DEFAULT 0
placement_latency_ms INTEGER
error_message       TEXT
created_at          TIMESTAMPTZ DEFAULT NOW()
updated_at          TIMESTAMPTZ DEFAULT NOW()
filled_at           TIMESTAMPTZ
cancelled_at        TIMESTAMPTZ
```

#### `trades`
Completed trades (from filled orders).
```
id                  UUID PRIMARY KEY
order_id            UUID REFERENCES orders(id)
market_id           UUID REFERENCES markets(id)
decision_id         BIGINT REFERENCES ai_decisions(id)
side                ENUM('buy','sell')
outcome_token       TEXT
size                DECIMAL(20,6)
entry_price         DECIMAL(10,6)
fees                DECIMAL(20,6)
net_cost            DECIMAL(20,6)
regime_at_entry     TEXT
confidence_at_entry DECIMAL(5,4)
edge_at_entry       DECIMAL(8,6)
executed_at         TIMESTAMPTZ DEFAULT NOW()
```

#### `positions`
Current open positions. Exits are MECHANICAL — no AI review.
```
id                  UUID PRIMARY KEY
market_id           UUID REFERENCES markets(id)
outcome_token       TEXT NOT NULL
side                ENUM('long','short')
size                DECIMAL(20,6)
avg_entry_price     DECIMAL(10,6)
current_price       DECIMAL(10,6)
unrealized_pnl      DECIMAL(20,6)
realized_pnl        DECIMAL(20,6) DEFAULT 0
total_fees          DECIMAL(20,6) DEFAULT 0
decision_id         BIGINT REFERENCES ai_decisions(id)
-- Exit rules set at entry, not modified by AI:
exit_strategy       ENUM('resolution_only','stop_loss','time_based','manual')
stop_loss_price     DECIMAL(10,6)               -- if stop_loss strategy
time_exit_at        TIMESTAMPTZ                  -- if time_based strategy
opened_at           TIMESTAMPTZ DEFAULT NOW()
updated_at          TIMESTAMPTZ DEFAULT NOW()

UNIQUE (market_id, outcome_token)
```

#### `position_history`
Closed positions for P&L tracking.
```
id                  UUID PRIMARY KEY
market_id           UUID REFERENCES markets(id)
outcome_token       TEXT
side                ENUM('long','short')
size                DECIMAL(20,6)
avg_entry_price     DECIMAL(10,6)
avg_exit_price      DECIMAL(10,6)
realized_pnl        DECIMAL(20,6)
total_fees          DECIMAL(20,6)
decision_id         BIGINT REFERENCES ai_decisions(id)
regime_at_entry     TEXT
regime_at_exit      TEXT
resolution_outcome  TEXT
opened_at           TIMESTAMPTZ
closed_at           TIMESTAMPTZ DEFAULT NOW()
close_reason        ENUM('resolution','stop_loss','time_exit','manual','risk_veto')
```

#### `ai_reviews`
Background AI review/coach outputs. Runs offline, not in decision path.
```
id                  BIGSERIAL PRIMARY KEY
review_type         ENUM('daily','weekly','strategy_audit','drift_detection','threshold_recommendation','anomaly_report','scorer_calibration')
timestamp           TIMESTAMPTZ DEFAULT NOW()
period_start        TIMESTAMPTZ
period_end          TIMESTAMPTZ
category            TEXT
findings            JSONB
recommendations     JSONB
reasoning           TEXT
was_applied         BOOLEAN DEFAULT false
applied_at          TIMESTAMPTZ
applied_by          TEXT                        -- 'operator' or 'auto'
```

#### `risk_events`
Every time the risk governor intervenes.
```
id                  BIGSERIAL PRIMARY KEY
event_type          ENUM('trade_vetoed','size_reduced','category_paused','global_stop','drawdown_limit','exposure_limit','liquidity_warning','latency_warning','anomaly_detected')
timestamp           TIMESTAMPTZ DEFAULT NOW()
severity            ENUM('info','warning','critical')
decision_id         BIGINT REFERENCES ai_decisions(id)
market_id           UUID REFERENCES markets(id)
details             JSONB NOT NULL
message             TEXT NOT NULL
auto_resolved       BOOLEAN DEFAULT false
resolved_at         TIMESTAMPTZ
```

#### `alerts`
```
id                  BIGSERIAL PRIMARY KEY
alert_type          ENUM('trade','risk','system','ai','performance','opportunity')
severity            ENUM('info','warning','error','critical')
title               TEXT NOT NULL
message             TEXT NOT NULL
data                JSONB
is_read             BOOLEAN DEFAULT false
is_dismissed        BOOLEAN DEFAULT false
created_at          TIMESTAMPTZ DEFAULT NOW()
read_at             TIMESTAMPTZ
```

#### `bankroll`
Tracks capital allocation. Uses balance-delta for P&L truth.
```
id                  UUID PRIMARY KEY
total_balance       DECIMAL(20,6)               -- source of truth for P&L (balance-delta method)
previous_balance    DECIMAL(20,6)               -- balance at start of session for delta calc
reserved_balance    DECIMAL(20,6)
active_balance      DECIMAL(20,6)
deployed_balance    DECIMAL(20,6)
unrealized_pnl      DECIMAL(20,6)
balance_delta_today DECIMAL(20,6)               -- actual P&L = current - start of day balance
balance_delta_total DECIMAL(20,6)               -- actual P&L = current - initial deposit
initial_deposit     DECIMAL(20,6)               -- reference point for all-time P&L
updated_at          TIMESTAMPTZ DEFAULT NOW()
```

#### `bankroll_history`
Daily bankroll snapshots.
```
id                  BIGSERIAL PRIMARY KEY
date                DATE NOT NULL UNIQUE
opening_balance     DECIMAL(20,6)               -- balance at start of day
closing_balance     DECIMAL(20,6)               -- balance at end of day
balance_delta       DECIMAL(20,6)               -- closing - opening (the REAL P&L)
deployed_balance    DECIMAL(20,6)
fees_paid           DECIMAL(20,6)
trade_count         INTEGER
win_count           INTEGER
loss_count          INTEGER
best_trade_pnl      DECIMAL(20,6)
worst_trade_pnl     DECIMAL(20,6)
```

#### `risk_config`
Global and per-category risk parameters (all editable from UI).
```
id                  UUID PRIMARY KEY
scope               ENUM('global','category','market')
scope_value         TEXT
parameters          JSONB NOT NULL
-- Same parameters as v1:
-- max_position_size_pct, max_daily_drawdown_pct, max_total_exposure_pct,
-- max_single_trade_risk_pct, max_consecutive_losses, max_trades_per_hour,
-- min_edge_multiple, min_liquidity, max_spread, cooldown_after_loss_seconds,
-- latency_threshold_ms, kill_switch_enabled
-- NEW in v2:
-- max_ai_token_budget_per_hour, min_scorer_data_freshness_seconds,
-- max_position_hold_hours (for time-based exits)
updated_at          TIMESTAMPTZ DEFAULT NOW()
updated_by          TEXT
```

#### `system_config`
General system settings.
```
id                  UUID PRIMARY KEY
key                 TEXT UNIQUE NOT NULL
value               JSONB NOT NULL
description         TEXT
updated_at          TIMESTAMPTZ DEFAULT NOW()
-- Keys include all v1 keys plus:
-- 'scorer_cycle_intervals' — per-category scoring cycle timing
-- 'ai_dashboard_format' — text template configuration
-- 'feedback_window_hours' — how far back intra-session feedback looks
-- 'exit_strategy_defaults' — default exit rules per category
```

#### `audit_log`
Tracks every configuration change.
```
id                  BIGSERIAL PRIMARY KEY
timestamp           TIMESTAMPTZ DEFAULT NOW()
actor               TEXT NOT NULL
action              TEXT NOT NULL
entity_type         TEXT NOT NULL
entity_id           TEXT
old_value           JSONB
new_value           JSONB
reason              TEXT
```

---

## 5. Backend Services

### 5.1 API Server (`api-server`)

The main Express.js server. Handles all REST endpoints and WebSocket connections.

#### Authentication
- JWT-based auth (single operator, structured for multi-user if needed)
- API key for programmatic access
- All routes protected except health check

#### REST API Endpoints

**System**
```
GET    /api/health                          -- health check (public)
GET    /api/system/status                   -- overall system status
GET    /api/system/config                   -- get all system config
PUT    /api/system/config/:key              -- update a config value
POST   /api/system/toggle                   -- master on/off
GET    /api/system/audit-log                -- paginated audit log
```

**Markets**
```
GET    /api/markets                         -- list markets (filterable, sortable, paginated)
GET    /api/markets/:id                     -- single market detail
GET    /api/markets/:id/snapshots           -- historical price/volume data
GET    /api/markets/:id/scores              -- historical context scores for this market
GET    /api/markets/:id/decisions           -- AI decisions for this market
PUT    /api/markets/:id                     -- update market settings
GET    /api/markets/categories              -- list categories with counts
GET    /api/markets/opportunities           -- markets where latest scores suggest edge
POST   /api/markets/:id/exclude             -- exclude a market
POST   /api/markets/:id/include             -- re-include a market
```

**Context Scorers** (replaces v1 Strategies endpoints)
```
GET    /api/scorers                         -- list all scorer configs by category
GET    /api/scorers/:category               -- scorers for a specific category
GET    /api/scorers/:category/:name         -- single scorer detail + config
PUT    /api/scorers/:category/:name         -- update scorer parameters
POST   /api/scorers/:category/:name/toggle  -- enable/disable a scorer
GET    /api/scorers/:category/performance   -- scorer accuracy metrics
GET    /api/scorers/live                    -- current scores across all categories
```

**AI Decisions** (replaces v1 Signals + AI Decisions endpoints)
```
GET    /api/decisions                       -- list all AI decisions (filterable, paginated)
GET    /api/decisions/:id                   -- single decision with full dashboard + reasoning
GET    /api/decisions/live                  -- currently active decisions
GET    /api/decisions/:id/dashboard         -- the exact text dashboard the AI saw
GET    /api/decisions/by-category/:cat      -- decisions for a category
GET    /api/decisions/by-market/:id         -- decisions for a market
```

**Orders & Trades**
```
GET    /api/orders                          -- list orders (filterable, paginated)
GET    /api/orders/:id                      -- order detail
POST   /api/orders/:id/cancel              -- manually cancel an order
GET    /api/trades                          -- list completed trades
GET    /api/trades/:id                      -- trade detail
GET    /api/trades/export                   -- CSV export
```

**Positions**
```
GET    /api/positions                       -- current open positions
GET    /api/positions/:id                   -- position detail with exit rules
POST   /api/positions/:id/close            -- manually close a position
GET    /api/positions/history               -- closed positions
```

**Risk**
```
GET    /api/risk/config                     -- all risk configs
PUT    /api/risk/config/:id                 -- update risk config
GET    /api/risk/events                     -- risk events log
GET    /api/risk/status                     -- current risk state
POST   /api/risk/kill-switch               -- trigger manual kill switch
POST   /api/risk/resume                    -- resume (requires confirmation)
```

**Bankroll**
```
GET    /api/bankroll                        -- current bankroll state (balance-delta P&L)
GET    /api/bankroll/history                -- daily snapshots
PUT    /api/bankroll                        -- update allocations
GET    /api/bankroll/pnl                    -- P&L summary (balance-delta method)
```

**AI Reviews** (offline reviewer)
```
GET    /api/ai/reviews                      -- AI review reports
GET    /api/ai/reviews/:id                  -- single review detail
POST   /api/ai/reviews/:id/apply           -- apply review recommendations
POST   /api/ai/reviews/:id/dismiss         -- dismiss review
GET    /api/ai/config                       -- AI model config (prompts, model, etc.)
PUT    /api/ai/config                       -- update AI config
POST   /api/ai/test-prompt                  -- test a prompt against sample data
```

**Trade Feedback**
```
GET    /api/feedback                        -- current intra-session feedback per category
GET    /api/feedback/history                -- historical feedback summaries
```

**Alerts**
```
GET    /api/alerts                          -- list alerts
PUT    /api/alerts/:id/read                 -- mark as read
PUT    /api/alerts/:id/dismiss              -- dismiss
POST   /api/alerts/read-all                 -- mark all read
GET    /api/alerts/unread-count             -- for badge
```

**Analytics / Performance**
```
GET    /api/analytics/overview              -- dashboard summary stats
GET    /api/analytics/pnl-chart             -- P&L over time (balance-delta)
GET    /api/analytics/by-category           -- performance breakdown by category
GET    /api/analytics/by-regime             -- performance by regime assessment
GET    /api/analytics/by-scorer             -- which scorer dimensions correlated with wins
GET    /api/analytics/win-rate              -- win rate over time
GET    /api/analytics/edge-decay            -- measured edge vs. time
GET    /api/analytics/fee-analysis          -- fees, fee impact on returns
GET    /api/analytics/best-worst            -- best and worst trades
GET    /api/analytics/confidence-calibration -- did confidence predict outcomes?
GET    /api/analytics/ai-accuracy           -- AI decision quality over time
GET    /api/analytics/feedback-impact       -- did intra-session feedback improve results?
```

**Backtesting**
```
POST   /api/backtest/run                    -- run a backtest
GET    /api/backtest/results                -- list past results
GET    /api/backtest/results/:id            -- single result detail
```

### 5.2 Market Scanner Service (`market-scanner`)

Same as v1 — continuously monitors all Polymarket markets.

**Loop (runs every 10–30 seconds, configurable)**:
1. Fetch active markets from Polymarket API
2. Upsert into `markets` table
3. Auto-classify new markets by category (keyword matching + AI fallback)
4. Snapshot prices, spreads, volume, depth into `market_snapshots`
5. Publish `market:update` events to Redis

**Tests**: Unit (classification, opportunity scoring), Integration (API fetch + DB upsert), Mock (fake API responses)

### 5.3 Data Ingestion Service (`data-ingestion`)

Same as v1 with one addition: **multi-timeframe bar building for crypto**.

**Feeds**:

| Feed | Source | Type | Used By |
|------|--------|------|---------|
| BTC/ETH/major crypto prices | Binance WebSocket | Real-time trades + klines | Crypto scorers |
| Liquidation data | Binance/Bybit | Real-time liquidations | Crypto exhaustion scorer |
| Polling data | RealClearPolitics, 538, scraping | Periodic (hourly) | Politics scorers |
| Sports odds | Odds API / Pinnacle | Periodic (15 min) | Sports scorers |
| News signals | News API + RSS feeds | Periodic (5 min) | Event scorers, sentiment |
| Social sentiment | Twitter/X API (if available) | Periodic (15 min) | All categories |

**NEW — Bar Builder for Crypto** (from reference architecture):
- Maintains rolling windows of completed bars:
  - Primary (5-min) — last 15 bars for pattern detection
  - Short (1-min) — last 15 bars for micro-structure
  - Long (hourly) — last 12 bars for big picture
- Last in-progress bar always dropped (partial volume is misleading)
- Dedup by completed bar timestamp
- Rebuilt from REST data each cycle as single source of truth (avoids WebSocket gaps)
- Stored in `external_data_points` with `data_type: 'bar'` and timeframe metadata

**NEW — Session-Aware Volume Normalization** (from reference architecture):
Volume varies dramatically by time of day. The data ingestion service computes session-aware volume ratios for crypto:

| Bucket | Hours (UTC) | Character |
|--------|-------------|-----------|
| US Open | 13:30–15:30 | Highest BTC volume |
| US Midday | 15:30–18:00 | Moderate |
| US Close | 18:00–21:00 | Declining |
| Asia Open | 00:00–03:00 | Second peak |
| Overnight | 03:00–09:00 | Lowest |
| Europe Open | 09:00–13:30 | Building |

Each bar's volume is compared to its time-of-day bucket average, not raw absolute volume. IQR-based outlier removal within each bucket prevents restart artifacts.

**Each feed module interface**:
```typescript
interface FeedModule {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onData(handler: (data: NormalizedDataPoint) => void): void;
  health(): FeedHealth;
  isEnabled(): boolean;
}
```

**Tests**: Unit (normalization, bar building, session-aware volume), Integration (WebSocket lifecycle), Mock (recorded data replay)

### 5.4 Decision Engine Service (`decision-engine`) ← REPLACES v1's `strategy-runner`

This is the core of the v2 architecture. It replaces v1's separate strategy modules with the unified scorer → dashboard → AI decision pipeline.

**Loop (per category, configurable intervals)**:
- Crypto: every 10–30 seconds (fast-moving)
- Politics: every 5–15 minutes (slow-moving)
- Sports: every 1–5 minutes (event-dependent)
- Events: every 5–15 minutes
- Entertainment: every 15–30 minutes

**Each cycle**:

**Step 1: Score**
Run all enabled scorers for this category against each active, tradeable market.
```typescript
interface ContextScorer {
  name: string;
  category: MarketCategory;
  score(context: ScorerInput): ScorerDimension;
  // MUST always return a value — no null, no "no signal"
  getRequiredData(): DataRequirement[];
  validateConfig(params: Record<string, any>): ValidationResult;
}

interface ScorerDimension {
  value: number;         // continuous, typically -100 to +100 or 0 to 100
  label: string;         // human-readable label (STRONG_BULL, MODERATE_DIVERGENCE, etc.)
  detail: string;        // one-line explanation
  metadata?: Record<string, any>;  // additional context-specific data
}
```

**Step 2: Build Dashboard**
Assemble all scores + context into a human-readable text dashboard.
```
═══════════════════════════════════════════════
MARKET: Will BTC be above $95,000 at 14:00 UTC?
Category: Crypto | Resolution: 14:00 UTC | Time left: 12 min
Current Price: YES 0.55 / NO 0.45 | Spread: 0.02 | Liquidity: $8,200
═══════════════════════════════════════════════

CONTEXT SCORES
─────────────────────────────────────────────
Exchange Divergence:  +42 MODERATE_DIVERGENCE (UP)
  Binance BTC at $95,180, up 0.8% in 5min. Polymarket implies ~$94,800.

Momentum:             +67 STRONG_BULL
  5-min return z-score: 2.1. Acceleration: increasing. Volume confirming.

Mean Reversion:       23 LOW
  Price 0.7 ATR above VWAP. Not extended enough for reversion signal.

Volatility:           55 NORMAL
  ATR at 1.1x 20-period average. No compression or expansion.

Volume:               72 ABOVE_AVG
  Session-adjusted ratio: 1.4x (compared to US Open bucket average).

Liquidity Quality:    81 GOOD
  Spread: 0.02. Depth at ±2 ticks: $5,200. Acceptable for $200 order.

Exhaustion:           15 NONE
  No liquidation spike. No tape slowdown pattern detected.

Time Pressure:        30 MODERATE
  12 minutes to resolution. Enough time for move to stick, but limited.

KEY LEVELS
  VWAP: $95,020  |  EMA 9: $95,150  |  EMA 21: $94,980
  Binance 24h High: $95,500  |  24h Low: $93,800

─────────────────────────────────────────────
ACCOUNT STATE
  Balance: $5,240.00  |  Deployed: $420.00 (8%)
  Available for this trade: $380.00
  Risk budget remaining: 4.2% of max 5% daily drawdown
  Open positions: 2 (1 crypto, 1 politics)

─────────────────────────────────────────────
INTRA-SESSION TRADE FEEDBACK
  Today's trades: 5 (3W / 2L)  |  Net P&L: -$12.50
  Streak: L1
  Pattern: Last 2 losses were both long YES on crypto during declining momentum.
  Avg confidence on wins: 0.72  |  Avg confidence on losses: 0.58
  Last trade: BTC DOWN 15min, buy_no, LOSS, -$15.30 (22 min ago)

─────────────────────────────────────────────
COST ESTIMATE
  Estimated taker fee: $1.72 (at current midpoint)
  Estimated slippage: $0.40
  All-in cost: ~$2.12
  Minimum edge needed (2x cost): $4.24
═══════════════════════════════════════════════
```

**Why text, not JSON**: LLMs reason better over formatted, labeled text. `"Exchange Divergence: +42 MODERATE_DIVERGENCE (UP)"` is more interpretable than `{"exchange_divergence": {"value": 42, "label": "MODERATE_DIVERGENCE"}}`. The reference architecture validated this in production.

**Step 3: AI Decision** (single Claude API call)
Send the text dashboard with system prompt. Receive structured JSON:
```json
{
  "action": "trade",
  "direction": "buy_yes",
  "confidence": 0.72,
  "size_hint": 0.7,
  "estimated_edge": 0.04,
  "regime": "trending",
  "regime_confidence": 0.8,
  "exit_strategy": "resolution_only",
  "reasoning": "Strong exchange divergence with momentum confirmation. Binance has moved +0.8% while Polymarket YES is still at 0.55, implying the market hasn't caught up. Volume is confirming (1.4x session average). Not extended on mean reversion. However, noting the recent L1 streak and last crypto loss — confidence is tempered. The 12-minute window is adequate for this move to price in. Edge of ~0.04 comfortably exceeds 2x cost threshold. Recommend trade with moderate size."
}
```

**Step 4: Risk Governor** (synchronous, deterministic)
Same 16 checks as v1 — runs after AI decision, before execution. Cannot be overridden.

**Step 5: Execute** (if approved)
Size, place, monitor. See Execution Engine below.

**Step 6: Update Feedback**
Record outcome into `trade_feedback` for next cycle's dashboard.

**Tests**:
- Unit: each scorer with fixed inputs → expected continuous output
- Unit: dashboard builder formatting
- Unit: AI response parsing
- Integration: full cycle scorer → dashboard → mocked AI → risk check
- Backtest: replay historical data through scorers and evaluate score quality

### 5.5 Risk Governor (library, called synchronously)

**Identical to v1** — this is the one part that does NOT get AI influence.

**Checks (in order)**:
1. `global_enabled` — is the system on?
2. `paper_trade_mode` — if true, log but don't execute
3. `kill_switch` — has manual or auto kill switch been triggered?
4. `daily_drawdown` — has today's balance-delta loss exceeded limit?
5. `consecutive_losses` — too many losses in a row?
6. `max_exposure` — would this trade exceed total exposure limit?
7. `max_position_per_market` — too much in one market?
8. `max_position_per_category` — too much in one category?
9. `min_edge` — is AI's estimated edge > min_edge_multiple × estimated_cost?
10. `min_liquidity` — is market liquid enough?
11. `max_spread` — is spread acceptable?
12. `cooldown` — has enough time passed since last loss?
13. `latency` — is API latency within threshold?
14. `trade_rate` — not exceeding max trades per hour?
15. `category_enabled` — is this category currently allowed?
16. `data_freshness` — are scorer inputs fresh enough? (NEW: prevents trading on stale data)

**NEW check #16**: The reference architecture emphasized that stale data is worse than no data. If the scorer's input data (exchange prices, polls, odds) is older than the configured freshness threshold, the trade is vetoed.

**Tests**: 50+ unit tests, same rigor as v1.

### 5.6 Execution Engine Service (`execution-manager`)

Same as v1 with one critical change:

**No AI position review.** Once a position is opened, the exit strategy is set at entry and is mechanical:
- `resolution_only` — position resolves when market resolves (most common for Polymarket)
- `stop_loss` — close if price moves against by X (configurable per category)
- `time_based` — close after N hours if not resolved
- `manual` — operator closes from UI

The AI does NOT evaluate open positions. In testing (per reference architecture), AI second-guessed bracket exits and closed positions prematurely under P&L pressure. Mechanical exits are more disciplined.

**Sizing Formula** (same as v1, with size_hint from AI):
```
base_risk = configurable per category (default 0.5%)
ai_size_hint = from AI decision (0.1 to 1.0) — replaces separate confidence × edge calc
liquidity_factor = min(1.0, market_liquidity / reference_liquidity)
drawdown_factor = max(0.2, 1.0 - (current_drawdown / max_drawdown) × 2)

size = bankroll.active_balance × base_risk × ai_size_hint × liquidity_factor × drawdown_factor
size = min(size, max_position_size)
size = min(size, available_balance)
```

The AI's `size_hint` incorporates its confidence and edge assessment into one factor, which the risk governor then caps and adjusts mechanically.

**Tests**: Unit (sizing, maker/taker, slippage protection), Integration (order lifecycle with mocked Polymarket API)

### 5.7 AI Reviewer Service (`ai-reviewer`)

Same as v1 with additions for scorer calibration.

**Scheduled Tasks**:

| Task | Frequency | What It Does |
|------|-----------|-------------|
| Daily Review | Every 24h | Balance-delta P&L analysis, win rate, AI accuracy |
| Scorer Calibration | Every 24h | Which scorer dimensions correlated with wins/losses |
| Drift Detection | Every 6h | Check if measured edge is decaying |
| Threshold Tuning | Weekly | Recommend parameter adjustments |
| Anomaly Report | Every 4h | Flag unusual market or bot behavior |
| Category Review | Weekly | Which categories are profitable |
| Feedback Effectiveness | Weekly | Is intra-session feedback improving decisions? |

**NEW — Scorer Calibration Review**:
The reviewer analyzes which scorer dimensions were most predictive of trade outcomes. For example:
- "Exchange divergence > 50 correlated with 68% win rate (vs. 52% overall)"
- "Trades taken when exhaustion > 40 had negative expected value this week"
- "Poll divergence score has been poorly calibrated — recommend widening thresholds"

This is the offline learning loop. It doesn't modify the system live — it produces recommendations that the operator (or auto-apply rules) can accept.

**Auto-apply rules** (same as v1):
- Tighten thresholds: auto-apply allowed
- Loosen thresholds: requires operator approval
- Disable scorer: auto-apply allowed
- Enable scorer: requires operator approval
- Change sizing: requires operator approval

**Tests**: Unit (data aggregation, calibration math), Integration (full review with mocked Claude API)

### 5.8 Scheduler (`scheduler`)

```
Every 1 min   — system health check, publish to WebSocket
Every 5 min   — bankroll balance-delta update
Every 15 min  — stale order cleanup
Every 1 hour  — market catalog refresh
Every 4 hours — AI anomaly report
Every 6 hours — AI drift detection
Every 24 hours — daily review, scorer calibration, bankroll daily snapshot
Every 7 days  — weekly threshold tuning, category review, feedback effectiveness
Every 24 hours — database cleanup (prune old snapshots beyond retention)
Every 24 hours — database backup (pg_dump)
```

---

## 6. Context Scorers — Category by Category

This is the heart of the v2 architecture. Each category has its own set of scorers that produce continuous dimensions. The AI sees all dimensions simultaneously and synthesizes.

### 6.1 Crypto Scorers

For crypto prediction markets (BTC/ETH 15-min, hourly, daily candles).

| Scorer | Range | What It Measures |
|--------|-------|-----------------|
| `exchange_divergence` | -100 to +100 | Lag between exchange price and Polymarket implied price. Positive = exchange suggests UP, market hasn't caught up. This is the v1 "lag arb" reconceived as a continuous score. |
| `momentum` | -100 to +100 | Multi-timeframe momentum composite. EMA cross direction, MACD histogram slope, RSI direction, VWAP position. Labels: STRONG_BEAR to STRONG_BULL. |
| `mean_reversion` | 0 to 100 | How extended price is from mean (Bollinger position, ATR distance from VWAP). High = likely to revert. Includes snap direction (UP/DOWN). |
| `volatility` | 0 to 100 | ATR relative to recent history. Labels: LOW / NORMAL / HIGH / EXTREME. Compression detection (low → breakout likely). |
| `volume` | 0 to 100 | Session-aware volume ratio (not raw volume). Compared to same time-of-day bucket. Labels: DEAD / BELOW_AVG / NORMAL / ABOVE_AVG / SURGE. |
| `exhaustion` | 0 to 100 | Liquidation spike detection + tape slowdown after impulse. High = move is likely exhausted. |
| `liquidity_quality` | 0 to 100 | Polymarket spread + order book depth + ability to fill at reasonable price. |
| `time_pressure` | 0 to 100 | Minutes to market resolution. Affects whether moves have time to materialize. |

**Raw indicators computed** (from reference architecture):
- Trend: EMA 9/21, SMA 50, EMA cross
- Momentum: RSI 14, MACD (12/26/9), MACD histogram
- Volatility: ATR 14, Bollinger Bands (20, 2σ)
- Volume: Session-aware ratio
- Price: VWAP + standard deviation bands
- Structure: Recent highs/lows, support/resistance levels

All indicators always computed — no "no signal" state. Raw values feed into scorers, not buy/sell labels.

**Multi-timeframe** (from reference architecture):
- Primary (5-min) — 15 bars for pattern detection
- Short (1-min) — 15 bars for micro-structure
- Long (hourly) — 12 bars for big picture

### 6.2 Politics Scorers

For political prediction markets (elections, policy, appointments).

| Scorer | Range | What It Measures |
|--------|-------|-----------------|
| `poll_divergence` | -100 to +100 | Polymarket price vs polling aggregate implied probability. Positive = market underprices what polls suggest. |
| `sentiment_shift` | -100 to +100 | Recent news sentiment direction vs current market pricing. Captures information not yet priced in. |
| `historical_base_rate` | 0 to 100 | How likely this type of event is based on historical precedents. High = historically common outcome. |
| `resolution_risk` | 0 to 100 | Ambiguity in resolution criteria. High = risky, criteria could be interpreted differently. AI-parsed. |
| `crowd_bias` | -100 to +100 | Detected biases in market pricing: recency bias, partisan bias, narrative bias. |
| `information_velocity` | 0 to 100 | Rate of new information arriving. High = fast-moving, prices may not have caught up. |
| `liquidity_quality` | 0 to 100 | Same as crypto — spread, depth, fill quality. |
| `time_to_resolution` | 0 to 100 | Time remaining. Affects confidence in predictions and pricing dynamics. |

### 6.3 Sports Scorers

For sports prediction markets.

| Scorer | Range | What It Measures |
|--------|-------|-----------------|
| `odds_divergence` | -100 to +100 | Polymarket price vs sharp sportsbook (Pinnacle) implied probability. The sports equivalent of exchange_divergence. |
| `line_movement` | -100 to +100 | Direction and magnitude of recent line movement at sharp books. Positive = sharp money moving in one direction. |
| `injury_impact` | -100 to +100 | Recent injury/roster news impact on fair probability. Requires news feed. |
| `public_bias` | -100 to +100 | Polymarket pricing skewed by public money (popular teams overpriced). Contrarian signal. |
| `model_edge` | -100 to +100 | Statistical model's fair probability vs market price (if we build basic models). |
| `liquidity_quality` | 0 to 100 | Spread, depth, fill quality. |
| `time_to_event` | 0 to 100 | Time until game/event. Affects information arrival and pricing stability. |

### 6.4 Event Scorers

For general event markets (regulatory decisions, corporate actions, deadlines).

| Scorer | Range | What It Measures |
|--------|-------|-----------------|
| `base_rate` | 0 to 100 | Historical probability of this type of event happening by deadline. |
| `schedule_signal` | -100 to +100 | Official calendars, filings, regulatory timelines suggesting event is accelerating or delayed. |
| `news_impact` | -100 to +100 | Recent news suggesting event is more or less likely. |
| `resolution_risk` | 0 to 100 | Ambiguity in resolution criteria. Same as politics. |
| `crowd_confidence` | 0 to 100 | How confident the crowd appears (volume + price stability). Low confidence = more mispricing opportunity. |
| `liquidity_quality` | 0 to 100 | Spread, depth, fill quality. |
| `time_to_deadline` | 0 to 100 | Time remaining to resolution deadline. |

### 6.5 Cross-Category Scorer

Runs across all categories, looking for cross-market arbitrage.

| Scorer | Range | What It Measures |
|--------|-------|-----------------|
| `related_market_inconsistency` | 0 to 100 | Inconsistencies between related Polymarket contracts. E.g., "Party A wins" + "Party B wins" implied probabilities summing to > 100%. |
| `conditional_mispricing` | 0 to 100 | Conditional probability violations across linked markets. |

### Key Design Principle: No Hard Gates

From the reference architecture: "The AI already sees the trend score. A hard gate that blocks counter-trend trades also blocks valid mean reversion entries."

In v1, strategies had `allowedRegimes` — e.g., momentum only in `trending` regime. In v2, there are no hard gates. The AI sees ALL dimensions simultaneously and makes its own judgment. A high momentum score and a high mean reversion score can coexist — the AI decides which to weigh more. This is strictly better than binary gating because it preserves information.

The only hard gates are in the Risk Governor, which checks factual conditions (liquidity, drawdown, exposure) — not judgment calls about market regime.

---

## 7. AI Integration Layer

### Prompt Architecture — Text Dashboards

**Critical change from v1**: Prompts use human-readable text dashboards, not JSON.

**System Prompt** (stored in DB, editable from UI):
```
You are a disciplined quantitative trader operating on Polymarket prediction markets.

You receive a Market Context Dashboard with continuous scores across multiple dimensions. Every dimension always has a value — interpret the full picture, do not wait for "perfect" signals. Your job is to synthesize all dimensions into a single decision.

RULES:
- You may only output: trade or hold
- If you trade, you must specify direction, confidence (0-1), size hint (0.1-1.0), and exit strategy
- You MUST provide reasoning that explains how you weighed the dimensions
- You must estimate your edge and the all-in cost. Only trade when edge > 2x cost.
- Your reasoning must address the intra-session feedback if any patterns are noted
- If you are on a losing streak, you should require HIGHER confidence to trade
- You do NOT manage open positions. Once you decide to trade, the exit strategy you set is final.
- Be honest about uncertainty. "Hold" is a valid and often correct decision.

SIZING:
- size_hint of 0.1 = minimum size (low confidence or thin edge)
- size_hint of 1.0 = full size (high confidence, strong edge, good liquidity)
- The risk governor will further cap your size — you cannot override it

EXIT STRATEGIES (choose one per trade):
- "resolution_only" — hold until market resolves (most common for Polymarket)
- "stop_loss" — exit if price moves against by the stop amount (specify stop_loss_pct)
- "time_based" — exit after N hours if not resolved (specify hours)

OUTPUT FORMAT (JSON only, no other text):
{
  "action": "trade" | "hold",
  "direction": "buy_yes" | "buy_no" | null,
  "confidence": 0.0-1.0,
  "size_hint": 0.1-1.0,
  "estimated_edge": float,
  "estimated_cost": float,
  "fair_value": float,
  "regime": "quiet" | "trending" | "panic" | "volatile" | "untradeable",
  "regime_confidence": 0.0-1.0,
  "exit_strategy": "resolution_only" | "stop_loss" | "time_based",
  "stop_loss_pct": float | null,
  "time_exit_hours": int | null,
  "reasoning": "string"
}
```

### Token Budget Management
- Decision call: ~1200 tokens per call (dashboard ~800 input, response ~400 output)
- Reviews: ~2000 tokens per call
- Hourly budget: configurable (default 50,000 tokens)
- If budget exhausted: fall back to deterministic-only mode
  - In deterministic fallback: only trade when exchange_divergence > 70 AND liquidity_quality > 60
  - This is the "minimum viable brain" that operates on hard thresholds until AI is back

### Prompt Versioning
- All prompts stored in `system_config` with version hashes
- Editable from UI with test-before-deploy
- Historical decisions link to the prompt version used
- A/B test prompts by running both and comparing in backtest

---

## 8. Frontend — Web Application

### Design System
Same as v1:
- **Theme**: Dark mode primary, light mode available
- **Colors**: Dark background (#0a0a0f), card surfaces (#12121a), green for profit, red for loss, blue for neutral, amber for warnings
- **Typography**: Inter for UI, JetBrains Mono for numbers/data
- **Layout**: Sidebar navigation, main content area, optional right panel
- **Responsive**: Desktop-first, usable on tablet

### Pages & Components

#### 8.1 Dashboard (`/`)
Same as v1 with these changes:

**Changed Panels**:
- **Current Scores** (replaces "Current Regime"): Shows latest scorer dimensions per category as color-coded bars. Each dimension is a horizontal bar from -100 to +100 (or 0 to 100) with color gradient.
- **Recent AI Decisions** (replaces "Recent Signals"): Last 10 AI decisions with action, confidence, reasoning preview
- **Trade Feedback**: Today's intra-session stats — win/loss/streak/patterns
- **Balance-Delta P&L**: Shows actual balance change, not trade-sum P&L

All other panels same as v1.

#### 8.2 Markets Explorer (`/markets`)
Same as v1 with added columns:
- **Latest Scores**: Mini sparkline or heat-indicator of latest context scores
- **Last AI Decision**: What the AI decided last time it evaluated this market
- **Detail Drawer** now includes: full context score history chart, AI decision timeline

#### 8.3 Context Scorers (`/scorers`) ← REPLACES v1 Strategies page

**Layout**: Category tabs + scorer dimension cards

**Category Tabs**: Crypto | Politics | Sports | Events | Entertainment | Cross-Market

**Per Category View**:
- Grid of scorer dimension cards
- Each card shows:
  - Scorer name and description
  - Current value (large number with color)
  - Historical chart (last 24h of values)
  - Enabled/disabled toggle
  - Configuration button → opens parameter editor

**Scorer Config Panel** (drawer):
- All parameters with sliders/inputs (dynamically generated from schema)
- Current value, default value, min, max, description per parameter
- Preview of how parameter change would affect recent scores (backtest preview)
- Save triggers audit log

**Scorer Performance Sub-tab**:
- Correlation between each scorer dimension and trade outcomes
- "When exchange_divergence > 50, win rate was 68%"
- Helps operator understand which scorers are actually useful
- Data from AI reviewer's scorer calibration analysis

#### 8.4 AI Decisions (`/decisions`) ← REPLACES v1 Signals page

**Layout**: Filter bar + table + detail drawer

**Table Columns**: Time, Market, Category, Action, Direction, Confidence, Edge, Regime, Reasoning (preview), Executed, Veto Reason

**Filters**: Category, Action (trade/hold), Confidence Range, Regime, Time Range, Executed/Vetoed

**Decision Detail Drawer** (the most important view in the app):
- **Full Text Dashboard**: The exact formatted text the AI received, displayed in a monospaced, styled panel. This is critical — you can see exactly what the AI saw.
- **AI Response**: Full structured output + reasoning
- **Score Breakdown**: Visual bars for each dimension at decision time
- **Account State**: What the account looked like at decision time
- **Trade Feedback**: What intra-session feedback the AI had
- **Execution Result**: If traded — order, fill, current position status
- **Risk Governor**: Which checks passed/failed
- **Prompt Version**: Which system prompt was used

This is the single most important debugging tool. If a trade goes wrong, you open this drawer and see the complete context → decision → execution chain.

#### 8.5 Orders & Trades (`/trades`)
Same as v1, but `signal_id` references become `decision_id` references.

**Trade Detail Drawer** now shows the linked AI decision with full dashboard.

#### 8.6 Positions (`/positions`)
Same as v1 with critical addition:

**Exit Strategy Display**: Each position card prominently shows the exit strategy set at entry (resolution_only / stop_loss / time_based) and its parameters. This is displayed as a badge that cannot be edited (reinforcing that exits are mechanical).

**No "AI Review" button**: Deliberately absent. The AI does not review open positions. If you want to close, use the manual close button.

#### 8.7 Risk Management (`/risk`)
Same as v1 with one additional gauge:

**Data Freshness**: Shows how old the scorer input data is per category. If stale, the gauge goes red (risk check #16 would veto trades).

#### 8.8 AI Control Center (`/ai`) ← RESTRUCTURED

**Tabs**: Decisions | Reviews | Prompt Lab | Feedback | Cost

**Decisions Tab**: Same as 8.4 (can also be accessed directly from sidebar)

**Reviews Tab**: Same as v1 — AI review reports with apply/dismiss

**Prompt Lab** (replaces v1's simple config tab):
- Full prompt editor with syntax highlighting
- Template variables highlighted (where dashboard, account state, feedback get injected)
- "Test Prompt" button: select a historical market moment, run the prompt against it, see what the AI would have decided
- Prompt version history with diff view
- A/B comparison: run two prompt versions against same historical data

**Feedback Tab** (NEW):
- Current intra-session feedback per category
- Historical feedback summaries
- Visualization of how feedback affected subsequent decisions
- "Did the AI actually adjust after seeing losing patterns?"

**Cost Tab** (NEW):
- Token usage today, this week, this month
- Cost per category (which categories use the most tokens)
- Cost per decision (average)
- Budget utilization gauge
- Deterministic fallback events (when budget was exhausted)

#### 8.9 Analytics (`/analytics`)
Same as v1 with additions:

**NEW Charts**:
- **Scorer Correlation Matrix**: Which scorer dimensions correlate most with profitable trades
- **Confidence Calibration**: When the AI says 0.7 confidence, does it win ~70% of the time?
- **Dashboard Feature Importance**: Which parts of the dashboard most influenced trade vs hold decisions
- **Feedback Impact**: Did intra-session feedback improve subsequent decisions?
- **Balance-Delta vs Trade-Sum P&L**: Compare actual balance change vs sum of trade P&Ls (difference = hidden costs)

#### 8.10 Backtesting (`/backtest`)
Same as v1, but now backtests run the full scorer → dashboard → AI decision pipeline.

**NEW Configuration Options**:
- Choose which scorer dimensions to include/exclude
- Override scorer parameters for "what if" analysis
- Compare two prompt versions on same data
- "Scorer-only mode": run scorers without AI to see raw scoring quality

#### 8.11–8.13: Alerts, Settings, Health
Same as v1.

### Shared UI Components
Same as v1, with additions:
```
<ScoreDimensionBar>   — horizontal bar chart for a single dimension (-100 to +100)
<ScoreDashboardView>  — styled monospace display of the text dashboard
<ExitStrategyBadge>   — shows position exit strategy (non-editable)
<FeedbackCard>        — displays intra-session trade feedback
<PromptEditor>        — code editor with template variable highlighting
<BalanceDeltaDisplay> — P&L display using balance-delta method
```

---

## 9. WebSocket Real-Time Layer

### Events from Server to Client

| Channel | Event | Payload | Used In |
|---------|-------|---------|---------|
| `system` | `status` | system health snapshot | Header, Dashboard, Health |
| `market` | `price_update` | market_id, prices, spread | Markets, Positions |
| `scores` | `update` | category, market_id, latest scores | Dashboard, Scorers |
| `decision` | `new` | full AI decision summary | Dashboard, Decisions |
| `decision` | `vetoed` | decision_id, veto_reason | Dashboard, Decisions, Risk |
| `order` | `placed` | order object | Dashboard, Orders |
| `order` | `filled` | order object | Dashboard, Orders, Trades |
| `order` | `cancelled` | order_id, reason | Orders |
| `position` | `opened` | position object with exit strategy | Dashboard, Positions |
| `position` | `updated` | position with current P&L | Positions |
| `position` | `closed` | position with final P&L + close reason | Positions, Trades |
| `risk` | `event` | risk event object | Dashboard, Risk |
| `risk` | `kill_switch` | triggered/resumed | All pages (banner) |
| `feedback` | `update` | category, updated feedback summary | Dashboard, AI Center |
| `alert` | `new` | alert object | All pages (toast + badge) |
| `bankroll` | `update` | bankroll with balance-delta | Dashboard |

### Client-Side WebSocket Manager
Same as v1: auto-reconnect, per-page subscriptions, heartbeat, queue during reconnection.

---

## 10. Testing Strategy

### Testing Pyramid
Same as v1: 60% unit, 30% integration, 10% E2E.

### Backend Unit Tests

**Risk Governor** (highest priority — safety critical):
- Same 50+ tests as v1
- NEW: data freshness check tests

**Context Scorers** (per scorer, per category):
- Fixed inputs → expected continuous output (never null)
- Boundary values (what produces -100, 0, +100)
- Edge cases (missing data, stale data, zero volume)
- Session-aware volume normalization accuracy
- Multi-timeframe bar building correctness
- Score always produces a value — no null/undefined allowed
- 10+ tests per scorer × ~25 scorers = 250+ scorer tests

**Dashboard Builder**:
- Correct text formatting for each category
- All sections present (scores, account, feedback, cost)
- Handles missing optional data gracefully
- Output matches expected text format

**AI Response Parsing**:
- Valid JSON extraction
- All required fields present
- Confidence in 0–1 range
- Exit strategy validation
- Malformed response handling
- Fallback behavior when AI unavailable

**Sizing Formula**:
- Same 15+ tests as v1
- NEW: size_hint integration tests

**Intra-Session Feedback**:
- Feedback calculation accuracy
- Pattern detection (losing streak, directional bias)
- Feedback text generation
- Rolling window behavior

**Balance-Delta P&L**:
- Delta calculation vs trade-sum comparison
- Opening balance snapshot accuracy
- Daily rollover behavior

### Backend Integration Tests

Same as v1 for all API endpoints, plus:

**Full Decision Pipeline**:
- Data → Score → Dashboard → mocked AI → Risk Check → Order (full pipeline)
- Data → Score → Dashboard → mocked AI → Risk Veto (veto pipeline)
- Data → Score → Dashboard → AI unavailable → Deterministic Fallback

**Scorer → Dashboard → Decision**:
- Crypto market with known data → expected dashboard format → expected AI call structure
- Politics market with known polls → expected dashboard format
- Multiple markets in same cycle → correct batching

### Frontend Unit Tests
Same as v1, plus:
- `ScoreDimensionBar` — renders at various values, correct colors
- `ScoreDashboardView` — displays formatted text correctly
- `ExitStrategyBadge` — correct display per strategy type
- `PromptEditor` — template variable highlighting
- `BalanceDeltaDisplay` — correct formatting and color

### E2E Tests (Playwright)
Same 10 critical flows as v1, updated:
1. Login and see dashboard with live scores
2. Navigate to each page, verify key elements render
3. Toggle paper/live mode with confirmation
4. Trigger kill switch, verify system stops, resume
5. Configure a scorer parameter, verify save and audit log
6. View an AI decision detail, see full dashboard + reasoning
7. Close a position manually, verify confirmation (and that exit strategy was respected)
8. Run a backtest, view results
9. Test a prompt in Prompt Lab, see output
10. View scorer correlation in analytics

### Test Infrastructure
Same as v1: Test DB, Test Redis, MSW mocks, fixtures, factories, 80%+ backend / 70%+ frontend coverage.

---

## 11. Build Order & Phases

### Phase 0: Project Setup (1 session)
Same as v1 — monorepo, TypeScript, Prisma, Redis, Express, React, Vite, testing infra, Docker Compose, PM2, linting.

### Phase 1: Core Data Layer (2–3 sessions)
1. Database migrations for all tables (updated schema with context_scores, trade_feedback, etc.)
2. Prisma client generation + type exports
3. Market data models + CRUD
4. Context score models
5. System config models
6. Seed script with sample data
7. **Tests**: DB operations, model validation
8. Run: Can CRUD all entities, tests pass

### Phase 2: API Server Foundation (2–3 sessions)
1. Auth middleware (JWT)
2. Error handling, validation middleware
3. Market endpoints (full CRUD + filters)
4. Scorer config endpoints
5. System config endpoints
6. Audit log endpoints
7. WebSocket setup
8. **Tests**: All endpoint tests, auth tests
9. Run: API responds, WebSocket connects

### Phase 3: Frontend Shell (2–3 sessions)
1. App shell (sidebar, header, router)
2. Design system setup
3. Shared components (DataTable, StatCard, Badge, ScoreDimensionBar, etc.)
4. Dashboard page (layout + static panels)
5. Markets page (table + filters + drawer)
6. Settings page
7. WebSocket client manager + React Query setup
8. **Tests**: Component unit tests, page render tests
9. Run: App loads, navigates, shows market data

### Phase 4: Market Scanner + Data Ingestion (2–3 sessions)
1. Polymarket API client
2. Market scanner loop (fetch → classify → store → snapshot)
3. Binance WebSocket feed + bar builder (multi-timeframe)
4. Session-aware volume normalization
5. News API feed
6. Polling data feed
7. Sports odds feed
8. Feed health monitoring
9. System health page (connection statuses)
10. **Tests**: Scanner logic, bar building, session-aware volume, feed normalization
11. Run: Markets populated, external data flowing, visible in health page

### Phase 5: Context Scorers — Crypto (2–3 sessions)
1. Scorer interface + registry
2. `exchange_divergence` scorer
3. `momentum` scorer (with technical indicators library)
4. `mean_reversion` scorer
5. `volatility` scorer
6. `volume` scorer (session-aware)
7. `exhaustion` scorer
8. `liquidity_quality` scorer
9. `time_pressure` scorer
10. Store scores in `context_scores` table
11. Context Scorers UI page (crypto tab with dimension cards)
12. **Tests**: Each scorer with known inputs, always produces output, 80+ tests
13. Run: Crypto scores generating continuously, visible in UI

### Phase 6: Context Scorers — All Other Categories (2–3 sessions)
1. Politics scorers (poll_divergence, sentiment_shift, historical_base_rate, resolution_risk, crowd_bias, information_velocity)
2. Sports scorers (odds_divergence, line_movement, injury_impact, public_bias, model_edge)
3. Event scorers (base_rate, schedule_signal, news_impact, resolution_risk, crowd_confidence)
4. Cross-market scorer (related_market_inconsistency, conditional_mispricing)
5. Liquidity quality + time scorers (shared across categories)
6. Update Context Scorers UI for all categories
7. **Tests**: Each scorer module, 150+ additional tests
8. Run: All category scores generating, full UI

### Phase 7: Dashboard Builder + AI Decision Engine (2–3 sessions)
1. Dashboard text builder per category (formats scores into human-readable text)
2. Account state injection
3. Intra-session trade feedback builder + `trade_feedback` table
4. Cost estimation logic
5. Claude API client (with retry, token tracking, caching)
6. Prompt manager (DB-stored, versioned)
7. AI decision call + response parsing
8. Decision storage in `ai_decisions`
9. Deterministic fallback mode (when AI unavailable or budget exhausted)
10. AI Decisions UI page (table, filters, detail drawer with full dashboard view)
11. **Tests**: Dashboard formatting, AI response parsing, fallback behavior, 40+ tests
12. Run: Full scorer → dashboard → AI decision pipeline working, visible in UI

### Phase 8: Risk Governor (1–2 sessions)
1. All 16 risk checks implemented (including new data freshness check)
2. Kill switch logic (auto + manual)
3. Risk events logging
4. Risk management UI page (gauges, events, config)
5. Kill switch button in header
6. **Tests**: 50+ risk governor tests
7. Run: Risk limits enforced, kill switch works from UI

### Phase 9: Execution Engine + Positions (2 sessions)
1. Polymarket order API client
2. Sizing formula (with AI size_hint)
3. Maker vs taker decision logic
4. Order lifecycle management
5. Position tracking with mechanical exit strategies
6. Market resolution handling
7. Stop-loss monitoring loop
8. Time-based exit monitoring
9. Orders UI page + Positions UI page (with exit strategy badges)
10. Manual close from UI
11. **Tests**: Sizing, order lifecycle, exit strategies, 30+ tests
12. Run: Full pipeline — decision → risk → order → position with mechanical exits

### Phase 10: Bankroll + P&L (1 session)
1. Balance-delta P&L tracking
2. Daily opening/closing balance snapshots
3. Bankroll allocation management
4. Bankroll endpoints + UI
5. Dashboard P&L panels (balance-delta method)
6. **Tests**: Balance-delta math, snapshot accuracy
7. Run: Accurate P&L tracking via balance-delta

### Phase 11: Intra-Session Feedback Loop (1 session)
1. Trade result recording into feedback
2. Pattern detection (streaks, directional bias, confidence calibration)
3. Feedback text generation for AI prompt
4. Feedback endpoints + UI
5. Dashboard feedback panel
6. AI Decisions detail shows feedback that was in context
7. **Tests**: Feedback calculation, pattern detection, text generation
8. Run: Feedback flowing into AI context, visible in UI

### Phase 12: AI Reviewer (1–2 sessions)
1. Review task scheduler
2. Daily review + scorer calibration
3. Drift detection
4. Threshold tuning recommendations
5. Feedback effectiveness analysis
6. Review storage + endpoints
7. Reviews UI (list, detail, apply/dismiss)
8. Auto-apply logic with guardrails
9. **Tests**: Review data aggregation, calibration math, recommendation parsing
10. Run: Reviews generating, actionable from UI

### Phase 13: Analytics + Backtesting (2 sessions)
1. Analytics aggregation queries (including new v2 metrics)
2. All analytics endpoints
3. Analytics UI (all charts including scorer correlation, confidence calibration, feedback impact)
4. Backtest engine (replay historical data through full scorer → AI pipeline)
5. Backtest UI
6. **Tests**: Aggregation accuracy, backtest determinism
7. Run: Full analytics, backtests runnable

### Phase 14: Prompt Lab + Alerts + Notifications (1–2 sessions)
1. Prompt Lab UI (editor, test, version history, A/B comparison)
2. Alert generation
3. Alerts UI page
4. Toast notifications (real-time via WebSocket)
5. External notifications (webhook, Telegram)
6. AI cost tracking UI
7. **Tests**: Prompt testing, alert delivery
8. Run: Prompt Lab usable, alerts flowing

### Phase 15: Polish & Hardening (2 sessions)
1. Error boundaries, loading skeletons, empty states on all pages
2. Responsive tweaks
3. Dark/light theme toggle
4. Data export (CSV) for trades, decisions
5. Database cleanup job
6. Backup job
7. PM2 ecosystem config
8. Nginx config
9. Docker Compose production config
10. **Tests**: E2E Playwright tests for all critical flows
11. Run: Production-ready, all tests pass

### Phase 16: Paper Trade Validation (ongoing)
1. Enable paper trade mode
2. Run for 1–2 weeks across all categories
3. Validate: scores generating correctly, dashboards formatting properly, AI decisions are reasonable, risk governor blocking correctly, P&L tracking accurately, feedback loop working, system running 24/7, no memory leaks, logs rotating
4. Fix issues found
5. Only go live after validation

---

## 12. Deployment & 24/7 Operations

### Docker Compose Production Stack
```yaml
services:
  postgres:
    image: postgres:16
    restart: always
    volumes: [pgdata:/var/lib/postgresql/data]
    environment: [POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD]
    healthcheck: pg_isready

  redis:
    image: redis:7-alpine
    restart: always
    volumes: [redisdata:/data]
    healthcheck: redis-cli ping

  app:
    build: .
    restart: always
    depends_on: [postgres, redis]
    ports: ["3000:3000"]
    volumes: [./logs:/app/logs, ./backups:/app/backups]
    environment: [DATABASE_URL, REDIS_URL, all API keys]
    healthcheck: curl localhost:3000/api/health

  nginx:
    image: nginx:alpine
    restart: always
    depends_on: [app]
    ports: ["80:80", "443:443"]
    volumes: [./nginx.conf, ./ssl]
```

### PM2 Ecosystem
```javascript
module.exports = {
  apps: [
    { name: 'api-server', script: 'dist/server.js', instances: 1, max_memory_restart: '512M' },
    { name: 'market-scanner', script: 'dist/services/market-scanner.js', max_memory_restart: '256M' },
    { name: 'data-ingestion', script: 'dist/services/data-ingestion.js', max_memory_restart: '256M' },
    { name: 'decision-engine', script: 'dist/services/decision-engine.js', max_memory_restart: '384M' },
    { name: 'execution-manager', script: 'dist/services/execution-manager.js', max_memory_restart: '256M' },
    { name: 'ai-reviewer', script: 'dist/services/ai-reviewer.js', max_memory_restart: '256M' },
    { name: 'scheduler', script: 'dist/services/scheduler.js', max_memory_restart: '128M' },
  ]
};
```

### Resilience
Same as v1: PM2 auto-restart, Docker restart:always, health checks, graceful shutdown, stale order cleanup on startup, position reconciliation on startup.

### Monitoring
Same as v1: /api/health, system health page, log rotation, error alerting.

### Backup
Same as v1: daily pg_dump, Redis RDB, config export.

---

## 13. File & Folder Structure

```
polymarket-platform/
├── docker-compose.yml
├── docker-compose.prod.yml
├── Dockerfile
├── nginx.conf
├── ecosystem.config.js
├── package.json
├── tsconfig.base.json
├── .env.example
├── .eslintrc.js
├── .prettierrc
│
├── packages/
│   ├── shared/
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── market.ts
│   │   │   │   ├── scorer.ts                   -- scorer dimension types
│   │   │   │   ├── decision.ts                 -- AI decision types (replaces signal.ts)
│   │   │   │   ├── order.ts
│   │   │   │   ├── trade.ts
│   │   │   │   ├── position.ts
│   │   │   │   ├── risk.ts
│   │   │   │   ├── feedback.ts                 -- trade feedback types
│   │   │   │   ├── bankroll.ts
│   │   │   │   ├── alert.ts
│   │   │   │   ├── websocket.ts
│   │   │   │   └── index.ts
│   │   │   ├── constants/
│   │   │   │   ├── regimes.ts
│   │   │   │   ├── categories.ts
│   │   │   │   ├── scorer-names.ts             -- all scorer dimension names
│   │   │   │   ├── exit-strategies.ts
│   │   │   │   ├── order-status.ts
│   │   │   │   └── index.ts
│   │   │   ├── utils/
│   │   │   │   ├── math.ts
│   │   │   │   ├── formatting.ts
│   │   │   │   ├── validation.ts
│   │   │   │   └── index.ts
│   │   │   └── schemas/
│   │   │       ├── risk-config.schema.ts
│   │   │       ├── scorer-params.schema.ts
│   │   │       ├── ai-decision.schema.ts
│   │   │       └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── backend/
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   ├── config/
│   │   │   │   ├── env.ts
│   │   │   │   ├── database.ts
│   │   │   │   ├── redis.ts
│   │   │   │   └── logger.ts
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── validation.ts
│   │   │   │   ├── error-handler.ts
│   │   │   │   └── rate-limit.ts
│   │   │   ├── routes/
│   │   │   │   ├── system.routes.ts
│   │   │   │   ├── market.routes.ts
│   │   │   │   ├── scorer.routes.ts            -- replaces strategy.routes.ts
│   │   │   │   ├── decision.routes.ts          -- replaces signal.routes.ts
│   │   │   │   ├── order.routes.ts
│   │   │   │   ├── trade.routes.ts
│   │   │   │   ├── position.routes.ts
│   │   │   │   ├── risk.routes.ts
│   │   │   │   ├── bankroll.routes.ts
│   │   │   │   ├── ai-review.routes.ts
│   │   │   │   ├── feedback.routes.ts
│   │   │   │   ├── alert.routes.ts
│   │   │   │   ├── analytics.routes.ts
│   │   │   │   ├── backtest.routes.ts
│   │   │   │   └── index.ts
│   │   │   ├── controllers/
│   │   │   │   ├── system.controller.ts
│   │   │   │   ├── market.controller.ts
│   │   │   │   ├── scorer.controller.ts
│   │   │   │   ├── decision.controller.ts
│   │   │   │   ├── order.controller.ts
│   │   │   │   ├── trade.controller.ts
│   │   │   │   ├── position.controller.ts
│   │   │   │   ├── risk.controller.ts
│   │   │   │   ├── bankroll.controller.ts
│   │   │   │   ├── ai-review.controller.ts
│   │   │   │   ├── feedback.controller.ts
│   │   │   │   ├── alert.controller.ts
│   │   │   │   ├── analytics.controller.ts
│   │   │   │   └── backtest.controller.ts
│   │   │   ├── services/
│   │   │   │   ├── market-scanner/
│   │   │   │   │   ├── scanner.ts
│   │   │   │   │   ├── classifier.ts
│   │   │   │   │   └── index.ts
│   │   │   │   ├── data-ingestion/
│   │   │   │   │   ├── manager.ts
│   │   │   │   │   ├── bar-builder.ts          -- NEW: multi-timeframe bar construction
│   │   │   │   │   ├── session-volume.ts       -- NEW: session-aware volume normalization
│   │   │   │   │   ├── feeds/
│   │   │   │   │   │   ├── feed.interface.ts
│   │   │   │   │   │   ├── binance.feed.ts
│   │   │   │   │   │   ├── news.feed.ts
│   │   │   │   │   │   ├── polling.feed.ts
│   │   │   │   │   │   ├── sports-odds.feed.ts
│   │   │   │   │   │   └── index.ts
│   │   │   │   │   └── index.ts
│   │   │   │   ├── decision-engine/            -- REPLACES strategy-engine/
│   │   │   │   │   ├── engine.ts               -- main decision loop
│   │   │   │   │   ├── scorer.interface.ts     -- ContextScorer interface
│   │   │   │   │   ├── scorers/
│   │   │   │   │   │   ├── crypto/
│   │   │   │   │   │   │   ├── exchange-divergence.scorer.ts
│   │   │   │   │   │   │   ├── momentum.scorer.ts
│   │   │   │   │   │   │   ├── mean-reversion.scorer.ts
│   │   │   │   │   │   │   ├── volatility.scorer.ts
│   │   │   │   │   │   │   ├── volume.scorer.ts
│   │   │   │   │   │   │   ├── exhaustion.scorer.ts
│   │   │   │   │   │   │   ├── liquidity-quality.scorer.ts
│   │   │   │   │   │   │   ├── time-pressure.scorer.ts
│   │   │   │   │   │   │   └── index.ts
│   │   │   │   │   │   ├── politics/
│   │   │   │   │   │   │   ├── poll-divergence.scorer.ts
│   │   │   │   │   │   │   ├── sentiment-shift.scorer.ts
│   │   │   │   │   │   │   ├── historical-base-rate.scorer.ts
│   │   │   │   │   │   │   ├── resolution-risk.scorer.ts
│   │   │   │   │   │   │   ├── crowd-bias.scorer.ts
│   │   │   │   │   │   │   ├── information-velocity.scorer.ts
│   │   │   │   │   │   │   └── index.ts
│   │   │   │   │   │   ├── sports/
│   │   │   │   │   │   │   ├── odds-divergence.scorer.ts
│   │   │   │   │   │   │   ├── line-movement.scorer.ts
│   │   │   │   │   │   │   ├── injury-impact.scorer.ts
│   │   │   │   │   │   │   ├── public-bias.scorer.ts
│   │   │   │   │   │   │   ├── model-edge.scorer.ts
│   │   │   │   │   │   │   └── index.ts
│   │   │   │   │   │   ├── events/
│   │   │   │   │   │   │   ├── base-rate.scorer.ts
│   │   │   │   │   │   │   ├── schedule-signal.scorer.ts
│   │   │   │   │   │   │   ├── news-impact.scorer.ts
│   │   │   │   │   │   │   ├── crowd-confidence.scorer.ts
│   │   │   │   │   │   │   └── index.ts
│   │   │   │   │   │   ├── cross-market/
│   │   │   │   │   │   │   ├── related-inconsistency.scorer.ts
│   │   │   │   │   │   │   ├── conditional-mispricing.scorer.ts
│   │   │   │   │   │   │   └── index.ts
│   │   │   │   │   │   └── shared/
│   │   │   │   │   │       ├── liquidity-quality.scorer.ts
│   │   │   │   │   │       ├── time-scorer.scorer.ts
│   │   │   │   │   │       └── index.ts
│   │   │   │   │   ├── dashboard-builder/
│   │   │   │   │   │   ├── builder.ts          -- assembles text dashboard
│   │   │   │   │   │   ├── templates/
│   │   │   │   │   │   │   ├── crypto.template.ts
│   │   │   │   │   │   │   ├── politics.template.ts
│   │   │   │   │   │   │   ├── sports.template.ts
│   │   │   │   │   │   │   ├── events.template.ts
│   │   │   │   │   │   │   └── index.ts
│   │   │   │   │   │   └── index.ts
│   │   │   │   │   ├── feedback/
│   │   │   │   │   │   ├── feedback-builder.ts  -- builds intra-session feedback
│   │   │   │   │   │   ├── pattern-detector.ts  -- detects streaks, biases
│   │   │   │   │   │   └── index.ts
│   │   │   │   │   └── index.ts
│   │   │   │   ├── ai/
│   │   │   │   │   ├── client.ts               -- Claude API client
│   │   │   │   │   ├── prompt-manager.ts
│   │   │   │   │   ├── decision-maker.ts       -- single unified AI call
│   │   │   │   │   ├── response-parser.ts
│   │   │   │   │   ├── token-budget.ts
│   │   │   │   │   ├── deterministic-fallback.ts -- when AI unavailable
│   │   │   │   │   ├── reviewer.ts             -- offline review AI
│   │   │   │   │   └── index.ts
│   │   │   │   ├── risk/
│   │   │   │   │   ├── governor.ts
│   │   │   │   │   ├── checks/
│   │   │   │   │   │   ├── check.interface.ts
│   │   │   │   │   │   ├── drawdown.check.ts
│   │   │   │   │   │   ├── exposure.check.ts
│   │   │   │   │   │   ├── consecutive-loss.check.ts
│   │   │   │   │   │   ├── trade-rate.check.ts
│   │   │   │   │   │   ├── liquidity.check.ts
│   │   │   │   │   │   ├── spread.check.ts
│   │   │   │   │   │   ├── latency.check.ts
│   │   │   │   │   │   ├── cooldown.check.ts
│   │   │   │   │   │   ├── edge.check.ts
│   │   │   │   │   │   ├── data-freshness.check.ts  -- NEW
│   │   │   │   │   │   └── index.ts
│   │   │   │   │   ├── kill-switch.ts
│   │   │   │   │   └── index.ts
│   │   │   │   ├── execution/
│   │   │   │   │   ├── engine.ts
│   │   │   │   │   ├── sizing.ts
│   │   │   │   │   ├── order-manager.ts
│   │   │   │   │   ├── position-manager.ts
│   │   │   │   │   ├── exit-monitor.ts         -- NEW: monitors stop-loss and time exits
│   │   │   │   │   └── index.ts
│   │   │   │   ├── bankroll/
│   │   │   │   │   ├── tracker.ts
│   │   │   │   │   ├── balance-delta.ts        -- NEW: balance-delta P&L calculation
│   │   │   │   │   └── index.ts
│   │   │   │   ├── alerts/
│   │   │   │   │   ├── alert-manager.ts
│   │   │   │   │   ├── notifiers/
│   │   │   │   │   │   ├── notifier.interface.ts
│   │   │   │   │   │   ├── webhook.notifier.ts
│   │   │   │   │   │   ├── telegram.notifier.ts
│   │   │   │   │   │   └── index.ts
│   │   │   │   │   └── index.ts
│   │   │   │   ├── analytics/
│   │   │   │   │   ├── aggregator.ts
│   │   │   │   │   ├── scorer-correlation.ts   -- NEW: scorer dimension vs outcome analysis
│   │   │   │   │   ├── confidence-calibration.ts -- NEW
│   │   │   │   │   └── index.ts
│   │   │   │   ├── backtest/
│   │   │   │   │   ├── engine.ts
│   │   │   │   │   ├── simulator.ts
│   │   │   │   │   └── index.ts
│   │   │   │   └── scheduler/
│   │   │   │       ├── scheduler.ts
│   │   │   │       ├── jobs/
│   │   │   │       │   ├── daily-review.job.ts
│   │   │   │       │   ├── scorer-calibration.job.ts  -- NEW
│   │   │   │       │   ├── drift-detection.job.ts
│   │   │   │       │   ├── feedback-effectiveness.job.ts -- NEW
│   │   │   │       │   ├── cleanup.job.ts
│   │   │   │       │   ├── backup.job.ts
│   │   │   │       │   └── index.ts
│   │   │   │       └── index.ts
│   │   │   ├── integrations/
│   │   │   │   ├── polymarket/
│   │   │   │   │   ├── client.ts
│   │   │   │   │   ├── types.ts
│   │   │   │   │   ├── websocket.ts
│   │   │   │   │   └── index.ts
│   │   │   │   └── index.ts
│   │   │   ├── websocket/
│   │   │   │   ├── server.ts
│   │   │   │   ├── channels.ts
│   │   │   │   └── index.ts
│   │   │   └── utils/
│   │   │       ├── redis.ts
│   │   │       ├── pubsub.ts
│   │   │       └── index.ts
│   │   ├── tests/
│   │   │   ├── unit/
│   │   │   │   ├── risk/
│   │   │   │   │   ├── governor.test.ts
│   │   │   │   │   ├── drawdown-check.test.ts
│   │   │   │   │   ├── exposure-check.test.ts
│   │   │   │   │   ├── data-freshness-check.test.ts
│   │   │   │   │   ├── ... (one per check)
│   │   │   │   │   └── kill-switch.test.ts
│   │   │   │   ├── scorers/
│   │   │   │   │   ├── crypto/
│   │   │   │   │   │   ├── exchange-divergence.test.ts
│   │   │   │   │   │   ├── momentum.test.ts
│   │   │   │   │   │   ├── mean-reversion.test.ts
│   │   │   │   │   │   ├── volatility.test.ts
│   │   │   │   │   │   ├── volume.test.ts
│   │   │   │   │   │   ├── exhaustion.test.ts
│   │   │   │   │   │   └── ... (one per scorer)
│   │   │   │   │   ├── politics/
│   │   │   │   │   │   ├── poll-divergence.test.ts
│   │   │   │   │   │   └── ... (one per scorer)
│   │   │   │   │   ├── sports/
│   │   │   │   │   │   └── ... (one per scorer)
│   │   │   │   │   ├── events/
│   │   │   │   │   │   └── ... (one per scorer)
│   │   │   │   │   └── cross-market/
│   │   │   │   │       └── ... (one per scorer)
│   │   │   │   ├── decision-engine/
│   │   │   │   │   ├── dashboard-builder.test.ts
│   │   │   │   │   ├── feedback-builder.test.ts
│   │   │   │   │   ├── pattern-detector.test.ts
│   │   │   │   │   └── deterministic-fallback.test.ts
│   │   │   │   ├── ai/
│   │   │   │   │   ├── prompt-manager.test.ts
│   │   │   │   │   ├── response-parser.test.ts
│   │   │   │   │   └── token-budget.test.ts
│   │   │   │   ├── execution/
│   │   │   │   │   ├── sizing.test.ts
│   │   │   │   │   ├── order-manager.test.ts
│   │   │   │   │   ├── position-manager.test.ts
│   │   │   │   │   └── exit-monitor.test.ts
│   │   │   │   ├── bankroll/
│   │   │   │   │   ├── tracker.test.ts
│   │   │   │   │   └── balance-delta.test.ts
│   │   │   │   ├── data-ingestion/
│   │   │   │   │   ├── bar-builder.test.ts
│   │   │   │   │   ├── session-volume.test.ts
│   │   │   │   │   └── binance-feed.test.ts
│   │   │   │   └── scanner/
│   │   │   │       └── classifier.test.ts
│   │   │   ├── integration/
│   │   │   │   ├── api/
│   │   │   │   │   ├── markets.test.ts
│   │   │   │   │   ├── scorers.test.ts
│   │   │   │   │   ├── decisions.test.ts
│   │   │   │   │   ├── orders.test.ts
│   │   │   │   │   ├── trades.test.ts
│   │   │   │   │   ├── positions.test.ts
│   │   │   │   │   ├── risk.test.ts
│   │   │   │   │   ├── bankroll.test.ts
│   │   │   │   │   ├── ai-reviews.test.ts
│   │   │   │   │   ├── feedback.test.ts
│   │   │   │   │   ├── alerts.test.ts
│   │   │   │   │   ├── analytics.test.ts
│   │   │   │   │   └── system.test.ts
│   │   │   │   ├── pipelines/
│   │   │   │   │   ├── score-to-decision-to-trade.test.ts
│   │   │   │   │   ├── decision-veto-flow.test.ts
│   │   │   │   │   ├── deterministic-fallback.test.ts
│   │   │   │   │   └── feedback-loop.test.ts
│   │   │   │   └── setup.ts
│   │   │   ├── fixtures/
│   │   │   │   ├── markets.fixture.ts
│   │   │   │   ├── scores.fixture.ts
│   │   │   │   ├── decisions.fixture.ts
│   │   │   │   ├── trades.fixture.ts
│   │   │   │   └── ...
│   │   │   └── factories/
│   │   │       ├── market.factory.ts
│   │   │       ├── score.factory.ts
│   │   │       ├── decision.factory.ts
│   │   │       └── ...
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── package.json
│   │
│   └── frontend/
│       ├── public/
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── api/
│       │   │   ├── client.ts
│       │   │   ├── markets.api.ts
│       │   │   ├── scorers.api.ts
│       │   │   ├── decisions.api.ts
│       │   │   ├── orders.api.ts
│       │   │   ├── trades.api.ts
│       │   │   ├── positions.api.ts
│       │   │   ├── risk.api.ts
│       │   │   ├── bankroll.api.ts
│       │   │   ├── ai-reviews.api.ts
│       │   │   ├── feedback.api.ts
│       │   │   ├── alerts.api.ts
│       │   │   ├── analytics.api.ts
│       │   │   ├── backtest.api.ts
│       │   │   ├── system.api.ts
│       │   │   └── index.ts
│       │   ├── stores/
│       │   │   ├── app.store.ts
│       │   │   ├── websocket.store.ts
│       │   │   ├── alerts.store.ts
│       │   │   └── index.ts
│       │   ├── hooks/
│       │   │   ├── useMarkets.ts
│       │   │   ├── useScorers.ts
│       │   │   ├── useDecisions.ts
│       │   │   ├── useOrders.ts
│       │   │   ├── useTrades.ts
│       │   │   ├── usePositions.ts
│       │   │   ├── useRisk.ts
│       │   │   ├── useBankroll.ts
│       │   │   ├── useFeedback.ts
│       │   │   ├── useAlerts.ts
│       │   │   ├── useAnalytics.ts
│       │   │   ├── useWebSocket.ts
│       │   │   └── index.ts
│       │   ├── pages/
│       │   │   ├── Dashboard/
│       │   │   │   ├── Dashboard.tsx
│       │   │   │   ├── panels/
│       │   │   │   │   ├── PnlPanel.tsx
│       │   │   │   │   ├── BankrollPanel.tsx
│       │   │   │   │   ├── PositionsPanel.tsx
│       │   │   │   │   ├── LiveScoresPanel.tsx      -- NEW: replaces RegimePanel
│       │   │   │   │   ├── RecentDecisionsPanel.tsx -- NEW: replaces RecentSignalsPanel
│       │   │   │   │   ├── RecentTradesPanel.tsx
│       │   │   │   │   ├── FeedbackPanel.tsx        -- NEW
│       │   │   │   │   ├── AlertsPanel.tsx
│       │   │   │   │   ├── CategoryPerfPanel.tsx
│       │   │   │   │   ├── OpportunityPanel.tsx
│       │   │   │   │   └── SystemStatusPanel.tsx
│       │   │   │   └── index.ts
│       │   │   ├── Markets/
│       │   │   │   ├── Markets.tsx
│       │   │   │   ├── MarketTable.tsx
│       │   │   │   ├── MarketDetail.tsx
│       │   │   │   ├── MarketFilters.tsx
│       │   │   │   └── index.ts
│       │   │   ├── Scorers/                         -- REPLACES Strategies/
│       │   │   │   ├── Scorers.tsx
│       │   │   │   ├── ScorerCard.tsx
│       │   │   │   ├── ScorerConfig.tsx
│       │   │   │   ├── ScorerPerformance.tsx
│       │   │   │   └── index.ts
│       │   │   ├── Decisions/                       -- REPLACES Signals/
│       │   │   │   ├── Decisions.tsx
│       │   │   │   ├── DecisionTable.tsx
│       │   │   │   ├── DecisionDetail.tsx           -- shows full dashboard + reasoning
│       │   │   │   └── index.ts
│       │   │   ├── Trades/
│       │   │   │   ├── Trades.tsx
│       │   │   │   ├── OrderTable.tsx
│       │   │   │   ├── TradeTable.tsx
│       │   │   │   ├── TradeDetail.tsx
│       │   │   │   └── index.ts
│       │   │   ├── Positions/
│       │   │   │   ├── Positions.tsx
│       │   │   │   ├── PositionCard.tsx             -- shows exit strategy badge
│       │   │   │   ├── PositionHistory.tsx
│       │   │   │   └── index.ts
│       │   │   ├── Risk/
│       │   │   │   ├── Risk.tsx
│       │   │   │   ├── RiskDashboard.tsx
│       │   │   │   ├── RiskConfig.tsx
│       │   │   │   ├── RiskEvents.tsx
│       │   │   │   └── index.ts
│       │   │   ├── AI/
│       │   │   │   ├── AICenter.tsx
│       │   │   │   ├── DecisionsTab.tsx
│       │   │   │   ├── ReviewsTab.tsx
│       │   │   │   ├── PromptLab.tsx                -- NEW: replaces simple config
│       │   │   │   ├── FeedbackTab.tsx              -- NEW
│       │   │   │   ├── CostTab.tsx                  -- NEW
│       │   │   │   └── index.ts
│       │   │   ├── Analytics/
│       │   │   │   ├── Analytics.tsx
│       │   │   │   ├── charts/
│       │   │   │   │   ├── CumulativePnlChart.tsx
│       │   │   │   │   ├── CategoryPnlChart.tsx
│       │   │   │   │   ├── WinRateChart.tsx
│       │   │   │   │   ├── EdgeAccuracyChart.tsx
│       │   │   │   │   ├── DrawdownChart.tsx
│       │   │   │   │   ├── FeeAnalysisChart.tsx
│       │   │   │   │   ├── ScorerCorrelationChart.tsx    -- NEW
│       │   │   │   │   ├── ConfidenceCalibrationChart.tsx -- NEW
│       │   │   │   │   ├── FeedbackImpactChart.tsx       -- NEW
│       │   │   │   │   ├── BalanceDeltaComparisonChart.tsx -- NEW
│       │   │   │   │   └── index.ts
│       │   │   │   └── index.ts
│       │   │   ├── Backtest/
│       │   │   │   ├── Backtest.tsx
│       │   │   │   ├── BacktestConfig.tsx
│       │   │   │   ├── BacktestResults.tsx
│       │   │   │   └── index.ts
│       │   │   ├── Alerts/
│       │   │   │   ├── Alerts.tsx
│       │   │   │   ├── AlertList.tsx
│       │   │   │   ├── NotificationSettings.tsx
│       │   │   │   └── index.ts
│       │   │   ├── Settings/
│       │   │   │   ├── Settings.tsx
│       │   │   │   ├── ApiKeysSection.tsx
│       │   │   │   ├── ConnectionsSection.tsx
│       │   │   │   ├── PreferencesSection.tsx
│       │   │   │   ├── DataRetentionSection.tsx
│       │   │   │   └── index.ts
│       │   │   ├── Health/
│       │   │   │   ├── Health.tsx
│       │   │   │   ├── ProcessStatus.tsx
│       │   │   │   ├── ConnectionStatus.tsx
│       │   │   │   └── index.ts
│       │   │   └── Login/
│       │   │       ├── Login.tsx
│       │   │       └── index.ts
│       │   ├── components/
│       │   │   ├── layout/
│       │   │   │   ├── AppShell.tsx
│       │   │   │   ├── Sidebar.tsx
│       │   │   │   ├── Header.tsx
│       │   │   │   └── index.ts
│       │   │   ├── shared/
│       │   │   │   ├── DataTable.tsx
│       │   │   │   ├── StatCard.tsx
│       │   │   │   ├── GaugeChart.tsx
│       │   │   │   ├── Badge.tsx
│       │   │   │   ├── ParameterForm.tsx
│       │   │   │   ├── ConfirmDialog.tsx
│       │   │   │   ├── DetailDrawer.tsx
│       │   │   │   ├── JsonViewer.tsx
│       │   │   │   ├── TimeRangeSelector.tsx
│       │   │   │   ├── AlertToast.tsx
│       │   │   │   ├── EmptyState.tsx
│       │   │   │   ├── LoadingSkeleton.tsx
│       │   │   │   ├── ErrorBoundary.tsx
│       │   │   │   ├── ConnectionDot.tsx
│       │   │   │   ├── PnlDisplay.tsx
│       │   │   │   ├── MiniChart.tsx
│       │   │   │   ├── KillSwitchButton.tsx
│       │   │   │   ├── ModeBadge.tsx
│       │   │   │   ├── ScoreDimensionBar.tsx        -- NEW
│       │   │   │   ├── ScoreDashboardView.tsx       -- NEW
│       │   │   │   ├── ExitStrategyBadge.tsx        -- NEW
│       │   │   │   ├── FeedbackCard.tsx             -- NEW
│       │   │   │   ├── PromptEditor.tsx             -- NEW
│       │   │   │   ├── BalanceDeltaDisplay.tsx      -- NEW
│       │   │   │   └── index.ts
│       │   │   └── charts/
│       │   │       ├── BaseChart.tsx
│       │   │       ├── Sparkline.tsx
│       │   │       └── index.ts
│       │   ├── lib/
│       │   │   ├── websocket.ts
│       │   │   ├── formatters.ts
│       │   │   ├── colors.ts
│       │   │   └── constants.ts
│       │   └── styles/
│       │       └── globals.css
│       ├── tests/
│       │   ├── unit/
│       │   │   ├── components/
│       │   │   │   ├── DataTable.test.tsx
│       │   │   │   ├── ScoreDimensionBar.test.tsx
│       │   │   │   ├── ScoreDashboardView.test.tsx
│       │   │   │   ├── ExitStrategyBadge.test.tsx
│       │   │   │   ├── BalanceDeltaDisplay.test.tsx
│       │   │   │   ├── PromptEditor.test.tsx
│       │   │   │   └── ... (one per component)
│       │   │   ├── stores/
│       │   │   │   └── ...
│       │   │   └── utils/
│       │   │       └── ...
│       │   ├── integration/
│       │   │   ├── pages/
│       │   │   │   ├── Dashboard.test.tsx
│       │   │   │   ├── Markets.test.tsx
│       │   │   │   ├── Scorers.test.tsx
│       │   │   │   ├── Decisions.test.tsx
│       │   │   │   ├── Trades.test.tsx
│       │   │   │   ├── Positions.test.tsx
│       │   │   │   ├── Risk.test.tsx
│       │   │   │   ├── AICenter.test.tsx
│       │   │   │   ├── Analytics.test.tsx
│       │   │   │   └── Settings.test.tsx
│       │   │   └── setup.ts
│       │   ├── e2e/
│       │   │   ├── dashboard.spec.ts
│       │   │   ├── kill-switch.spec.ts
│       │   │   ├── scorer-config.spec.ts
│       │   │   ├── decision-detail.spec.ts
│       │   │   ├── prompt-lab.spec.ts
│       │   │   ├── manual-close.spec.ts
│       │   │   ├── navigation.spec.ts
│       │   │   └── smoke.spec.ts
│       │   └── mocks/
│       │       ├── handlers.ts
│       │       ├── server.ts
│       │       └── data/
│       │           ├── markets.mock.ts
│       │           ├── scores.mock.ts
│       │           ├── decisions.mock.ts
│       │           └── ...
│       ├── index.html
│       ├── vite.config.ts
│       ├── tailwind.config.js
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       ├── playwright.config.ts
│       └── package.json
│
├── scripts/
│   ├── setup.sh
│   ├── dev.sh
│   ├── test.sh
│   ├── build.sh
│   ├── deploy.sh
│   ├── backup.sh
│   └── seed.sh
│
└── docs/
    ├── architecture.md
    ├── api-reference.md
    ├── scorer-guide.md                             -- replaces strategy-guide.md
    ├── dashboard-format.md                         -- NEW: documents text dashboard format
    ├── deployment.md
    └── troubleshooting.md
```

---

## Summary Checklist

Before calling this done, every one of these must be true:

### Functional
- [ ] All Polymarket markets scanned and categorized
- [ ] External data feeds connected and flowing
- [ ] Multi-timeframe bar builder working for crypto
- [ ] Session-aware volume normalization working
- [ ] All context scorers producing continuous values (no nulls, no "no signal")
- [ ] Text dashboards formatting correctly per category
- [ ] Intra-session trade feedback building and updating
- [ ] AI receiving full dashboard and returning structured decisions
- [ ] Deterministic fallback working when AI unavailable
- [ ] Risk governor enforcing all 16 checks (including data freshness)
- [ ] Kill switch works (manual + auto)
- [ ] Orders placing on Polymarket (or paper trading)
- [ ] Positions tracking with mechanical exit strategies
- [ ] No AI position review — exits are resolution/stop-loss/time/manual only
- [ ] Balance-delta P&L tracking accurately
- [ ] AI reviewer generating daily/weekly reports + scorer calibration
- [ ] Alerts generating and notifying
- [ ] Backtesting functional against historical data
- [ ] Full audit trail of every config change
- [ ] Prompt Lab allows testing prompts against historical data

### UI
- [ ] Dashboard shows real-time scores, decisions, feedback
- [ ] Every scorer parameter configurable from UI
- [ ] Every AI decision viewable with FULL TEXT DASHBOARD that was sent
- [ ] Every trade traceable from scores → dashboard → decision → order → position → close
- [ ] Exit strategy badges visible and non-editable on positions
- [ ] Risk status visible at a glance (including data freshness)
- [ ] Kill switch accessible from every page
- [ ] Scorer correlation analytics rendering
- [ ] Confidence calibration chart working
- [ ] Paper/live mode toggle works
- [ ] Dark/light theme works
- [ ] WebSocket updates flowing in real-time
- [ ] Empty, loading, and error states handled everywhere

### Testing
- [ ] Risk governor: 50+ unit tests
- [ ] Each context scorer: 10+ unit tests (250+ total across all scorers)
- [ ] Dashboard builder: 15+ unit tests (one per category + edge cases)
- [ ] Feedback builder + pattern detector: 15+ unit tests
- [ ] AI response parser: 10+ unit tests
- [ ] Sizing formula: 15+ unit tests
- [ ] Balance-delta P&L: 10+ unit tests
- [ ] Bar builder + session volume: 15+ unit tests
- [ ] Exit monitor: 10+ unit tests
- [ ] Every API endpoint: integration test
- [ ] Score-to-decision-to-trade pipeline: integration test
- [ ] Deterministic fallback pipeline: integration test
- [ ] Every page: render test
- [ ] Key components: unit tests
- [ ] 10 critical E2E flows: Playwright tests
- [ ] Coverage: 80%+ backend, 70%+ frontend

### Operations
- [ ] Docker Compose runs full stack
- [ ] PM2 manages all processes
- [ ] Auto-restart on crash
- [ ] Log rotation configured
- [ ] Database backup running
- [ ] Health endpoint reporting all statuses
- [ ] Graceful shutdown handling
- [ ] Position reconciliation on startup
- [ ] Stale data detection preventing trades on old information