---
name: add-strategy
description: >
  Create a new trading strategy module for the Polymarket platform.
  Use when adding strategies like CryptoLagArb, PollDivergence, OddsComparison, etc.
argument-hint: "[strategy-name] [category: crypto|politics|sports|events|general]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Add Trading Strategy

Create a new trading strategy: `$ARGUMENTS[0]` in category `$ARGUMENTS[1]`.

## Project Context

- Strategies live in `packages/backend/src/services/strategy-engine/strategies/{category}/`
- Every strategy implements the `StrategyModule` interface
- Strategies are registered in the strategy engine and configured via the `strategies` DB table
- All parameters are configurable from the UI via the `strategy_configs` table
- Signals are written to the `signals` table

## Strategy Interface

```typescript
interface StrategyModule {
  id: string;
  name: string;
  category: MarketCategory;
  strategyType: StrategyType;
  allowedRegimes: Regime[];
  evaluate(context: StrategyContext): Promise<Signal | null>;
  getRequiredData(): DataRequirement[];
  validateConfig(params: Record<string, any>): ValidationResult;
}
```

## Scaffolding Steps

1. Create strategy file: `packages/backend/src/services/strategy-engine/strategies/$1/$0.strategy.ts`
2. Implement the `StrategyModule` interface with:
   - `evaluate()` — core logic returning a Signal or null
   - `getRequiredData()` — what external data this strategy needs
   - `validateConfig()` — Zod schema validation for parameters
3. Define a Zod schema for all configurable parameters with defaults, min, max, and descriptions
4. Register the strategy in the strategy engine's registry
5. Create a DB seed entry for the `strategies` table
6. Create unit test: `packages/backend/tests/unit/strategies/$0.test.ts` with:
   - Known input → expected signal output
   - No signal when conditions not met
   - Edge calculation accuracy
   - Confidence scoring edge cases
   - Regime filtering

## Signal Output

```typescript
{
  strategy_id: UUID,
  market_id: UUID,
  direction: 'buy_yes' | 'buy_no' | 'sell_yes' | 'sell_no' | 'no_trade',
  outcome_token: string,
  confidence: number,       // 0 to 1
  estimated_edge: number,   // fair_value - market_price - estimated_cost
  estimated_cost: number,   // fees + slippage estimate
  fair_value: number,       // model's fair probability
  market_price: number,     // current Polymarket price
  reasoning: string,        // human-readable explanation
  raw_data: object,         // all inputs that produced this signal
  regime: string,           // current regime
}
```

## Testing Requirements

- Minimum 5 unit tests per strategy
- Test with fixed deterministic inputs for reproducibility
- Test edge cases: zero liquidity, stale data, extreme prices (0.01, 0.99)
- Verify estimated_edge calculation matches expected formula
