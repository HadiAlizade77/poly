---
name: add-prisma-model
description: >
  Add or modify a Prisma model/table for the PostgreSQL database.
  Use when creating tables like markets, signals, orders, trades, positions, risk_config, etc.
argument-hint: "[model-name]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Add Prisma Model

Create or modify model: `$ARGUMENTS`

## Project Context

- Prisma schema: `packages/backend/prisma/schema.prisma`
- Prisma 7.x with TypeScript generator (`prisma-client`)
- PostgreSQL 16
- JSONB columns for flexible data (market metadata, strategy params, AI outputs)
- Enums defined in Prisma schema
- Indexes for time-series queries

## Steps

1. **Add model to `schema.prisma`**:
   - Define all fields with proper types
   - Use `@id`, `@unique`, `@default`, `@relation` annotations
   - Add `@@index` for query patterns (especially timestamp-based)
   - Use `Json` type for JSONB columns
   - Use `Decimal` for financial values (not Float)
   - Add `created_at` / `updated_at` fields with defaults

2. **Create migration**:
   ```bash
   npx prisma migrate dev --name add_$0
   ```

3. **Generate client**:
   ```bash
   npx prisma generate
   ```

4. **Add seed data** in `packages/backend/prisma/seed.ts` if applicable

5. **Export types** from `packages/shared/src/types/` for frontend/backend sharing

## Conventions

- Table names: snake_case plural (`market_snapshots`, `risk_events`)
- Model names: PascalCase singular (`MarketSnapshot`, `RiskEvent`)
- UUID primary keys for entity tables
- BIGSERIAL for high-volume append-only tables (snapshots, signals, events)
- `Decimal(20,6)` for monetary/financial values
- `Decimal(10,6)` for prices/probabilities
- `Decimal(5,4)` for confidence/percentages (0 to 1)
- JSONB (`Json`) for flexible payloads
- `@updatedAt` for automatic update timestamps
- Always add indexes for foreign keys and common query patterns

## Financial Data Rule

NEVER use `Float` for financial values. Always use `Decimal` with appropriate precision:
- Balances/sizes: `Decimal(20,6)`
- Prices: `Decimal(10,6)`
- Percentages: `Decimal(5,4)` or `Decimal(8,6)`
