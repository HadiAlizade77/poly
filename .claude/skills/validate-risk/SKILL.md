---
name: validate-risk
description: >
  Validate risk governor checks and risk configuration changes.
  Use when modifying risk parameters, adding new risk checks, or reviewing risk logic.
argument-hint: "[check-name or 'all']"
allowed-tools: Read, Bash, Glob, Grep
disable-model-invocation: true
---

# Validate Risk Governor

Validate risk check: `$ARGUMENTS`

## Risk Governor Location

- `packages/backend/src/services/risk/governor.ts`
- `packages/backend/src/services/risk/checks/`
- Tests: `packages/backend/tests/unit/risk/`

## The 16 Risk Checks (in order)

1. `global_enabled` — system on/off
2. `paper_trade_mode` — log but don't execute
3. `kill_switch` — manual or auto kill triggered
4. `daily_drawdown` — today's loss vs limit
5. `consecutive_losses` — loss streak vs limit
6. `max_exposure` — total exposure vs limit
7. `max_position_market` — per-market position size
8. `max_position_category` — per-category exposure
9. `min_edge` — edge > min_edge_multiple x cost
10. `min_liquidity` — market liquidity threshold
11. `max_spread` — bid-ask spread threshold
12. `cooldown` — time since last loss
13. `latency` — API latency threshold
14. `trade_rate` — trades per hour limit
15. `category_enabled` — category trading allowed
16. `strategy_enabled` — strategy enabled

## Validation Checklist

1. Read the risk check implementation
2. Read corresponding unit tests
3. Verify:
   - [ ] Check returns correct pass/fail for boundary values (exactly at limit, just above, just below)
   - [ ] Check short-circuits correctly (fails fast in pipeline)
   - [ ] Veto reason is descriptive and logged to `risk_events`
   - [ ] Config is read from `risk_config` table (not hardcoded)
   - [ ] Per-scope overrides work (global → category → strategy → market)
   - [ ] Kill switch cannot be bypassed
   - [ ] Concurrent access is safe
4. Run risk tests:
   ```bash
   cd packages/backend && npx vitest run tests/unit/risk/ --reporter=verbose
   ```
5. Report any gaps in test coverage

## Safety Rule

The risk governor is safety-critical code. Every change must have:
- Unit tests for the exact change
- Boundary value tests
- Integration test showing the full signal → risk check → veto/approve pipeline
