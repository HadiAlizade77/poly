---
name: BTC Bot page overhaul
description: Details of the BtcBot.tsx + useBtcBot.ts overhaul — type fixes, new panels, WebSocket wiring
type: project
---

BtcBot page was overhauled to add Activity Log and Trade History panels, fix type mismatches, fix confidence NaN, and add a live countdown timer.

**Why:** The page was displaying stale data (no logs/trades panels used), had broken field name references (`tradedThisWindow`, `windowsTradedCount`), and showed NaN for confidence because Prisma returns Decimal as a string.

**How to apply:** When touching btc-bot types — `BtcBotBotStatus` now uses `windowTradeCount` (number), `sessionTrades`, `sessionPnl`, `state`, `currentPositionId`, `lastAction`, `lastActionTime`. The old fields `tradedThisWindow` and `windowsTradedCount` are gone. Settings.tsx was also updated to match.

Key decisions:
- `parseDecimal()` helper unwraps Prisma Decimal strings safely — use it for `confidence`, `pnl`, any Decimal field from backend
- Countdown uses a local `useCountdown(isoDate)` hook that ticks every second — avoids date-fns `formatDistanceToNow`
- Activity log auto-scrolls via `scrollRef.current.scrollTop = scrollRef.current.scrollHeight` in a `useEffect([logs.length])`
- WebSocket subscription uses `on('btc-bot:status', ...)` from `useSocket` and merges into `['btc-bot-status']` query cache key
- Side labels are "Up"/"Down" (Polymarket UI) not "YES"/"NO"
